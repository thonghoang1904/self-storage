using System.Data;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Services;

/// <summary>
/// Entry/exit verified by staff only (no PIN), stored in AccessRecords exactly as the original schema allows:
/// the visitor arrives -> staff looks up the contract and checks the ID card -> Granted or Denied row
/// -> staff confirms exit (ExitTime). "Waiting for verification" exists only on the staff screen.
/// </summary>
public class AccessService(SelfStorageDbContext db, RentalPolicyService rentalPolicies, TimeProvider clock)
{
    private DateTime Now => clock.GetLocalNow().DateTime;   // DB defaults use SYSDATETIME() (server local time)

    /// <summary>How far back staff may record an entry that already happened (e.g. across midnight).</summary>
    private static readonly TimeSpan MaxEntryBackdate = TimeSpan.FromHours(12);

    // ---------------------------------------------------------------- lookup

    /// <summary>Find contracts at this facility by unit code, contract number, CCCD or phone of the customer or an authorized person.</summary>
    public async Task<IReadOnlyList<VisitCandidateDto>> LookupAsync(int staffId, int facilityId, string query, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        var q = query.Trim();
        if (q.Length < 2) throw AppException.BadRequest("Nhập ít nhất 2 ký tự để tìm");
        // CCCD / phone are stored normalized; staff may type them with spaces, dots or +84.
        var people = new[] { q, Contact.NormalizeCitizenId(q), Contact.NormalizePhone(q) }.Distinct().ToList();

        var contracts = await db.Contracts
            .Include(c => c.Unit)
            .Include(c => c.Customer)
            .Include(c => c.AuthorizedPersons)
            .Where(c => c.Unit.FacilityId == facilityId)
            .Where(c => c.Unit.UnitCode == q || c.ContractNumber == q
                        || people.Contains(c.Customer.CitizenId!) || people.Contains(c.Customer.PhoneNumber)
                        || c.AuthorizedPersons.Any(p => p.Status == "Active"
                            && (people.Contains(p.CitizenId) || people.Contains(p.PhoneNumber))))
            .OrderByDescending(c => c.EndDate)
            .Take(10)
            .ToListAsync(ct);

        var ids = contracts.Select(c => c.ContractId).ToList();
        var unpaid = await ContractsWithOverdueBillsAsync(facilityId, ids, ct);
        var inside = await db.AccessRecords
            .Where(r => ids.Contains(r.ContractId) && r.Result == AccessResult.Granted && r.ExitTime == null)
            .Select(r => new
            {
                r.ContractId,
                Name = r.AuthorizedPerson != null ? r.AuthorizedPerson.FullName : r.Contract.Customer.FullName,
            })
            .ToListAsync(ct);

        return contracts.Select(c =>
        {
            var issues = FindIssues(c, unpaid.Contains(c.ContractId));
            return new VisitCandidateDto(
                c.ContractId, c.ContractNumber, c.Status, c.StartDate, c.EndDate, c.Unit.UnitCode, c.Unit.Status,
                new PersonDto(null, c.Customer.FullName, c.Customer.CitizenId, c.Customer.PhoneNumber, "Chủ hợp đồng"),
                c.AuthorizedPersons.Where(p => p.Status == "Active")
                    .Select(p => new PersonDto(p.AuthorizedPersonId, p.FullName, p.CitizenId, p.PhoneNumber, p.Relationship))
                    .ToList(),
                inside.Where(i => i.ContractId == c.ContractId).Select(i => i.Name).ToList(),
                issues,
                issues.Count == 0,
                CanMoveOut(issues),
                c.CustomerId);
        }).ToList();
    }

    // ---------------------------------------------------------------- entry / exit

