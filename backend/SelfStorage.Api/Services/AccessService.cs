using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Services;

public class AccessOptions
{
    /// <summary>Wrong PIN attempts before the contract's PIN is locked.</summary>
    public int MaxPinAttempts { get; set; } = 5;
    public int PinLockMinutes { get; set; } = 15;
    /// <summary>A PIN entry nobody verified within this time expires and the visitor must re-enter.</summary>
    public int PendingTimeoutMinutes { get; set; } = 15;
}

/// <summary>
/// Entry/exit flow: PIN at the kiosk -> Pending -> staff checks ID -> Granted/Denied -> staff confirms exit.
/// </summary>
public class AccessService(SelfStorageDbContext db, PinService pins, IOptions<AccessOptions> options, TimeProvider clock)
{
    private readonly AccessOptions _opt = options.Value;
    private DateTime Now => clock.GetLocalNow().DateTime;   // DB defaults use SYSDATETIME() (server local time)

    private static readonly string[] UsableContractStatuses =
        [ContractStatus.Active, ContractStatus.Renewed, ContractStatus.Overdue];

    // ---------------------------------------------------------------- kiosk

    public async Task<KioskRequestStatus> EnterPinAsync(int facilityId, KioskPinRequest req, CancellationToken ct)
    {
        const string wrong = "Mã kho hoặc PIN không đúng";
        var today = DateOnly.FromDateTime(Now);

        var contract = await db.Contracts
            .Include(c => c.Unit)
            .Where(c => c.Unit.FacilityId == facilityId && c.Unit.UnitCode == req.UnitCode
                        && UsableContractStatuses.Contains(c.Status)
                        && c.StartDate <= today && c.EndDate >= today)
            .OrderByDescending(c => c.EndDate)
            .FirstOrDefaultAsync(ct)
            ?? throw new AppException(StatusCodes.Status401Unauthorized, wrong);

        if (contract.PinLockedUntil > Now)
            throw new AppException(StatusCodes.Status423Locked,
                $"PIN đã bị khóa tạm thời do nhập sai nhiều lần. Thử lại sau {contract.PinLockedUntil:HH:mm} hoặc liên hệ nhân viên.");

        if (contract.AccessPinHash is null)
            throw new AppException(StatusCodes.Status401Unauthorized, "Kho này chưa có PIN. Vui lòng đặt PIN trong ứng dụng hoặc liên hệ nhân viên.");

        if (!pins.Verify(contract, req.Pin))
        {
            contract.PinFailedAttempts++;
            if (contract.PinFailedAttempts >= _opt.MaxPinAttempts)
            {
                contract.PinFailedAttempts = 0;
                contract.PinLockedUntil = Now.AddMinutes(_opt.PinLockMinutes);
            }
            await db.SaveChangesAsync(ct);
            throw new AppException(StatusCodes.Status401Unauthorized, wrong);
        }

        contract.PinFailedAttempts = 0;
        contract.PinLockedUntil = null;

        // Correct PIN, but the unit cannot be opened: tell the visitor to see the staff.
        if (contract.Unit.Status == UnitStatus.OverdueLocked || contract.Status == ContractStatus.Overdue)
        {
            await db.SaveChangesAsync(ct);
            throw AppException.Forbidden("Hợp đồng đang quá hạn thanh toán. Vui lòng liên hệ nhân viên tại quầy.");
        }
        if (contract.Unit.Status == UnitStatus.UnderMaintenance)
        {
            await db.SaveChangesAsync(ct);
            throw AppException.Forbidden("Kho đang được bảo trì. Vui lòng liên hệ nhân viên tại quầy.");
        }

        var pending = await db.AccessRecords
            .FirstOrDefaultAsync(r => r.ContractId == contract.ContractId && r.Result == AccessResult.Pending, ct);
        if (pending is not null && !IsExpired(pending))
        {
            await db.SaveChangesAsync(ct);
            return ToKioskStatus(pending, contract.Unit.UnitCode);
        }
        if (pending is not null)
        {
            Expire(pending);
            await db.SaveChangesAsync(ct);   // free the one-pending-per-contract index first
        }

        var record = new AccessRecord
        {
            ContractId = contract.ContractId,
            FacilityId = facilityId,
            UnitId = contract.UnitId,
            Result = AccessResult.Pending,
            PinEnteredAt = Now,
            EntryTime = Now,   // overwritten with the real entry time when staff grants access
        };
        db.AccessRecords.Add(record);
        await db.SaveChangesAsync(ct);
        return ToKioskStatus(record, contract.Unit.UnitCode);
    }

