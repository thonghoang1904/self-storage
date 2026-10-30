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

    public async Task<VisitRegistrationDto> CreateVisitRegistrationAsync(
        int customerId, int contractId, CreateVisitRegistrationRequest req, CancellationToken ct)
    {
        var contract = await db.Contracts.Include(c => c.Unit).Include(c => c.Customer)
            .Include(c => c.AuthorizedPersons)
            .FirstOrDefaultAsync(c => c.ContractId == contractId && c.CustomerId == customerId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng đang thuê");
        var contractIssues = await FindIssuesAsync(contract, ct);
        if (contract.Status != ContractStatus.Active || contractIssues.Count > 0)
            throw AppException.Conflict(contractIssues.Count > 0
                ? $"Chưa thể đăng ký ra/vào: {contractIssues[0].Message}"
                : "Chỉ khách có hợp đồng đang hoạt động và kho không bị khóa mới đăng ký ra/vào");
        var expectedCitizenId = ResolveVisitor(contract, req.AuthorizedPersonId);
        if (string.IsNullOrWhiteSpace(expectedCitizenId)
            || Contact.NormalizeCitizenId(req.CitizenId) != Contact.NormalizeCitizenId(expectedCitizenId))
            throw AppException.BadRequest("CCCD không khớp với khách thuê hoặc người được ủy quyền trên hợp đồng");

        var now = clock.GetUtcNow();
        var localEntry = TimeZoneInfo.ConvertTime(req.ScheduledEntryAt, clock.LocalTimeZone).DateTime;
        var localExit = TimeZoneInfo.ConvertTime(req.ScheduledExitAt, clock.LocalTimeZone).DateTime;
        if (req.ScheduledEntryAt <= now || req.ScheduledExitAt <= req.ScheduledEntryAt)
            throw AppException.BadRequest("Giờ ra/vào phải hợp lệ và nằm trong tương lai");
        if (DateOnly.FromDateTime(localEntry) < contract.StartDate
            || DateOnly.FromDateTime(localEntry) > contract.EndDate
            || DateOnly.FromDateTime(localExit) > contract.EndDate
            || (DateOnly.FromDateTime(localExit) == contract.EndDate
                && TimeOnly.FromDateTime(localExit) >= new TimeOnly(20, 0)))
            throw AppException.BadRequest("Thời gian đăng ký phải nằm trong thời hạn hợp đồng");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var overlaps = await db.VisitRegistrations.AnyAsync(v =>
            v.ContractId == contractId && v.CustomerId == customerId
            && (v.Status == "Pending" || v.Status == "Approved")
            && v.ScheduledEntryAt < req.ScheduledExitAt
            && req.ScheduledEntryAt < v.ScheduledExitAt, ct);
        if (overlaps)
            throw AppException.Conflict("Bạn đã có lịch ra/vào đang chờ duyệt hoặc được duyệt trong khung giờ này");

        var registration = new VisitRegistration
        {
            ContractId = contractId,
            CustomerId = customerId,
            AuthorizedPersonId = req.AuthorizedPersonId,
            ScheduledEntryAt = req.ScheduledEntryAt,
            ScheduledExitAt = req.ScheduledExitAt,
            Purpose = req.Purpose.Trim(),
            RequestedAt = Now,
        };
        db.VisitRegistrations.Add(registration);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await ProjectVisitRegistrations(db.VisitRegistrations
            .Where(v => v.VisitRegistrationId == registration.VisitRegistrationId)).SingleAsync(ct);
    }

    public async Task<VisitRegistrationDto> CancelVisitRegistrationAsync(
        int customerId, int contractId, long registrationId, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var registration = await db.VisitRegistrations.Include(v => v.Contract)
            .FirstOrDefaultAsync(v => v.VisitRegistrationId == registrationId
                && v.ContractId == contractId && v.CustomerId == customerId, ct)
            ?? throw AppException.NotFound("Không tìm thấy lịch ra/vào");
        if (registration.Status != "Pending")
            throw AppException.Conflict("Chỉ có thể hủy lịch đang chờ staff duyệt");
        registration.Status = "Cancelled";
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await ProjectVisitRegistrations(db.VisitRegistrations
            .Where(v => v.VisitRegistrationId == registrationId)).SingleAsync(ct);
    }

    public Task<List<VisitRegistrationDto>> GetCustomerVisitRegistrationsAsync(
        int customerId, int contractId, CancellationToken ct) =>
        ProjectVisitRegistrations(db.VisitRegistrations
                .Where(v => v.ContractId == contractId && v.CustomerId == customerId)
                .OrderByDescending(v => v.ScheduledEntryAt))
            .ToListAsync(ct);

    public async Task<List<VisitRegistrationDto>> GetFacilityVisitRegistrationsAsync(
        int staffId, int facilityId, string? status, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        if (!string.IsNullOrWhiteSpace(status)
            && status is not ("Pending" or "Approved" or "Rejected" or "Cancelled"))
            throw AppException.BadRequest("Trạng thái lịch ra/vào không hợp lệ");
        var q = db.VisitRegistrations.Where(v => v.Contract.Unit.FacilityId == facilityId);
        if (!string.IsNullOrWhiteSpace(status))
            q = q.Where(v => v.Status == status);
        return await ProjectVisitRegistrations(q.OrderBy(v => v.ScheduledEntryAt)).ToListAsync(ct);
    }

    public async Task<VisitRegistrationDto> ReviewVisitRegistrationAsync(
        int staffId, int facilityId, long registrationId, ReviewVisitRegistrationRequest req, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var registration = await db.VisitRegistrations.Include(v => v.Contract).ThenInclude(c => c.Unit)
            .FirstOrDefaultAsync(v => v.VisitRegistrationId == registrationId
                && v.Contract.Unit.FacilityId == facilityId, ct)
            ?? throw AppException.NotFound("Không tìm thấy lịch ra/vào tại cơ sở này");
        if (registration.Status != "Pending")
            throw AppException.Conflict("Lịch ra/vào này đã được staff xử lý");
        var approve = req.Approve == true;
        if (!approve && string.IsNullOrWhiteSpace(req.Notes))
            throw AppException.BadRequest("Vui lòng ghi lý do từ chối lịch ra/vào để khách biết");
        if (approve)
        {
            if (registration.ScheduledEntryAt <= clock.GetUtcNow())
                throw AppException.Conflict("Không thể duyệt lịch đã qua giờ vào dự kiến");
            if (registration.Contract.Status != ContractStatus.Active
                || (await FindIssuesAsync(registration.Contract, ct)).Count > 0)
                throw AppException.Conflict("Hợp đồng hoặc kho không còn đủ điều kiện ra/vào");
            var overlap = await db.VisitRegistrations.AnyAsync(v =>
                v.ContractId == registration.ContractId
                && v.VisitRegistrationId != registrationId
                && v.Status == "Approved"
                && v.ScheduledEntryAt < registration.ScheduledExitAt
                && registration.ScheduledEntryAt < v.ScheduledExitAt, ct);
            if (overlap)
                throw AppException.Conflict("Khung giờ này bị trùng với một lịch ra/vào đã được duyệt");
        }

        registration.Status = approve ? "Approved" : "Rejected";
        registration.ReviewedByStaffId = staffId;
        registration.ReviewedAt = Now;
        registration.ReviewNotes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = staffId,
            Action = approve ? "VisitRegistrationApproved" : "VisitRegistrationRejected",
            Details = $"VisitRegistration {registrationId} for contract {registration.Contract.ContractNumber}",
            CreatedAt = Now,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await ProjectVisitRegistrations(db.VisitRegistrations
            .Where(v => v.VisitRegistrationId == registrationId)).SingleAsync(ct);
    }

    // ---------------------------------------------------------------- lookup

    /// <summary>Find contracts at this facility by unit code, contract number, CCCD or phone of the customer or an authorized person.</summary>
    public async Task<IReadOnlyList<VisitCandidateDto>> LookupAsync(int staffId, int facilityId, string query, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        // Partial, case-insensitive match (SQL Server's default collation ignores case): "a" finds A-01, A-02…;
        // "0912" finds every phone or CCCD containing it.
        var q = (query ?? "").Trim();
        if (q.Length == 0) throw AppException.BadRequest("Nhập mã kho, số hợp đồng, CCCD hoặc số điện thoại để tìm");
        if (q.Length > 50) q = q[..50];
        // CCCD / phone are stored normalized; staff may type them with spaces, dots or +84.
        var qCitizen = Contact.NormalizeCitizenId(q);
        var qPhone = Contact.NormalizePhone(q);
        if (qCitizen.Length == 0) qCitizen = q;
        if (qPhone.Length == 0) qPhone = q;

        var contracts = await db.Contracts
            .Include(c => c.Unit)
            .Include(c => c.Customer)
            .Include(c => c.AuthorizedPersons)
            .Where(c => c.Unit.FacilityId == facilityId)
            .Where(c => c.Unit.UnitCode.Contains(q) || c.ContractNumber.Contains(q)
                        || c.Customer.FullName.Contains(q)
                        || (c.Customer.CitizenId != null && c.Customer.CitizenId.Contains(qCitizen))
                        || c.Customer.PhoneNumber.Contains(qPhone)
                        || c.AuthorizedPersons.Any(p => p.Status == "Active"
                            && (p.CitizenId.Contains(qCitizen) || (p.PhoneNumber != null && p.PhoneNumber.Contains(qPhone))
                                || p.FullName.Contains(q))))
            // Exact code/number first, then units in code order; the newest term first within a unit.
            .OrderByDescending(c => c.Unit.UnitCode == q || c.ContractNumber == q)
            .ThenBy(c => c.Unit.UnitCode)
            .ThenByDescending(c => c.EndDate)
            .Take(20)
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
        var now = clock.GetUtcNow();
        var approvedRegistrations = await db.VisitRegistrations
            .Where(v => ids.Contains(v.ContractId) && v.Status == "Approved"
                && v.ScheduledEntryAt <= now && v.ScheduledExitAt >= now)
            .Select(v => new { v.ContractId, v.AuthorizedPersonId })
            .ToListAsync(ct);

        return contracts.Select(c =>
        {
            var issues = FindIssues(c, unpaid.Contains(c.ContractId));
            var hasApprovedVisitRegistration = approvedRegistrations.Any(v =>
                v.ContractId == c.ContractId
                && (v.AuthorizedPersonId is null
                    || c.AuthorizedPersons.Any(p => p.AuthorizedPersonId == v.AuthorizedPersonId && p.Status == "Active")));
            return new VisitCandidateDto(
                c.ContractId, c.ContractNumber, c.Status, c.StartDate, c.EndDate, c.Unit.UnitCode, c.Unit.Status,
                new PersonDto(null, c.Customer.FullName, c.Customer.CitizenId, c.Customer.PhoneNumber, "Chủ hợp đồng"),
                c.AuthorizedPersons.Where(p => p.Status == "Active")
                    .Select(p => new PersonDto(p.AuthorizedPersonId, p.FullName, p.CitizenId, p.PhoneNumber, p.Relationship))
                    .ToList(),
                inside.Where(i => i.ContractId == c.ContractId).Select(i => i.Name).ToList(),
                issues,
                hasApprovedVisitRegistration,
                issues.Count == 0 && hasApprovedVisitRegistration,
                c.CustomerId);
        }).ToList();
    }

    // ---------------------------------------------------------------- entry / exit

    public async Task<AccessRecordDto> GrantEntryAsync(int staffId, int facilityId, GrantEntryRequest req, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        var contract = await LoadContractAsync(facilityId, req.ContractId, ct);

        var issues = await FindIssuesAsync(contract, ct);
        if (issues.Count > 0)
            throw AppException.Conflict($"Không thể cho vào: {issues[0].Message}. Hãy ghi nhận từ chối với lý do {issues[0].Code}.");

        var expectedCitizenId = ResolveVisitor(contract, req.AuthorizedPersonId);

        // Staff types the number printed on the visitor's CCCD; it must match what we have on file.
        if (string.IsNullOrWhiteSpace(expectedCitizenId))
            throw AppException.BadRequest("Người này chưa có số CCCD trong hồ sơ, không thể xác thực. Hãy từ chối với lý do IdentityMismatch.");
        if (Contact.NormalizeCitizenId(req.CitizenId) != Contact.NormalizeCitizenId(expectedCitizenId))
            throw AppException.BadRequest("Số CCCD không khớp với hồ sơ. Hãy kiểm tra lại hoặc từ chối với lý do IdentityMismatch.");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var registration = await db.VisitRegistrations.FirstOrDefaultAsync(v =>
            v.VisitRegistrationId == req.VisitRegistrationId
            && v.ContractId == contract.ContractId
            && v.Status == "Approved", ct)
            ?? throw AppException.Conflict("Không tìm thấy lịch ra/vào đã được staff duyệt cho hợp đồng này");
        var now = clock.GetUtcNow();
        if (now < registration.ScheduledEntryAt || now > registration.ScheduledExitAt)
            throw AppException.Conflict(
                $"Chỉ được vào trong khung giờ đã đăng ký: {registration.ScheduledEntryAt:dd/MM/yyyy HH:mm} - {registration.ScheduledExitAt:dd/MM/yyyy HH:mm}");
        if (registration.CustomerId != contract.CustomerId
            || registration.AuthorizedPersonId != req.AuthorizedPersonId)
            throw AppException.Forbidden("Lịch đăng ký không thuộc khách thuê của hợp đồng");
        if (await db.AccessRecords.AnyAsync(r => r.VisitRegistrationId == registration.VisitRegistrationId
            && r.Result == AccessResult.Granted, ct))
            throw AppException.Conflict("Lịch ra/vào này đã được sử dụng");

        // The same visitor (customer or this authorized person) must not be inside already.
        var alreadyInside = await db.AccessRecords.AnyAsync(r => r.ContractId == contract.ContractId
            && r.AuthorizedPersonId == req.AuthorizedPersonId
            && r.Result == AccessResult.Granted && r.ExitTime == null, ct);
        if (alreadyInside)
            throw AppException.Conflict("Người này đang ở trong kho, hãy xác nhận ra trước");

        var record = new AccessRecord
        {
            ContractId = contract.ContractId,
            VisitRegistrationId = registration.VisitRegistrationId,
            FacilityId = facilityId,
            UnitId = contract.UnitId,
            AuthorizedPersonId = req.AuthorizedPersonId,
            VerifiedByStaffId = staffId,
            VerificationMethod = VerificationMethods.CitizenId,
            Result = AccessResult.Granted,
            Purpose = req.Purpose,
            EntryTime = Now,
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

    public async Task<IReadOnlyList<AccessRecordDto>> GetTodayAsync(int staffId, int facilityId, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        var today = Now.Date;
        return await ProjectRecords(db.AccessRecords
                .Where(r => r.FacilityId == facilityId && r.EntryTime >= today)
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
    /// Staff checked the customer's ID card in person and records (or corrects) the CCCD on file; customers cannot
    /// change a CCCD themselves. Only for customers with a reservation or contract at this facility; the change is logged.
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

    private async Task<List<AccessIssueDto>> FindIssuesAsync(Contract c, CancellationToken ct) =>
        FindIssues(c, (await ContractsWithOverdueBillsAsync(c.Unit.FacilityId, [c.ContractId], ct)).Count > 0);

    /// <summary>Reasons the contract's unit cannot be opened right now; codes match AccessRecords.DenyReason.</summary>
    private List<AccessIssueDto> FindIssues(Contract c, bool hasOverdueBills)
    {
        var today = DateOnly.FromDateTime(Now);
        var issues = new List<AccessIssueDto>();

        if (c.Status is ContractStatus.Terminated or ContractStatus.Liquidated
            || Now >= c.EndDate.ToDateTime(new TimeOnly(20, 0)))
            issues.Add(new("ContractEnded", "Hợp đồng đã kết thúc"));
        else if (c.StartDate > today)
            issues.Add(new("ContractEnded", $"Hợp đồng chưa bắt đầu (từ {c.StartDate:dd/MM/yyyy})"));

        if (c.Status == ContractStatus.Overdue || c.Unit.Status == UnitStatus.OverdueLocked)
            issues.Add(new("OverdueLocked", "Hợp đồng quá hạn thanh toán, kho đang bị khóa"));
        else if (hasOverdueBills)
            issues.Add(new("OverdueLocked", "Còn hóa đơn tiền thuê/phụ thu quá hạn thanh toán; khách cần thanh toán trước khi vào kho"));
        if (c.Unit.Status == UnitStatus.UnderMaintenance)
            issues.Add(new("UnitUnderMaintenance", "Kho đang bảo trì"));
        return issues;
    }

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

    private static IQueryable<VisitRegistrationDto> ProjectVisitRegistrations(IQueryable<VisitRegistration> q) =>
        q.Select(v => new VisitRegistrationDto(
            v.VisitRegistrationId,
            v.ContractId,
            v.Contract.ContractNumber,
            v.Contract.Unit.FacilityId,
            v.Contract.Unit.UnitCode,
            v.AuthorizedPersonId,
            v.AuthorizedPerson != null ? v.AuthorizedPerson.FullName : v.Customer.FullName,
            v.ScheduledEntryAt,
            v.ScheduledExitAt,
            v.Purpose,
            v.Status,
            v.RequestedAt,
            v.ReviewedAt,
            v.ReviewNotes));

    private static IQueryable<AccessRecordDto> ProjectRecords(IQueryable<AccessRecord> q) =>
        q.Select(r => new AccessRecordDto(
            r.AccessRecordId,
            r.VisitRegistrationId,
            r.Unit.UnitCode,
            r.Contract.ContractNumber,
            r.AuthorizedPerson != null ? r.AuthorizedPerson.FullName : r.Contract.Customer.FullName,
            r.Result,
            r.DenyReason,
            r.Purpose,
            r.EntryTime,
            r.ExitTime,
            r.VerifiedByStaff.FullName));
}