    public async Task<AccessRecordDto> GrantEntryAsync(int staffId, int facilityId, GrantEntryRequest req, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        var contract = await LoadContractAsync(facilityId, req.ContractId, ct);

        var unpaid = await ContractsWithOverdueBillsAsync(facilityId, [contract.ContractId], ct);
        var issues = FindIssues(contract, unpaid.Contains(contract.ContractId));
        if (issues.Count > 0 && !(req.MoveOut && CanMoveOut(issues)))
        {
            var blocking = issues.FirstOrDefault(i => !i.MoveOutAllowed) ?? issues[0];
            var hint = CanMoveOut(issues) ? " Nếu khách đến dọn kho để trả kho, hãy chọn \"Cho vào dọn kho\"." : "";
            throw AppException.Conflict(
                $"Không thể cho vào: {blocking.Message}. Hãy ghi nhận từ chối với lý do {blocking.Code}.{hint}");
        }

        var expectedCitizenId = ResolveVisitor(contract, req.AuthorizedPersonId);

        // Staff types the number printed on the visitor's CCCD; it must match what we have on file.
        if (string.IsNullOrWhiteSpace(expectedCitizenId))
            throw AppException.BadRequest("Người này chưa có số CCCD trong hồ sơ, không thể xác thực. Hãy từ chối với lý do IdentityMismatch.");
        if (Contact.NormalizeCitizenId(req.CitizenId) != Contact.NormalizeCitizenId(expectedCitizenId))
            throw AppException.BadRequest("Số CCCD không khớp với hồ sơ. Hãy kiểm tra lại hoặc từ chối với lý do IdentityMismatch.");

        var entryTime = req.EntryTime ?? Now;
        if (entryTime > Now.AddMinutes(1))
            throw AppException.BadRequest("Giờ vào kho không được ở tương lai");
        // 24/7: an entry just before midnight can still be recorded after it, so the limit is hours, not "today".
        if (entryTime < Now - MaxEntryBackdate)
            throw AppException.BadRequest(
                $"Chỉ được ghi bù giờ vào kho trong vòng {MaxEntryBackdate.TotalHours:0} giờ trước");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var alreadyInside = await db.AccessRecords.AnyAsync(r => r.ContractId == contract.ContractId
            && r.AuthorizedPersonId == req.AuthorizedPersonId
            && r.Result == AccessResult.Granted && r.ExitTime == null, ct);
        if (alreadyInside)
            throw AppException.Conflict("Người này đang ở trong kho, hãy xác nhận ra trước");

        var record = new AccessRecord
        {
            ContractId = contract.ContractId,
            FacilityId = facilityId,
            UnitId = contract.UnitId,
            AuthorizedPersonId = req.AuthorizedPersonId,
            VerifiedByStaffId = staffId,
            VerificationMethod = VerificationMethods.CitizenId,
            Result = AccessResult.Granted,
            Purpose = issues.Count > 0
                ? $"Dọn kho để trả kho. {req.Purpose}".Trim()
                : req.Purpose,
            CompanionCount = req.CompanionCount,
            EntryTime = entryTime,
            Notes = req.Notes,
        };
        db.AccessRecords.Add(record);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await GetRecordDtoAsync(record.AccessRecordId, ct);
    }

    public async Task<AccessRecordDto> DenyEntryAsync(int staffId, int facilityId, DenyEntryRequest req, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        if (!DenyReasons.All.Contains(req.Reason))
            throw AppException.BadRequest("Lý do không hợp lệ: " + string.Join(", ", DenyReasons.All));

        var contract = await LoadContractAsync(facilityId, req.ContractId, ct);
        if (req.AuthorizedPersonId is not null) ResolveVisitor(contract, req.AuthorizedPersonId);

        var record = new AccessRecord
        {
            ContractId = contract.ContractId,
            FacilityId = facilityId,
            UnitId = contract.UnitId,
            AuthorizedPersonId = req.AuthorizedPersonId,
            VerifiedByStaffId = staffId,
            VerificationMethod = VerificationMethods.CitizenId,
            Result = AccessResult.Denied,
            DenyReason = req.Reason,
            EntryTime = Now,   // time of the attempt
            Notes = req.Notes,
        };
        db.AccessRecords.Add(record);
        await db.SaveChangesAsync(ct);
        return await GetRecordDtoAsync(record.AccessRecordId, ct);
    }

    public async Task<IReadOnlyList<AccessRecordDto>> GetInsideAsync(int staffId, int facilityId, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        return await ProjectRecords(db.AccessRecords
                .Where(r => r.FacilityId == facilityId && r.Result == AccessResult.Granted && r.ExitTime == null)
                .OrderBy(r => r.EntryTime))
            .ToListAsync(ct);
    }

    /// <summary>Entries and denials of the last 24 hours, so a night shift is not cut in two at midnight.</summary>
    public async Task<IReadOnlyList<AccessRecordDto>> GetTodayAsync(int staffId, int facilityId, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        var since = Now.AddHours(-24);
        return await ProjectRecords(db.AccessRecords
                .Where(r => r.FacilityId == facilityId && r.EntryTime >= since)
                .OrderByDescending(r => r.EntryTime))
            .ToListAsync(ct);
    }