    public async Task<KioskRequestStatus> GetKioskStatusAsync(int facilityId, long requestId, CancellationToken ct)
    {
        var record = await db.AccessRecords.Include(r => r.Unit)
            .FirstOrDefaultAsync(r => r.AccessRecordId == requestId && r.FacilityId == facilityId, ct)
            ?? throw AppException.NotFound("Không tìm thấy yêu cầu");

        if (record.Result == AccessResult.Pending && IsExpired(record))
        {
            Expire(record);
            await db.SaveChangesAsync(ct);
        }
        return ToKioskStatus(record, record.Unit.UnitCode);
    }

    // ---------------------------------------------------------------- staff

    public async Task<IReadOnlyList<PendingAccessDto>> GetPendingAsync(int staffId, int facilityId, CancellationToken ct)
    {
        await EnsureAssignedAsync(staffId, facilityId, ct);
        var since = Now.AddMinutes(-_opt.PendingTimeoutMinutes);

        var rows = await db.AccessRecords
            .Where(r => r.FacilityId == facilityId && r.Result == AccessResult.Pending && r.PinEnteredAt >= since)
            .OrderBy(r => r.PinEnteredAt)
            .Select(r => new
            {
                r.AccessRecordId,
                r.PinEnteredAt,
                r.Unit.UnitCode,
                r.Contract.ContractNumber,
                r.Contract.EndDate,
                Customer = new PersonDto(null, r.Contract.Customer.FullName, r.Contract.Customer.CitizenId,
                    r.Contract.Customer.PhoneNumber, "Chủ hợp đồng"),
                Authorized = r.Contract.AuthorizedPersons
                    .Where(p => p.Status == "Active")
                    .Select(p => new PersonDto(p.AuthorizedPersonId, p.FullName, p.CitizenId, p.PhoneNumber, p.Relationship))
                    .ToList(),
            })
            .ToListAsync(ct);

        return rows.Select(r => new PendingAccessDto(r.AccessRecordId, r.PinEnteredAt!.Value, r.UnitCode,
            r.ContractNumber, r.EndDate, r.Customer, r.Authorized)).ToList();
    }

    public async Task<AccessRecordDto> ApproveAsync(int staffId, long requestId, ApproveAccessRequest req, CancellationToken ct)
    {
        var record = await LoadPendingAsync(staffId, requestId, ct);

        if (!VerificationMethods.All.Contains(req.VerificationMethod))
            throw AppException.BadRequest("Loại giấy tờ không hợp lệ: " + string.Join(", ", VerificationMethods.All));

        string? expectedCitizenId;
        if (req.AuthorizedPersonId is { } apId)
        {
            var person = record.Contract.AuthorizedPersons
                .FirstOrDefault(p => p.AuthorizedPersonId == apId && p.Status == "Active")
                ?? throw AppException.BadRequest("Người này không có trong danh sách được ủy quyền của hợp đồng");
            expectedCitizenId = person.CitizenId;
        }
        else
        {
            expectedCitizenId = record.Contract.Customer.CitizenId;
        }

        // Staff types the number printed on the visitor's ID card; it must match what we have on file.
        if (req.VerificationMethod == "CitizenID")
        {
            if (string.IsNullOrWhiteSpace(req.DocumentNumber))
                throw AppException.BadRequest("Vui lòng nhập số CCCD trên giấy tờ của khách");
            if (!string.Equals(req.DocumentNumber.Trim(), expectedCitizenId, StringComparison.OrdinalIgnoreCase))
                throw AppException.BadRequest("Số CCCD không khớp với hồ sơ. Hãy kiểm tra lại hoặc từ chối với lý do IdentityMismatch.");
        }

        record.Result = AccessResult.Granted;
        record.AuthorizedPersonId = req.AuthorizedPersonId;
        record.VerificationMethod = req.VerificationMethod;
        record.VerifiedByStaffId = staffId;
        record.VerifiedAt = Now;
        record.EntryTime = Now;
        record.Purpose = req.Purpose;
        record.Notes = req.Notes;
        await db.SaveChangesAsync(ct);
        return await GetRecordDtoAsync(record.AccessRecordId, ct);
    }

