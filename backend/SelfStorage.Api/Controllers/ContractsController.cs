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
public class ContractsController(SelfStorageDbContext db, AccessService access, TimeProvider clock) : ControllerBase
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
        var overdue = await db.OverdueRecords.Where(r => r.ContractId == id)
            .OrderByDescending(r => r.OverdueId).FirstOrDefaultAsync(ct);
        var accrued = overdue?.AccumulatedLateFee ?? 0m;
        return new ContractDetailDto(contract.ContractId, contract.ContractNumber, contract.Unit.FacilityId,
            contract.Unit.Facility.FacilityName, contract.UnitId, contract.Unit.UnitCode, contract.Unit.Status,
            contract.StartDate, contract.EndDate, contract.Status, contract.MonthlyRentFee, contract.DepositPaid,
            accrued, Math.Max(0m, contract.DepositPaid - accrued), Math.Max(0m, accrued - contract.DepositPaid),
            contract.EndDate.AddDays(-7).ToDateTime(TimeOnly.MinValue));
    }

    [HttpPost("{id:int}/renewals")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<RenewalDto> RequestRenewal(int id, RequestRenewalRequest req, CancellationToken ct)
    {
        var now = clock.GetLocalNow().DateTime;
        var today = DateOnly.FromDateTime(now);
        var contract = await db.Contracts.FirstOrDefaultAsync(c => c.ContractId == id
            && c.CustomerId == User.GetUserId(), ct) ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        if (contract.Status != ContractStatus.Active || today < contract.EndDate.AddDays(-7)
            || now >= contract.EndDate.ToDateTime(new TimeOnly(20, 0)))
            throw AppException.Conflict("Chỉ có thể yêu cầu gia hạn trong 7 ngày trước ngày hết hạn, khi hợp đồng còn hiệu lực");
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
        return ToRenewalDto(renewal);
    }

    [HttpGet("{id:int}/renewals")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<List<RenewalDto>> MyRenewals(int id, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        return await db.ContractRenewals.Where(r => r.ContractId == id).OrderByDescending(r => r.RequestedAt)
            .Select(r => new RenewalDto(r.RenewalId, r.ContractId, r.OldEndDate, r.NewEndDate,
                r.ExtensionMonths, r.RenewalFee, r.Status, r.RequestedAt)).ToListAsync(ct);
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
                r.ExtensionMonths, r.RenewalFee, r.Status, r.RequestedAt)).ToListAsync(ct);
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
        var returnAppointment = renewal.OldEndDate.ToDateTime(new TimeOnly(20, 0));
        if (clock.GetLocalNow().DateTime >= returnAppointment)
            throw AppException.Conflict("Đã quá hạn gia hạn; nhân viên không thể xác nhận yêu cầu này");
        if (renewal.Status != "Pending" || contract.Status != ContractStatus.Active
            || contract.EndDate != renewal.OldEndDate)
            throw AppException.Conflict("Yêu cầu gia hạn không còn chờ thanh toán");

        var now = clock.GetLocalNow().DateTime;
        renewal.Status = "Paid";
        renewal.ApprovedByStaffId = User.GetUserId();
        renewal.ProcessedAt = now;
        contract.EndDate = renewal.NewEndDate;
        contract.Unit.Status = UnitStatus.Rented;
        await db.SaveChangesAsync(ct);
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
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("{id:int}/return")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<ReturnUnitDto> ReturnUnit(int id, ReturnUnitRequest req, CancellationToken ct)
    {
        var contract = await db.Contracts.Include(c => c.Unit)
            .FirstOrDefaultAsync(c => c.ContractId == id, ct) ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        var staffId = User.GetUserId();
        await access.EnsureAssignedAsync(staffId, contract.Unit.FacilityId, ct);
        var now = clock.GetLocalNow().DateTime;
        var returnAppointment = contract.EndDate.ToDateTime(new TimeOnly(20, 0));
        if (now < returnAppointment)
            throw AppException.Conflict($"Lịch trả kho là 20:00 ngày {contract.EndDate:dd/MM/yyyy}");
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
            UnitConditionNotes = $"Đã xác nhận dọn sạch kho. {req.UnitConditionNotes}",
            CustomerSignatureConfirmed = true,
            StaffNotes = req.StaffNotes,
        });
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
        await db.SaveChangesAsync(ct);
        return new ReturnUnitDto(id, contract.Status, contract.Unit.Status, contract.DepositPaid,
            deducted, refund, stillOwed, now);
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
        new(r.RenewalId, r.ContractId, r.OldEndDate, r.NewEndDate, r.ExtensionMonths, r.RenewalFee, r.Status, r.RequestedAt);
}