    public async Task<AccessRecordDto> ConfirmExitAsync(int staffId, long accessRecordId, CancellationToken ct)
    {
        var record = await db.AccessRecords.FirstOrDefaultAsync(r => r.AccessRecordId == accessRecordId, ct)
                     ?? throw AppException.NotFound("Không tìm thấy lượt ra vào");
        await EnsureAssignedAsync(staffId, record.FacilityId, ct);

        if (record.Result != AccessResult.Granted || record.ExitTime is not null)
            throw AppException.Conflict("Lượt này không ở trạng thái đang ở trong kho");

        record.ExitTime = Now;
        record.ExitConfirmedByStaffId = staffId;
        await db.SaveChangesAsync(ct);
        return await GetRecordDtoAsync(record.AccessRecordId, ct);
    }

    public Task<List<AccessRecordDto>> GetHistoryAsync(int contractId, CancellationToken ct) =>
        ProjectRecords(db.AccessRecords
                .Where(r => r.ContractId == contractId)
                .OrderByDescending(r => r.AccessRecordId)
                .Take(100))
            .ToListAsync(ct);

    // ---------------------------------------------------------------- helpers

    public Task<List<FacilityDto>> GetAssignedFacilitiesAsync(int staffId, CancellationToken ct) =>
        db.FacilityStaffAssignments
            .Where(a => a.StaffId == staffId && a.Status == "Active")
            .Select(a => a.Facility)
            .Select(f => new FacilityDto(f.FacilityId, f.FacilityName, f.Address, f.City, f.District,
                f.Hotline, f.OperatingHours, f.Status))
            .ToListAsync(ct);

    public async Task EnsureAssignedAsync(int staffId, int facilityId, CancellationToken ct)
    {
        var assigned = await db.FacilityStaffAssignments
            .AnyAsync(a => a.StaffId == staffId && a.FacilityId == facilityId && a.Status == "Active", ct);
        if (!assigned) throw AppException.Forbidden("Bạn không được phân công tại cơ sở này");
    }