    public async Task<AccessRecordDto> DenyAsync(int staffId, long requestId, DenyAccessRequest req, CancellationToken ct)
    {
        if (!DenyReasons.All.Contains(req.Reason))
            throw AppException.BadRequest("Lý do không hợp lệ: " + string.Join(", ", DenyReasons.All));

        var record = await LoadPendingAsync(staffId, requestId, ct);
        record.Result = AccessResult.Denied;
        record.DenyReason = req.Reason;
        record.VerifiedByStaffId = staffId;
        record.VerifiedAt = Now;
        record.Notes = req.Notes;
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

    public async Task<AccessRecordDto> ConfirmExitAsync(int staffId, long requestId, CancellationToken ct)
    {
        var record = await db.AccessRecords.FirstOrDefaultAsync(r => r.AccessRecordId == requestId, ct)
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

    // ---------------------------------------------------------------- customer

    public async Task SetPinAsync(int customerId, int contractId, SetPinRequest req, CancellationToken ct)
    {
        var contract = await db.Contracts.FirstOrDefaultAsync(c => c.ContractId == contractId && c.CustomerId == customerId, ct)
                       ?? throw AppException.NotFound("Không tìm thấy hợp đồng");

        if (contract.AccessPinHash is not null && (req.CurrentPin is null || !pins.Verify(contract, req.CurrentPin)))
            throw AppException.BadRequest("PIN hiện tại không đúng. Nếu quên PIN, hãy nhờ nhân viên đặt lại.");

        pins.EnsureStrong(req.NewPin);
        contract.AccessPinHash = pins.Hash(contract, req.NewPin);
        contract.PinFailedAttempts = 0;
        contract.PinLockedUntil = null;
        contract.PinUpdatedAt = Now;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Staff clears a forgotten PIN after checking the customer's ID at the counter; the customer then sets a new one.</summary>
    public async Task ResetPinAsync(int staffId, int contractId, CancellationToken ct)
    {
        var contract = await db.Contracts.Include(c => c.Unit).FirstOrDefaultAsync(c => c.ContractId == contractId, ct)
                       ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        await EnsureAssignedAsync(staffId, contract.Unit.FacilityId, ct);

        contract.AccessPinHash = null;
        contract.PinFailedAttempts = 0;
        contract.PinLockedUntil = null;
        contract.PinUpdatedAt = Now;
        await db.SaveChangesAsync(ct);
    }

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

    private async Task<AccessRecord> LoadPendingAsync(int staffId, long requestId, CancellationToken ct)
    {
        var record = await db.AccessRecords
            .Include(r => r.Contract).ThenInclude(c => c.Customer)
            .Include(r => r.Contract).ThenInclude(c => c.AuthorizedPersons)
            .FirstOrDefaultAsync(r => r.AccessRecordId == requestId, ct)
            ?? throw AppException.NotFound("Không tìm thấy yêu cầu");
        await EnsureAssignedAsync(staffId, record.FacilityId, ct);

        if (record.Result != AccessResult.Pending)
            throw AppException.Conflict("Yêu cầu này đã được xử lý");
        if (IsExpired(record))
        {
            Expire(record);
            await db.SaveChangesAsync(ct);
            throw AppException.Conflict("Yêu cầu đã hết hạn, khách cần nhập lại PIN");
        }
        return record;
    }

    private bool IsExpired(AccessRecord r) =>
        r.PinEnteredAt is { } t && t.AddMinutes(_opt.PendingTimeoutMinutes) < Now;

    private static void Expire(AccessRecord r)
    {
        r.Result = AccessResult.Denied;
        r.DenyReason = "Expired";
    }

    private static KioskRequestStatus ToKioskStatus(AccessRecord r, string unitCode) => new(
        r.AccessRecordId, unitCode, r.Result, r.Result switch
        {
            AccessResult.Pending => "PIN đúng. Vui lòng xuất trình CCCD cho nhân viên để được xác nhận.",
            AccessResult.Granted => "Đã xác nhận. Mời bạn vào kho.",
            _ when r.DenyReason == "Expired" => "Yêu cầu đã hết hạn. Vui lòng nhập lại PIN.",
            _ => "Không được phép vào. Vui lòng liên hệ nhân viên.",
        });

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
            r.PinEnteredAt,
            r.EntryTime,
            r.ExitTime,
            r.VerifiedByStaff != null ? r.VerifiedByStaff.FullName : null));
}
