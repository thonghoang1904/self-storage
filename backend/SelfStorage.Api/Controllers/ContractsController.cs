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
    EmailOutboxService emailOutbox,
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

    [HttpGet("{id:int}")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<ContractDetailDto> Detail(int id, CancellationToken ct)
    {
        var contract = await db.Contracts.Include(c => c.Unit).ThenInclude(u => u.Facility)
            .FirstOrDefaultAsync(c => c.ContractId == id && c.CustomerId == User.GetUserId(), ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        var policy = await rentalPolicies.ForFacilityAsync(contract.Unit.FacilityId, ct);
        var overdue = await db.OverdueRecords.Where(r => r.ContractId == id)
            .OrderByDescending(r => r.OverdueId).FirstOrDefaultAsync(ct);
        var accrued = overdue?.AccumulatedLateFee ?? 0m;
        return new ContractDetailDto(contract.ContractId, contract.ContractNumber, contract.Unit.FacilityId,
            contract.Unit.Facility.FacilityName, contract.UnitId, contract.Unit.UnitCode, contract.Unit.Status,
            contract.StartDate, contract.EndDate, contract.Status, contract.MonthlyRentFee, contract.DepositPaid,
            accrued, Math.Max(0m, contract.DepositPaid - accrued), Math.Max(0m, accrued - contract.DepositPaid),
            // Renewal is open for the whole term (early renewal); the policy's notice days only drive reminders.
            contract.StartDate.ToDateTime(TimeOnly.MinValue));
    }

    [HttpPost("{id:int}/renewals")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<RenewalDto> RequestRenewal(int id, RequestRenewalRequest req, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var now = clock.GetLocalNow().DateTime;
        var contract = await db.Contracts.Include(c => c.Unit).FirstOrDefaultAsync(c => c.ContractId == id
            && c.CustomerId == User.GetUserId(), ct) ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        // Early renewal: allowed any time while the contract is active, until 20:00 on the end date.
        if (contract.Status != ContractStatus.Active || now >= contract.EndDate.ToDateTime(new TimeOnly(20, 0)))
            throw AppException.Conflict("Chỉ có thể yêu cầu gia hạn khi hợp đồng còn hiệu lực, trước 20:00 ngày hết hạn");
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
        await emailOutbox.QueueInvoiceIssuedAsync(invoice.InvoiceId, ct);
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
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
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
            {
                invoice.Status = "Cancelled";
                var pendingPayments = await db.Payments
                    .Where(p => p.InvoiceId == invoiceId && p.Status == "Pending")
                    .ToListAsync(ct);
                foreach (var payment in pendingPayments)
                {
                    payment.Status = "Failed";
                    payment.PaymentNotes = "Giao dịch bị hủy do yêu cầu gia hạn bị từ chối.";
                }
            }
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return NoContent();
    }

    [HttpPost("{id:int}/return")]
    [HttpPost("/api/admin/contracts/{id:int}/return")]
    [Authorize(Roles = AppRoles.GateRoles + "," + AppRoles.Admin)]
    public async Task<ReturnUnitDto> ReturnUnit(int id, ReturnUnitRequest req, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var contract = await db.Contracts.Include(c => c.Unit)
            .FirstOrDefaultAsync(c => c.ContractId == id, ct) ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        var staffId = User.GetUserId();
        if (!User.IsInRole(AppRoles.Admin))
            await access.EnsureAssignedAsync(staffId, contract.Unit.FacilityId, ct);
        var now = clock.GetLocalNow().DateTime;
        var today = DateOnly.FromDateTime(now);
        var returnAppointment = contract.EndDate.ToDateTime(new TimeOnly(20, 0));
        // Before the appointment only an explicit early return is allowed (fee, no refund of rent already paid).
        var early = now < returnAppointment;
        if (early && !req.EarlyReturn)
            throw AppException.Conflict($"Lịch trả kho là 20:00 ngày {contract.EndDate:dd/MM/yyyy}");
        var earlyReason = req.EarlyReturnReason?.Trim() ?? "";
        if (early && earlyReason.Length is < 5 or > 500)
            throw AppException.BadRequest("Cần ghi lý do khách trả kho sớm (5–500 ký tự)");
        if (!req.AllItemsRemoved)
            throw AppException.BadRequest("Nhân viên cần xác nhận kho đã được dọn sạch trước khi hoàn tất trả kho");
        if (contract.Status is not (ContractStatus.Active or ContractStatus.Overdue))
            throw AppException.Conflict("Hợp đồng không ở trạng thái có thể trả kho");
        if (await db.AccessRecords.AnyAsync(r => r.ContractId == id && r.Result == AccessResult.Granted
            && r.ExitTime == null, ct))
            throw AppException.Conflict("Cần xác nhận tất cả khách đã ra khỏi cơ sở trước khi trả kho");

        var overdue = await db.OverdueRecords.Where(r => r.ContractId == id && r.ResolvedDate == null)
            .OrderByDescending(r => r.OverdueId).FirstOrDefaultAsync(ct);
        var lateFees = overdue?.AccumulatedLateFee ?? 0m;
        var earlyFee = early ? await EarlyReturnFeeAsync(ct) : 0m;
        var accumulated = lateFees + earlyFee;
        var deducted = Math.Min(contract.DepositPaid, accumulated);
        var refund = contract.DepositPaid - deducted;
        var stillOwed = accumulated - deducted;
        db.HandoverRecords.Add(new HandoverRecord
        {
            ContractId = id,
            StaffId = staffId,
            HandoverType = "CHECK_OUT",
            HandoverDateTime = now,
            UnitConditionNotes = $"Đã xác nhận dọn sạch kho. {req.UnitConditionNotes}",
            CustomerSignatureConfirmed = true,
            StaffNotes = early
                ? $"Trả kho sớm (hết hạn {contract.EndDate:dd/MM/yyyy}): {earlyReason}" + (string.IsNullOrWhiteSpace(req.StaffNotes) ? "" : $" | {req.StaffNotes}")
                : req.StaffNotes,
        });
        contract.Status = ContractStatus.Terminated;
        contract.Unit.Status = UnitStatus.Available;
        if (overdue is not null)
        {
            overdue.ActionTaken = stillOwed == 0 ? "Resolved" : "NoticeSent";
            overdue.HandledByStaffId = staffId;
            overdue.ResolvedDate = stillOwed == 0 ? now : null;
            overdue.Notes = $"Trả kho: phí quá hạn {lateFees:N0}đ; cấn trừ cọc {deducted:N0}đ; còn phải thu {stillOwed:N0}đ."
                + (string.IsNullOrWhiteSpace(req.StaffNotes) ? "" : $" {req.StaffNotes}");
        }
        if (early)
        {
            // The contract ends on the day the unit is handed back (the schema needs EndDate after StartDate).
            var originalEnd = contract.EndDate;
            contract.EndDate = today > contract.StartDate ? today : contract.StartDate.AddDays(1);
            await CancelBillsAfterAsync(contract, today, "trả kho sớm", ct);
            var request = await db.EarlyReturnRequests
                .FirstOrDefaultAsync(r => r.ContractId == id && r.Status == EarlyReturnStatus.Pending, ct);
            if (request is null)
            {
                request = new EarlyReturnRequest { ContractId = id, CustomerId = contract.CustomerId, RequestedAt = now };
                db.EarlyReturnRequests.Add(request);
            }
            request.ReturnDate = today;
            request.Reason = earlyReason;
            request.EarlyReturnFee = earlyFee;
            request.Status = EarlyReturnStatus.Completed;
            request.CompletedByStaffId = staffId;
            request.CompletedAt = now;
            db.ActivityLogs.Add(new ActivityLog
            {
                UserId = staffId,
                Action = "ContractReturnedEarly",
                IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
                Details = $"Contract {contract.ContractNumber}; end date {originalEnd:yyyy-MM-dd} -> {contract.EndDate:yyyy-MM-dd}; early return fee {earlyFee:N0}",
                CreatedAt = now,
            });
        }
        if (stillOwed > 0)
        {
            var description = earlyFee > 0 && lateFees == 0
                ? $"Phí trả kho sớm còn thiếu sau khi trừ cọc, hợp đồng {contract.ContractNumber}"
                : $"Phí lưu kho quá hạn {overdue?.DaysOverdue ?? 0} ngày" + (earlyFee > 0 ? " và phí trả kho sớm" : "")
                  + $" cho hợp đồng {contract.ContractNumber}";
            var overdueInvoice = billing.CreateInvoice(contract.CustomerId, early && lateFees == 0 ? "EXTRA_CHARGE" : "OVERDUE_FINE",
                today, description, stillOwed, contractId: id);
            db.Invoices.Add(overdueInvoice);
            await db.SaveChangesAsync(ct);
            await emailOutbox.QueueInvoiceIssuedAsync(overdueInvoice.InvoiceId, ct);
        }
        if (User.IsInRole(AppRoles.Admin))
        {
            db.ActivityLogs.Add(new ActivityLog
            {
                UserId = staffId,
                Action = "AdminContractReturned",
                IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
                Details = $"Contract {contract.ContractNumber}; deposit refund due {refund:N0}; outstanding fee {stillOwed:N0}",
                CreatedAt = now,
            });
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new ReturnUnitDto(id, contract.Status, contract.Unit.Status, contract.DepositPaid,
            deducted, refund, stillOwed, now, early ? earlyFee : null);
    }

    /// <summary>What returning before the end date costs (GET .../early-return-quote?returnDate=yyyy-MM-dd).</summary>
    [HttpGet("{id:int}/early-return-quote")]
    [Authorize(Roles = AppRoles.Customer + "," + AppRoles.GateRoles + "," + AppRoles.Admin)]
    public async Task<EarlyReturnQuoteDto> EarlyReturnQuote(int id, [FromQuery] DateOnly? returnDate, CancellationToken ct)
    {
        var contract = await LoadForEarlyReturnAsync(id, ct);
        var now = clock.GetLocalNow().DateTime;
        var today = DateOnly.FromDateTime(now);
        if (now >= contract.EndDate.ToDateTime(new TimeOnly(20, 0)))
            throw AppException.Conflict($"Hợp đồng đã đến lịch trả kho 20:00 ngày {contract.EndDate:dd/MM/yyyy}, không còn là trả sớm");
        if (contract.Status is not (ContractStatus.Active or ContractStatus.Overdue))
            throw AppException.Conflict("Hợp đồng không ở trạng thái có thể trả kho");
        var date = returnDate ?? today;
        if (date < today || date > contract.EndDate)
            throw AppException.BadRequest($"Ngày trả kho phải từ hôm nay đến {contract.EndDate:dd/MM/yyyy}");

        var lateFees = await db.OverdueRecords.Where(r => r.ContractId == id && r.ResolvedDate == null)
            .OrderByDescending(r => r.OverdueId).Select(r => (decimal?)r.AccumulatedLateFee).FirstOrDefaultAsync(ct) ?? 0m;
        var fee = await EarlyReturnFeeAsync(ct);
        var total = lateFees + fee;
        var deducted = Math.Min(contract.DepositPaid, total);
        var cancelled = await BillsAfter(contract.ContractId, date).CountAsync(ct);
        return new EarlyReturnQuoteDto(contract.ContractId, contract.EndDate, contract.EndDate.DayNumber - date.DayNumber,
            fee, lateFees, contract.DepositPaid, deducted, contract.DepositPaid - deducted, total - deducted, cancelled);
    }

    /// <summary>The customer asks to hand the unit back early on a chosen day; staff complete it at the facility.</summary>
    [HttpPost("{id:int}/early-return-requests")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<EarlyReturnRequestDto> RequestEarlyReturn(int id, CreateEarlyReturnRequest req, CancellationToken ct)
    {
        var reason = req.Reason.Trim();
        if (reason.Length is < 5 or > 500)
            throw AppException.BadRequest("Lý do trả sớm từ 5 đến 500 ký tự");
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var contract = await LoadOwnAsync(id, ct);
        var now = clock.GetLocalNow().DateTime;
        var today = DateOnly.FromDateTime(now);
        if (contract.Status != ContractStatus.Active || today >= contract.EndDate)
            throw AppException.Conflict("Chỉ gửi yêu cầu trả sớm khi hợp đồng còn hiệu lực và chưa đến ngày hết hạn");
        if (req.ReturnDate < today || req.ReturnDate >= contract.EndDate)
            throw AppException.BadRequest($"Ngày trả kho phải từ hôm nay đến trước ngày {contract.EndDate:dd/MM/yyyy}");
        if (await db.EarlyReturnRequests.AnyAsync(r => r.ContractId == id && r.Status == EarlyReturnStatus.Pending, ct))
            throw AppException.Conflict("Hợp đồng đã có yêu cầu trả kho sớm đang chờ; hủy yêu cầu cũ trước khi gửi lại");

        var request = new EarlyReturnRequest
        {
            ContractId = id,
            CustomerId = contract.CustomerId,
            ReturnDate = req.ReturnDate,
            Reason = reason,
            EarlyReturnFee = await EarlyReturnFeeAsync(ct),
            Status = EarlyReturnStatus.Pending,
            RequestedAt = now,
        };
        db.EarlyReturnRequests.Add(request);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await EarlyReturnRows(db.EarlyReturnRequests.Where(r => r.RequestId == request.RequestId)).SingleAsync(ct);
    }

    [HttpGet("{id:int}/early-return-requests")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<List<EarlyReturnRequestDto>> MyEarlyReturnRequests(int id, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        return await EarlyReturnRows(db.EarlyReturnRequests.Where(r => r.ContractId == id)
            .OrderByDescending(r => r.RequestedAt)).ToListAsync(ct);
    }

    [HttpDelete("{id:int}/early-return-requests/{requestId:int}")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<EarlyReturnRequestDto> CancelEarlyReturnRequest(int id, int requestId, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        var request = await db.EarlyReturnRequests.FirstOrDefaultAsync(r => r.RequestId == requestId && r.ContractId == id, ct)
            ?? throw AppException.NotFound("Không tìm thấy yêu cầu trả kho sớm");
        if (request.Status != EarlyReturnStatus.Pending)
            throw AppException.Conflict("Yêu cầu trả kho sớm đã được xử lý hoặc đã hủy");
        request.Status = EarlyReturnStatus.Cancelled;
        await db.SaveChangesAsync(ct);
        return await EarlyReturnRows(db.EarlyReturnRequests.Where(r => r.RequestId == requestId)).SingleAsync(ct);
    }

    /// <summary>Pending early-return requests of a facility, soonest return date first (staff return page).</summary>
    [HttpGet("facilities/{facilityId:int}/early-return-requests")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<EarlyReturnRequestDto>> FacilityEarlyReturnRequests(int facilityId, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        return await EarlyReturnRows(db.EarlyReturnRequests
            .Where(r => r.Status == EarlyReturnStatus.Pending && r.Contract.Unit.FacilityId == facilityId)
            .OrderBy(r => r.ReturnDate).ThenBy(r => r.RequestedAt)).ToListAsync(ct);
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
        var earlyReturnFees = await db.EarlyReturnRequests
            .Where(r => r.ContractId == id && r.Status == EarlyReturnStatus.Completed)
            .SumAsync(r => (decimal?)r.EarlyReturnFee, ct) ?? 0m;
        var refundable = Math.Max(0m, contract.DepositPaid - (latestOverdue?.AccumulatedLateFee ?? 0m) - earlyReturnFees);
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

    /// <summary>Contracts of one facility for staff (renewals, return, overdue). Optional status filter.</summary>
    [HttpGet("facilities/{facilityId:int}")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<StaffContractDto>> FacilityContracts(int facilityId, [FromQuery] string? status, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        var query = db.Contracts.Where(c => c.Unit.FacilityId == facilityId);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(c => c.Status == status);
        var rows = await query.OrderBy(c => c.EndDate)
            .Select(c => new
            {
                c.ContractId, c.ContractNumber, CustomerName = c.Customer.FullName, CustomerPhone = c.Customer.PhoneNumber,
                c.UnitId, c.Unit.UnitCode, UnitStatus = c.Unit.Status, c.StartDate, c.EndDate, c.MonthlyRentFee,
                c.DepositPaid, c.Status,
                HasPendingRenewal = db.ContractRenewals.Any(r => r.ContractId == c.ContractId && r.Status == "Pending"),
            })
            .ToListAsync(ct);
        return rows.Select(c => new StaffContractDto(c.ContractId, c.ContractNumber, c.CustomerName, c.CustomerPhone,
            c.UnitId, c.UnitCode, c.UnitStatus, c.StartDate, c.EndDate, c.MonthlyRentFee, c.DepositPaid, c.Status,
            c.HasPendingRenewal, c.EndDate.ToDateTime(new TimeOnly(20, 0)))).ToList();
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
                      orderby overdue.LockAppliedDate
                      select new OverdueSummaryDto(overdue.OverdueId, contract.ContractId,
                          contract.ContractNumber, customer.FullName, unit.UnitCode, contract.EndDate,
                          contract.Status, unit.Status, overdue.DaysOverdue, overdue.AccumulatedLateFee,
                          contract.DepositPaid > overdue.AccumulatedLateFee
                              ? contract.DepositPaid - overdue.AccumulatedLateFee : 0m,
                          overdue.AccumulatedLateFee > contract.DepositPaid
                              ? overdue.AccumulatedLateFee - contract.DepositPaid : 0m,
                          overdue.LockAppliedDate))
            .ToListAsync(ct);
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
        await LoadOwnAsync(id, ct);
        var person = await db.AuthorizedPersons.FirstOrDefaultAsync(p => p.ContractId == id && p.CitizenId == req.CitizenId, ct);
        if (person is null)
        {
            person = new AuthorizedPerson { ContractId = id, CitizenId = req.CitizenId };
            db.AuthorizedPersons.Add(person);
        }
        else if (person.Status == "Active")
        {
            throw AppException.Conflict("Người này đã có trong danh sách");
        }
        // Re-adding a revoked person reactivates the same row (ContractID + CitizenID is unique).
        person.FullName = req.FullName;
        person.PhoneNumber = req.PhoneNumber;
        person.Relationship = req.Relationship;
        person.Status = "Active";
        person.RevokedAt = null;
        await db.SaveChangesAsync(ct);
        return new PersonDto(person.AuthorizedPersonId, person.FullName, person.CitizenId, person.PhoneNumber, person.Relationship);
    }

    [HttpPut("{id:int}/authorized-persons/{personId:int}")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<PersonDto> UpdateAuthorizedPerson(
        int id, int personId, UpdateAuthorizedPersonRequest req, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        var person = await db.AuthorizedPersons.FirstOrDefaultAsync(
                         p => p.ContractId == id && p.AuthorizedPersonId == personId && p.Status == "Active", ct)
                     ?? throw AppException.NotFound("Không tìm thấy người được ủy quyền");
        person.FullName = req.FullName.Trim();
        person.PhoneNumber = req.PhoneNumber.Trim();
        person.Relationship = string.IsNullOrWhiteSpace(req.Relationship) ? null : req.Relationship.Trim();
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
        else if (!User.IsInRole(AppRoles.Admin))
        {
            await access.EnsureAssignedAsync(User.GetUserId(), contract.Unit.FacilityId, ct);
        }
        return await access.GetHistoryAsync(id, ct);
    }

    [HttpPost("{id:int}/visit-registrations")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<VisitRegistrationDto> CreateVisitRegistration(
        int id, CreateVisitRegistrationRequest req, CancellationToken ct) =>
        access.CreateVisitRegistrationAsync(User.GetUserId(), id, req, ct);

    [HttpGet("{id:int}/visit-registrations")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<List<VisitRegistrationDto>> MyVisitRegistrations(int id, CancellationToken ct)
    {
        if (!await db.Contracts.AnyAsync(c => c.ContractId == id && c.CustomerId == User.GetUserId(), ct))
            throw AppException.NotFound("Không tìm thấy hợp đồng");
        return await access.GetCustomerVisitRegistrationsAsync(User.GetUserId(), id, ct);
    }

    [HttpDelete("{id:int}/visit-registrations/{registrationId:long}")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<VisitRegistrationDto> CancelVisitRegistration(int id, long registrationId, CancellationToken ct) =>
        access.CancelVisitRegistrationAsync(User.GetUserId(), id, registrationId, ct);

    private async Task<Contract> LoadOwnAsync(int id, CancellationToken ct)
    {
        var me = User.GetUserId();
        return await db.Contracts.FirstOrDefaultAsync(c => c.ContractId == id && c.CustomerId == me, ct)
               ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
    }

    private async Task<decimal> EarlyReturnFeeAsync(CancellationToken ct) =>
        await db.FeeConfigurations.Where(f => f.FeeCode == "EARLY_RETURN_FEE")
            .Select(f => (decimal?)f.DefaultAmount).FirstOrDefaultAsync(ct) ?? 0m;

    /// <summary>Unpaid rent invoices for periods starting on or after the return date: no longer owed.</summary>
    private IQueryable<Invoice> BillsAfter(int contractId, DateOnly returnDate) =>
        db.Invoices.Where(i => i.ContractId == contractId && i.InvoiceType == "MONTHLY_RENT"
            && (i.Status == "Unpaid" || i.Status == "Overdue")
            && i.BillingPeriodStart != null && i.BillingPeriodStart >= returnDate);

    private async Task CancelBillsAfterAsync(Contract contract, DateOnly returnDate, string why, CancellationToken ct)
    {
        var invoiceIds = await BillsAfter(contract.ContractId, returnDate).Select(i => i.InvoiceId).ToListAsync(ct);
        // A renewal still waiting for payment no longer makes sense once the unit is handed back.
        var renewals = await db.ContractRenewals.Where(r => r.ContractId == contract.ContractId && r.Status == "Pending")
            .ToListAsync(ct);
        foreach (var renewal in renewals)
        {
            renewal.Status = "Rejected";
            renewal.ProcessedAt = clock.GetLocalNow().DateTime;
            if (renewal.InvoiceId is int renewalInvoiceId) invoiceIds.Add(renewalInvoiceId);
        }
        if (invoiceIds.Count == 0) return;
        var invoices = await db.Invoices.Where(i => invoiceIds.Contains(i.InvoiceId)
            && (i.Status == "Unpaid" || i.Status == "Overdue")).ToListAsync(ct);
        foreach (var invoice in invoices) invoice.Status = "Cancelled";
        var pendingPayments = await db.Payments.Where(p => invoiceIds.Contains(p.InvoiceId) && p.Status == "Pending")
            .ToListAsync(ct);
        foreach (var payment in pendingPayments)
        {
            payment.Status = "Failed";
            payment.PaymentNotes = $"Giao dịch bị hủy do {why}.";
        }
    }

    /// <summary>Customer: own contract. Staff/manager: assigned facility. Admin: any.</summary>
    private async Task<Contract> LoadForEarlyReturnAsync(int id, CancellationToken ct)
    {
        if (User.IsInRole(AppRoles.Customer)) return await LoadOwnAsync(id, ct);
        var contract = await db.Contracts.Include(c => c.Unit).FirstOrDefaultAsync(c => c.ContractId == id, ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        if (!User.IsInRole(AppRoles.Admin))
            await access.EnsureAssignedAsync(User.GetUserId(), contract.Unit.FacilityId, ct);
        return contract;
    }

    private static IQueryable<EarlyReturnRequestDto> EarlyReturnRows(IQueryable<EarlyReturnRequest> q) =>
        q.Select(r => new EarlyReturnRequestDto(r.RequestId, r.ContractId, r.Contract.ContractNumber, r.Contract.Unit.UnitCode,
            r.Customer.FullName, r.ReturnDate, r.Reason, r.EarlyReturnFee, r.Status, r.RequestedAt));

    private static RenewalDto ToRenewalDto(ContractRenewal r) =>
        new(r.RenewalId, r.ContractId, r.OldEndDate, r.NewEndDate, r.ExtensionMonths,
            r.RenewalFee, r.Status, r.RequestedAt, r.InvoiceId);
}
