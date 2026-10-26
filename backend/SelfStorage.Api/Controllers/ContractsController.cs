using System.Data;
using System.Linq.Expressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

/// <summary>Flow 3: the customer manages rented units and who may enter on their behalf.</summary>
[ApiController]
[Route("api/contracts")]
[Authorize]
public class ContractsController(
    SelfStorageDbContext db,
    AccessService access,
    BillingService billing,
    RentalPolicyService rentalPolicies,
    TimeProvider clock) : ControllerBase
{
    public static readonly Expression<Func<Contract, ContractDto>> ToDto = c => new ContractDto(
        c.ContractId, c.ContractNumber, c.Unit.FacilityId, c.Unit.Facility.FacilityName, c.Unit.UnitCode,
        c.StartDate, c.EndDate, c.MonthlyRentFee, c.Status);

    [HttpGet("my")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<List<ContractDto>> Mine(CancellationToken ct)
    {
        var me = User.GetUserId();
        return db.Contracts.Where(c => c.CustomerId == me).OrderByDescending(c => c.StartDate).Select(ToDto).ToListAsync(ct);
    }

    /// <summary>Contract with deposit balance and late fees (customer: own contracts; staff: their facility).</summary>
    [HttpGet("{id:int}")]
    [Authorize(Roles = AppRoles.Customer + "," + AppRoles.GateRoles)]
    public async Task<ContractDetailDto> Detail(int id, CancellationToken ct)
    {
        var contract = await db.Contracts.Include(c => c.Unit).ThenInclude(u => u.Facility)
            .Include(c => c.Customer)
            .FirstOrDefaultAsync(c => c.ContractId == id, ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        if (User.IsInRole(AppRoles.Customer))
        {
            if (contract.CustomerId != User.GetUserId()) throw AppException.NotFound("Không tìm thấy hợp đồng");
        }
        else
        {
            await access.EnsureAssignedAsync(User.GetUserId(), contract.Unit.FacilityId, ct);
        }
        var policy = await rentalPolicies.ForFacilityAsync(contract.Unit.FacilityId, ct);
        // Only fees still owed: a resolved overdue record (paid or settled at return) no longer counts.
        var overdue = await db.OverdueRecords.Where(r => r.ContractId == id && r.ResolvedDate == null)
            .OrderByDescending(r => r.OverdueId).FirstOrDefaultAsync(ct);
        var accrued = overdue?.AccumulatedLateFee ?? 0m;
        var hasPendingRenewal = await db.ContractRenewals.AnyAsync(r => r.ContractId == id && r.Status == "Pending", ct);
        return new ContractDetailDto(contract.ContractId, contract.ContractNumber, contract.Unit.FacilityId,
            contract.Unit.Facility.FacilityName, contract.UnitId, contract.Unit.UnitCode, contract.Unit.Status,
            contract.StartDate, contract.EndDate, contract.Status, contract.MonthlyRentFee, contract.DepositPaid,
            accrued, Math.Max(0m, contract.DepositPaid - accrued), Math.Max(0m, accrued - contract.DepositPaid),
            contract.EndDate.AddDays(-policy.RenewalNoticeDays).ToDateTime(TimeOnly.MinValue),
            contract.Customer.FullName, ContractSchedule.ExpiresAt(contract.EndDate), hasPendingRenewal);
    }

    /// <summary>
    /// Ask for a renewal (and pay it early) at any time while the contract is active, also after it expired
    /// at 20:00 as long as the unit has not been locked for overdue yet. RenewalNoticeDays is only a reminder.
    /// </summary>
    [HttpPost("{id:int}/renewals")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<RenewalDto> RequestRenewal(int id, RequestRenewalRequest req, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var contract = await db.Contracts.Include(c => c.Unit).FirstOrDefaultAsync(c => c.ContractId == id
            && c.CustomerId == User.GetUserId(), ct) ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        if (contract.Status != ContractStatus.Active)
            throw AppException.Conflict(contract.Status == ContractStatus.Overdue
                ? "Hợp đồng đã quá hạn và kho đang bị khóa; vui lòng liên hệ nhân viên để trả kho"
                : "Chỉ có thể gia hạn hợp đồng đang hiệu lực");
        if (await db.ContractRenewals.AnyAsync(r => r.ContractId == id && r.Status == "Pending", ct))
            throw AppException.Conflict("Hợp đồng đã có yêu cầu gia hạn đang chờ xử lý");

        var renewal = new ContractRenewal
        {
            ContractId = id,
            OldEndDate = contract.EndDate,
            NewEndDate = contract.EndDate.AddMonths(req.ExtensionMonths),
            ExtensionMonths = req.ExtensionMonths,
            RenewalFee = contract.MonthlyRentFee * req.ExtensionMonths,
        };
        db.ContractRenewals.Add(renewal);
        await db.SaveChangesAsync(ct);
        var invoice = billing.CreateInvoice(contract.CustomerId, "RENEWAL", contract.EndDate,
            $"Phí gia hạn {req.ExtensionMonths} tháng cho hợp đồng {contract.ContractNumber}",
            contract.MonthlyRentFee, req.ExtensionMonths, contractId: contract.ContractId);
        db.Invoices.Add(invoice);
        await db.SaveChangesAsync(ct);
        renewal.InvoiceId = invoice.InvoiceId;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToRenewalDto(renewal);
    }

    [HttpGet("{id:int}/renewals")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<List<RenewalDto>> MyRenewals(int id, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        return await db.ContractRenewals.Where(r => r.ContractId == id).OrderByDescending(r => r.RequestedAt)
            .Select(r => new RenewalDto(r.RenewalId, r.ContractId, r.OldEndDate, r.NewEndDate,
                r.ExtensionMonths, r.RenewalFee, r.Status, r.RequestedAt, r.InvoiceId)).ToListAsync(ct);
    }

    [HttpGet("facilities/{facilityId:int}/renewals")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<RenewalDto>> PendingRenewals(int facilityId, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        return await db.ContractRenewals.Where(r => r.Status == "Pending"
                && db.Contracts.Any(c => c.ContractId == r.ContractId && c.Unit.FacilityId == facilityId))
            .OrderBy(r => r.RequestedAt)
            .Select(r => new RenewalDto(r.RenewalId, r.ContractId, r.OldEndDate, r.NewEndDate,
                r.ExtensionMonths, r.RenewalFee, r.Status, r.RequestedAt, r.InvoiceId)).ToListAsync(ct);
    }

    [HttpPost("renewals/{renewalId:int}/confirm-payment")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<RenewalDto> ConfirmRenewalPayment(int renewalId, CancellationToken ct)
    {
        var renewal = await db.ContractRenewals.FirstOrDefaultAsync(r => r.RenewalId == renewalId, ct)
                      ?? throw AppException.NotFound("Không tìm thấy yêu cầu gia hạn");
        var contract = await db.Contracts.Include(c => c.Unit)
            .FirstOrDefaultAsync(c => c.ContractId == renewal.ContractId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        await access.EnsureAssignedAsync(User.GetUserId(), contract.Unit.FacilityId, ct);
        if (renewal.InvoiceId is not int invoiceId)
            throw AppException.Conflict("Yêu cầu gia hạn chưa có hóa đơn");
        var invoice = await db.Invoices.FindAsync([invoiceId], ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn gia hạn");
        await billing.RecordStaffPaymentAsync(invoiceId, User.GetUserId(),
            new RecordPaymentRequest("Cash", invoice.TotalAmount, null, "Nhân viên xác nhận đã nhận phí gia hạn"),
            ct);
        await db.Entry(renewal).ReloadAsync(ct);
        return ToRenewalDto(renewal);
    }

    [HttpPost("renewals/{renewalId:int}/reject")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<IActionResult> RejectRenewal(int renewalId, CancellationToken ct)
    {
        var renewal = await db.ContractRenewals.FirstOrDefaultAsync(r => r.RenewalId == renewalId, ct)
                      ?? throw AppException.NotFound("Không tìm thấy yêu cầu gia hạn");
        var contract = await db.Contracts.Include(c => c.Unit)
            .FirstOrDefaultAsync(c => c.ContractId == renewal.ContractId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        await access.EnsureAssignedAsync(User.GetUserId(), contract.Unit.FacilityId, ct);
        if (renewal.Status != "Pending")
            throw AppException.Conflict("Yêu cầu gia hạn không còn chờ xử lý");
        renewal.Status = "Rejected";
        renewal.ApprovedByStaffId = User.GetUserId();
        renewal.ProcessedAt = clock.GetLocalNow().DateTime;
        if (renewal.InvoiceId is int invoiceId)
        {
            var invoice = await db.Invoices.FirstOrDefaultAsync(i => i.InvoiceId == invoiceId, ct);
            if (invoice is not null && invoice.Status == "Unpaid")
                invoice.Status = "Cancelled";
        }
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>
    /// Take the unit back at any hour (24/7), also before the end date. Late fees are deducted from the deposit;
    /// pending renewals are cancelled together with their unpaid invoices.
    /// </summary>
    [HttpPost("{id:int}/return")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<ReturnUnitDto> ReturnUnit(int id, ReturnUnitRequest req, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var contract = await db.Contracts.Include(c => c.Unit)
            .FirstOrDefaultAsync(c => c.ContractId == id, ct) ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        var staffId = User.GetUserId();
        await access.EnsureAssignedAsync(staffId, contract.Unit.FacilityId, ct);
        var now = clock.GetLocalNow().DateTime;
        var early = now < ContractSchedule.ExpiresAt(contract.EndDate);
        if (!req.AllItemsRemoved)
            throw AppException.BadRequest("Nhân viên cần xác nhận kho đã được dọn sạch trước khi hoàn tất trả kho");
        if (contract.Status is not (ContractStatus.Active or ContractStatus.Overdue))
            throw AppException.Conflict("Hợp đồng không ở trạng thái có thể trả kho");
        if (await db.AccessRecords.AnyAsync(r => r.ContractId == id && r.Result == AccessResult.Granted
            && r.ExitTime == null, ct))
            throw AppException.Conflict("Cần xác nhận tất cả khách đã ra khỏi cơ sở trước khi trả kho");

        var overdue = await db.OverdueRecords.Where(r => r.ContractId == id && r.ResolvedDate == null)
            .OrderByDescending(r => r.OverdueId).FirstOrDefaultAsync(ct);
        var accumulated = overdue?.AccumulatedLateFee ?? 0m;
        var deducted = Math.Min(contract.DepositPaid, accumulated);
        var refund = contract.DepositPaid - deducted;
        var stillOwed = accumulated - deducted;
        db.HandoverRecords.Add(new HandoverRecord
        {
            ContractId = id,
            StaffId = staffId,
            HandoverType = "CHECK_OUT",
            HandoverDateTime = now,
            UnitConditionNotes = $"Đã xác nhận dọn sạch kho{(early ? " (trả kho trước hạn)" : "")}. {req.UnitConditionNotes}",
            CustomerSignatureConfirmed = true,
            StaffNotes = req.StaffNotes,
        });
        var pendingRenewals = await db.ContractRenewals
            .Where(r => r.ContractId == id && r.Status == "Pending").ToListAsync(ct);
        var renewalInvoiceIds = pendingRenewals.Where(r => r.InvoiceId != null).Select(r => r.InvoiceId!.Value).ToList();
        if (renewalInvoiceIds.Count > 0
            && await db.Payments.AnyAsync(p => renewalInvoiceIds.Contains(p.InvoiceId) && p.Status == "Pending", ct))
            throw AppException.Conflict("Khách đang có giao dịch gia hạn trực tuyến chờ xác nhận; hãy chờ giao dịch hoàn tất rồi trả kho");
        foreach (var renewal in pendingRenewals)
        {
            renewal.Status = "Rejected";
            renewal.ApprovedByStaffId = staffId;
            renewal.ProcessedAt = now;
        }
        await db.Invoices.Where(i => renewalInvoiceIds.Contains(i.InvoiceId) && i.Status == "Unpaid")
            .ForEachAsync(i => i.Status = "Cancelled", ct);
        contract.Status = ContractStatus.Terminated;
        contract.Unit.Status = UnitStatus.Available;
        if (overdue is not null)
        {
            overdue.ActionTaken = stillOwed == 0 ? "Resolved" : "NoticeSent";
            overdue.HandledByStaffId = staffId;
            overdue.ResolvedDate = stillOwed == 0 ? now : null;
            overdue.Notes = $"Trả kho: phí quá hạn {accumulated:N0}đ; cấn trừ cọc {deducted:N0}đ; còn phải thu {stillOwed:N0}đ."
                + (string.IsNullOrWhiteSpace(req.StaffNotes) ? "" : $" {req.StaffNotes}");
        }
        if (stillOwed > 0)
        {
            db.Invoices.Add(billing.CreateInvoice(contract.CustomerId, "OVERDUE_FINE",
                DateOnly.FromDateTime(now),
                $"Phí lưu kho quá hạn {overdue?.DaysOverdue ?? 0} ngày cho hợp đồng {contract.ContractNumber}",
                stillOwed, contractId: id));
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new ReturnUnitDto(id, contract.Status, contract.Unit.Status, contract.DepositPaid,
            deducted, refund, stillOwed, now);
    }

    [HttpPost("{id:int}/deposit-refunds")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<DepositRefundDto> RefundDeposit(int id, RecordDepositRefundRequest req, CancellationToken ct)
    {
        var transactionCode = string.IsNullOrWhiteSpace(req.TransactionCode) ? null : req.TransactionCode.Trim();
        if (req.PaymentMethod is not ("Cash" or "BankTransfer"))
            throw AppException.BadRequest("Phương thức hoàn cọc chỉ hỗ trợ tiền mặt hoặc chuyển khoản");
        if (req.PaymentMethod == "BankTransfer" && transactionCode is null)
            throw AppException.BadRequest("Hoàn cọc qua chuyển khoản phải có mã giao dịch");

        var contract = await db.Contracts.FirstOrDefaultAsync(c => c.ContractId == id, ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        var staffId = User.GetUserId();
        await access.EnsureAssignedAsync(staffId,
            await db.StorageUnits.Where(u => u.UnitId == contract.UnitId).Select(u => u.FacilityId).SingleAsync(ct), ct);
        if (contract.Status != ContractStatus.Terminated)
            throw AppException.Conflict("Chỉ được hoàn cọc sau khi hợp đồng đã kết thúc và trả kho");
        if (contract.ReservationId is not int reservationId)
            throw AppException.Conflict("Không tìm thấy đơn đặt kho để đối chiếu khoản cọc");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var depositInvoice = await db.Invoices
            .Include(i => i.Payments)
            .FirstOrDefaultAsync(i => i.ReservationId == reservationId && i.InvoiceType == "DEPOSIT", ct)
            ?? throw AppException.Conflict("Không tìm thấy hóa đơn cọc");
        if (depositInvoice.Status != "Paid"
            || !depositInvoice.Payments.Any(p => p.Status == "Success"))
            throw AppException.Conflict("Khoản cọc chưa được ghi nhận thanh toán");
        if (transactionCode is not null && await db.Payments.AnyAsync(
            p => p.TransactionCode == transactionCode, ct))
            throw AppException.Conflict("Mã giao dịch đã được ghi nhận");

        var latestOverdue = await db.OverdueRecords.Where(o => o.ContractId == id)
            .OrderByDescending(o => o.OverdueId).FirstOrDefaultAsync(ct);
        var refundable = Math.Max(0m, contract.DepositPaid - (latestOverdue?.AccumulatedLateFee ?? 0m));
        var alreadyRefunded = depositInvoice.Payments.Where(p => p.Status == "Refunded").Sum(p => p.AmountPaid);
        var remaining = refundable - alreadyRefunded;
        if (req.Amount <= 0 || req.Amount > remaining)
            throw AppException.BadRequest($"Số tiền hoàn cọc còn có thể hoàn là {Math.Max(0m, remaining):N0}đ");

        var now = clock.GetLocalNow().DateTime;
        var payment = new Payment
        {
            InvoiceId = depositInvoice.InvoiceId,
            ReceivedByStaffId = staffId,
            PaymentMethod = req.PaymentMethod,
            TransactionCode = transactionCode,
            AmountPaid = req.Amount,
            PaymentDate = now,
            Status = "Refunded",
            PaymentNotes = req.Notes,
        };
        db.Payments.Add(payment);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new DepositRefundDto(id, req.Amount, remaining - req.Amount, req.PaymentMethod, transactionCode, now);
    }

    [HttpGet("facilities/{facilityId:int}/overdue")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<OverdueSummaryDto>> FacilityOverdue(int facilityId, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        return await (from overdue in db.OverdueRecords
                      join contract in db.Contracts on overdue.ContractId equals contract.ContractId
                      join unit in db.StorageUnits on contract.UnitId equals unit.UnitId
                      join customer in db.Users on contract.CustomerId equals customer.UserId
                      where unit.FacilityId == facilityId && overdue.ResolvedDate == null
                      let returned = contract.Status == ContractStatus.Terminated
                      // Still holding the unit first, then returned units that still owe late fees.
                      orderby returned, overdue.LockAppliedDate
                      select new OverdueSummaryDto(overdue.OverdueId, contract.ContractId,
                          contract.ContractNumber, customer.FullName, unit.UnitCode, contract.EndDate,
                          contract.Status, unit.Status, overdue.DaysOverdue, overdue.AccumulatedLateFee,
                          !returned && contract.DepositPaid > overdue.AccumulatedLateFee
                              ? contract.DepositPaid - overdue.AccumulatedLateFee : 0m,
                          overdue.AccumulatedLateFee > contract.DepositPaid
                              ? overdue.AccumulatedLateFee - contract.DepositPaid : 0m,
                          overdue.LockAppliedDate, returned))
            .ToListAsync(ct);
    }

    /// <summary>Contracts to follow up: expiring within <paramref name="days"/> days, expired or overdue, not returned yet.</summary>
    [HttpGet("facilities/{facilityId:int}/due")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<DueContractDto>> DueContracts(int facilityId, [FromQuery] int days = 7,
        CancellationToken ct = default)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        var until = DateOnly.FromDateTime(clock.GetLocalNow().DateTime).AddDays(Math.Clamp(days, 0, 90));
        var rows = await db.Contracts
            .Where(c => c.Unit.FacilityId == facilityId && c.EndDate <= until
                && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Overdue))
            .OrderBy(c => c.EndDate)
            .Select(c => new
            {
                c.ContractId, c.ContractNumber, c.Customer.FullName, c.Customer.PhoneNumber, c.Unit.UnitCode,
                c.EndDate, c.Status, UnitStatus = c.Unit.Status,
                HasPendingRenewal = db.ContractRenewals.Any(r => r.ContractId == c.ContractId && r.Status == "Pending"),
            })
            .ToListAsync(ct);
        return rows.Select(c => new DueContractDto(c.ContractId, c.ContractNumber, c.FullName, c.PhoneNumber,
            c.UnitCode, c.EndDate, ContractSchedule.ExpiresAt(c.EndDate), c.Status, c.UnitStatus,
            c.HasPendingRenewal)).ToList();
    }

    [HttpGet("{id:int}/authorized-persons")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<List<PersonDto>> AuthorizedPersons(int id, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        return await db.AuthorizedPersons.Where(p => p.ContractId == id && p.Status == "Active")
            .Select(p => new PersonDto(p.AuthorizedPersonId, p.FullName, p.CitizenId, p.PhoneNumber, p.Relationship))
            .ToListAsync(ct);
    }

    [HttpPost("{id:int}/authorized-persons")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<PersonDto> AddAuthorizedPerson(int id, AddAuthorizedPersonRequest req, CancellationToken ct)
    {
        var contract = await LoadOwnAsync(id, ct);
        if (contract.Status is ContractStatus.Terminated or ContractStatus.Liquidated)
            throw AppException.Conflict("Hợp đồng đã kết thúc, không thể thêm người được ủy quyền");
        var citizenId = Contact.NormalizeCitizenId(req.CitizenId);
        var ownerCitizenId = await db.Users.Where(u => u.UserId == contract.CustomerId)
            .Select(u => u.CitizenId).SingleAsync(ct);
        if (ownerCitizenId is not null && Contact.NormalizeCitizenId(ownerCitizenId) == citizenId)
            throw AppException.BadRequest("Đây là CCCD của chủ hợp đồng; chủ hợp đồng không cần thêm vào danh sách ủy quyền");

        var person = await db.AuthorizedPersons.FirstOrDefaultAsync(p => p.ContractId == id && p.CitizenId == citizenId, ct);
        if (person is null)
        {
            person = new AuthorizedPerson { ContractId = id, CitizenId = citizenId };
            db.AuthorizedPersons.Add(person);
        }
        else if (person.Status == "Active")
        {
            throw AppException.Conflict("Người này đã có trong danh sách");
        }
        // Re-adding a revoked person reactivates the same row (ContractID + CitizenID is unique).
        person.FullName = req.FullName.Trim();
        person.PhoneNumber = Contact.NormalizePhone(req.PhoneNumber);
        person.Relationship = string.IsNullOrWhiteSpace(req.Relationship) ? null : req.Relationship.Trim();
        person.Status = "Active";
        person.RevokedAt = null;
        await db.SaveChangesAsync(ct);
        return new PersonDto(person.AuthorizedPersonId, person.FullName, person.CitizenId, person.PhoneNumber, person.Relationship);
    }

    [HttpDelete("{id:int}/authorized-persons/{personId:int}")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<IActionResult> RevokeAuthorizedPerson(int id, int personId, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        var person = await db.AuthorizedPersons.FirstOrDefaultAsync(p => p.ContractId == id && p.AuthorizedPersonId == personId, ct)
                     ?? throw AppException.NotFound("Không tìm thấy người được ủy quyền");
        person.Status = "Revoked";
        person.RevokedAt = clock.GetLocalNow().DateTime;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Entry/exit history of this unit (customer: own contracts; staff: their facility).</summary>
    [HttpGet("{id:int}/access-history")]
    public async Task<List<AccessRecordDto>> AccessHistory(int id, CancellationToken ct)
    {
        var contract = await db.Contracts.Include(c => c.Unit).FirstOrDefaultAsync(c => c.ContractId == id, ct)
                       ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        if (User.IsInRole(AppRoles.Customer))
        {
            if (contract.CustomerId != User.GetUserId()) throw AppException.NotFound("Không tìm thấy hợp đồng");
        }
        else
        {
            await access.EnsureAssignedAsync(User.GetUserId(), contract.Unit.FacilityId, ct);
        }
        return await access.GetHistoryAsync(id, ct);
    }

    private async Task<Contract> LoadOwnAsync(int id, CancellationToken ct)
    {
        var me = User.GetUserId();
        return await db.Contracts.FirstOrDefaultAsync(c => c.ContractId == id && c.CustomerId == me, ct)
               ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
    }

    private static RenewalDto ToRenewalDto(ContractRenewal r) =>
        new(r.RenewalId, r.ContractId, r.OldEndDate, r.NewEndDate, r.ExtensionMonths,
            r.RenewalFee, r.Status, r.RequestedAt, r.InvoiceId);
}