    /// <summary>
    /// Staff checked the customer's ID card in person and records the CCCD on file (customers cannot change a
    /// CCCD themselves). Only for customers with a reservation or contract at this facility; the change is logged.
    /// </summary>
    public async Task<PersonDto> UpdateCustomerCitizenIdAsync(
        int staffId, int facilityId, int customerId, UpdateCustomerCitizenIdRequest req, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        var isCustomerHere = await db.Contracts.AnyAsync(c => c.CustomerId == customerId && c.Unit.FacilityId == facilityId, ct)
            || await db.Reservations.AnyAsync(r => r.CustomerId == customerId && r.FacilityId == facilityId, ct);
        var customer = isCustomerHere
            ? await db.Users.FirstOrDefaultAsync(u => u.UserId == customerId && u.Role.RoleName == AppRoles.Customer, ct)
            : null;
        if (customer is null) throw AppException.NotFound("Không tìm thấy khách hàng tại cơ sở này");

        var citizenId = Contact.NormalizeCitizenId(req.CitizenId);
        if (await db.Users.AnyAsync(u => u.CitizenId == citizenId && u.UserId != customerId, ct))
            throw AppException.Conflict("Số CCCD đã được đăng ký cho tài khoản khác");
        var previous = customer.CitizenId;
        customer.CitizenId = citizenId;
        customer.UpdatedAt = Now;
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = staffId,
            Action = "CustomerCitizenIdUpdated",
            Details = $"Customer {customerId}: {previous ?? "(trống)"} -> {citizenId}"
                + (string.IsNullOrWhiteSpace(req.Notes) ? "" : $". {req.Notes.Trim()}"),
            CreatedAt = Now,
        });
        await db.SaveChangesAsync(ct);
        return new PersonDto(null, customer.FullName, customer.CitizenId, customer.PhoneNumber, "Chủ hợp đồng");
    }

    /// <summary>
    /// Contracts with rent or extra charges unpaid for longer than the facility's MaxOverdueDaysBeforeLock:
    /// the unit stays closed until they are paid.
    /// </summary>
    private async Task<HashSet<int>> ContractsWithOverdueBillsAsync(
        int facilityId, IReadOnlyCollection<int> contractIds, CancellationToken ct)
    {
        if (contractIds.Count == 0) return [];
        var policy = await rentalPolicies.ForFacilityAsync(facilityId, ct);
        var dueBefore = DateOnly.FromDateTime(Now).AddDays(-policy.MaxOverdueDaysBeforeLock);
        var ids = await db.Invoices
            .Where(i => i.ContractId != null && contractIds.Contains(i.ContractId.Value)
                && (i.Status == "Unpaid" || i.Status == "Overdue")
                && (i.InvoiceType == "MONTHLY_RENT" || i.InvoiceType == "EXTRA_CHARGE")
                && i.DueDate < dueBefore)
            .Select(i => i.ContractId!.Value)
            .Distinct()
            .ToListAsync(ct);
        return ids.ToHashSet();
    }

    /// <summary>
    /// Reasons the contract's unit cannot be opened right now; codes match AccessRecords.DenyReason.
    /// An expired or overdue-locked contract that was not returned yet still lets the visitor in to empty the unit,
    /// but not while rent or extra charges are overdue: those must be paid first.
    /// </summary>
    private List<AccessIssueDto> FindIssues(Contract c, bool hasOverdueBills)
    {
        var today = DateOnly.FromDateTime(Now);
        var issues = new List<AccessIssueDto>();

        if (c.Status is ContractStatus.Terminated or ContractStatus.Liquidated)
            issues.Add(new("ContractEnded", "Hợp đồng đã kết thúc"));
        else if (Now >= ContractSchedule.ExpiresAt(c.EndDate, c.SignedDate))
            issues.Add(new("ContractEnded", "Hợp đồng đã hết hạn, chưa gia hạn hoặc trả kho", MoveOutAllowed: true));
        else if (c.StartDate > today)
            issues.Add(new("ContractEnded", $"Hợp đồng chưa bắt đầu (từ {c.StartDate:dd/MM/yyyy})"));

        if (c.Status == ContractStatus.Overdue || c.Unit.Status == UnitStatus.OverdueLocked)
            issues.Add(new("OverdueLocked", "Hợp đồng đã quá hạn mà chưa gia hạn hoặc trả kho, kho đang bị khóa",
                MoveOutAllowed: c.Status is ContractStatus.Active or ContractStatus.Overdue));
        if (hasOverdueBills && c.Status is ContractStatus.Active or ContractStatus.Overdue)
            issues.Add(new("OverdueLocked", "Còn hóa đơn tiền thuê/phụ thu quá hạn thanh toán; khách cần thanh toán trước khi vào kho"));
        if (c.Unit.Status == UnitStatus.UnderMaintenance)
            issues.Add(new("UnitUnderMaintenance", "Kho đang bảo trì"));
        return issues;
    }

    private static bool CanMoveOut(List<AccessIssueDto> issues) =>
        issues.Count > 0 && issues.All(i => i.MoveOutAllowed);

    private async Task<Contract> LoadContractAsync(int facilityId, int contractId, CancellationToken ct) =>
        await db.Contracts
            .Include(c => c.Unit)
            .Include(c => c.Customer)
            .Include(c => c.AuthorizedPersons)
            .FirstOrDefaultAsync(c => c.ContractId == contractId && c.Unit.FacilityId == facilityId, ct)
        ?? throw AppException.NotFound("Không tìm thấy hợp đồng tại cơ sở này");

    /// <summary>Returns the CCCD on file for the visitor (customer, or an active authorized person).</summary>
    private static string? ResolveVisitor(Contract contract, int? authorizedPersonId)
    {
        if (authorizedPersonId is null) return contract.Customer.CitizenId;
        var person = contract.AuthorizedPersons
                         .FirstOrDefault(p => p.AuthorizedPersonId == authorizedPersonId && p.Status == "Active")
                     ?? throw AppException.BadRequest("Người này không có trong danh sách được ủy quyền của hợp đồng");
        return person.CitizenId;
    }

    private Task<AccessRecordDto> GetRecordDtoAsync(long id, CancellationToken ct) =>
        ProjectRecords(db.AccessRecords.Where(r => r.AccessRecordId == id)).FirstAsync(ct);

    private static IQueryable<AccessRecordDto> ProjectRecords(IQueryable<AccessRecord> q) =>
        q.Select(r => new AccessRecordDto(
            r.AccessRecordId,
            r.Unit.UnitCode,
            r.Contract.ContractNumber,
            r.AuthorizedPerson != null ? r.AuthorizedPerson.FullName : r.Contract.Customer.FullName,
            r.Result,
            r.DenyReason,
            r.Purpose,
            r.CompanionCount,
            r.EntryTime,
            r.ExitTime,
            r.VerifiedByStaff.FullName));
}
