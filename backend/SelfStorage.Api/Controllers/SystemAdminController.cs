using System.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize(Roles = AppRoles.Admin)]
public sealed class SystemAdminController(
    SelfStorageDbContext db,
    IPasswordHasher<User> hasher,
    TimeProvider clock) : ControllerBase
{
    [HttpGet("roles")]
    public Task<List<RoleDto>> Roles(CancellationToken ct) =>
        db.Roles.OrderBy(r => r.RoleId)
            .Select(r => new RoleDto(r.RoleId, r.RoleName, r.Description))
            .ToListAsync(ct);

    [HttpGet("users")]
    public async Task<List<AdminUserDto>> Users(
        [FromQuery] int? roleId, [FromQuery] string? status, [FromQuery] string? search,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        ValidatePaging(page, pageSize);
        if (status is not null && status is not ("Active" or "Inactive" or "Suspended"))
            throw AppException.BadRequest("Trạng thái tài khoản không hợp lệ");

        var query = db.Users.Include(u => u.Role).AsQueryable();
        if (roleId is not null) query = query.Where(u => u.RoleId == roleId);
        if (status is not null) query = query.Where(u => u.Status == status);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(u => u.Username.Contains(term) || u.FullName.Contains(term)
                || u.Email.Contains(term) || u.PhoneNumber.Contains(term));
        }

        return await query.OrderBy(u => u.UserId).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(u => new AdminUserDto(u.UserId, u.Username, u.FullName, u.Email,
                u.PhoneNumber, u.CitizenId, u.Status, u.RoleId, u.Role.RoleName))
            .ToListAsync(ct);
    }

    [HttpPost("users")]
    public async Task<AdminUserDto> CreateUser(CreateUserByAdminRequest req, CancellationToken ct)
    {
        var role = await db.Roles.FindAsync([req.RoleId], ct)
            ?? throw AppException.NotFound("Không tìm thấy vai trò");
        var citizenId = NormalizeCitizenId(req.CitizenId);
        if (role.RoleName == AppRoles.Customer && citizenId is null)
            throw AppException.BadRequest("Tài khoản khách thuê cần có số CCCD để nhân viên xác thực tại cổng");
        await ValidateAccountAsync(req.Username, req.Email, citizenId, null, ct);
        var facilityIds = req.FacilityIds?.Distinct().ToArray() ?? [];
        ValidateFacilityAssignments(role.RoleName, facilityIds);
        if (facilityIds.Length > 0 && await db.Facilities.CountAsync(f => facilityIds.Contains(f.FacilityId), ct)
            != facilityIds.Length)
            throw AppException.BadRequest("Danh sách có cơ sở không tồn tại");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var user = new User
        {
            RoleId = role.RoleId,
            Role = role,
            Username = req.Username.Trim(),
            FullName = req.FullName.Trim(),
            Email = Contact.NormalizeEmail(req.Email),
            PhoneNumber = Contact.NormalizePhone(req.PhoneNumber),
            CitizenId = citizenId,
            Status = "Active",
        };
        user.PasswordHash = hasher.HashPassword(user, req.Password);
        db.Users.Add(user);
        foreach (var facilityId in facilityIds)
            db.FacilityStaffAssignments.Add(new FacilityStaffAssignment
            {
                FacilityId = facilityId,
                Staff = user,
                AssignedDate = DateOnly.FromDateTime(clock.GetLocalNow().DateTime),
                Status = "Active",
            });
        await db.SaveChangesAsync(ct);
        AddLog(user.UserId, "AdminUserCreated", $"Created account {user.Username} with role {role.RoleName}");
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToAdminUser(user);
    }

    [HttpPut("users/{userId:int}/profile")]
    public async Task<AdminUserDto> UpdateUserProfile(
        int userId, UpdateAdminUserProfileRequest req, CancellationToken ct)
    {
        var fullName = req.FullName.Trim();
        var email = Contact.NormalizeEmail(req.Email);
        var phoneNumber = Contact.NormalizePhone(req.PhoneNumber);
        var citizenId = NormalizeCitizenId(req.CitizenId);
        if (fullName.Length == 0 || phoneNumber.Length == 0)
            throw AppException.BadRequest("Họ tên và số điện thoại không được để trống");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var user = await db.Users.Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.UserId == userId, ct)
            ?? throw AppException.NotFound("Không tìm thấy tài khoản");
        if (user.Role.RoleName == AppRoles.Customer && citizenId is null)
            throw AppException.BadRequest("Tài khoản khách thuê cần có số CCCD để nhân viên xác thực tại cổng");
        await ValidateAccountAsync(user.Username, email, citizenId, userId, ct);

        var changedFields = new List<string>();
        if (user.FullName != fullName) changedFields.Add(nameof(user.FullName));
        if (user.Email != email) changedFields.Add(nameof(user.Email));
        if (user.PhoneNumber != phoneNumber) changedFields.Add(nameof(user.PhoneNumber));
        if (user.CitizenId != citizenId) changedFields.Add(nameof(user.CitizenId));
        if (changedFields.Count > 0)
        {
            user.FullName = fullName;
            user.Email = email;
            user.PhoneNumber = phoneNumber;
            user.CitizenId = citizenId;
            user.UpdatedAt = clock.GetLocalNow().DateTime;
            AddLog(User.GetUserId(), "AdminUserProfileUpdated",
                $"Updated profile fields for user {userId}: {string.Join(", ", changedFields)}");
            await db.SaveChangesAsync(ct);
        }

        await transaction.CommitAsync(ct);
        return ToAdminUser(user);
    }

    [HttpPut("users/{userId:int}/role")]
    public async Task<AdminUserDto> ChangeRole(int userId, ChangeUserRoleRequest req, CancellationToken ct)
    {
        var actorId = User.GetUserId();
        var user = await db.Users.Include(u => u.Role).FirstOrDefaultAsync(u => u.UserId == userId, ct)
            ?? throw AppException.NotFound("Không tìm thấy tài khoản");
        var newRole = await db.Roles.FindAsync([req.RoleId], ct)
            ?? throw AppException.NotFound("Không tìm thấy vai trò");
        if (userId == actorId && user.RoleId != req.RoleId)
            throw AppException.Conflict("Không thể tự đổi vai trò của chính mình");
        if (newRole.RoleName == AppRoles.Customer && string.IsNullOrWhiteSpace(user.CitizenId))
            throw AppException.BadRequest("Tài khoản chuyển sang vai trò khách thuê cần cập nhật số CCCD trước");
        if (user.Role.RoleName == AppRoles.Admin && newRole.RoleName != AppRoles.Admin)
            await EnsureAnotherActiveAdminExists(userId, ct);

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var oldRoleName = user.Role.RoleName;
        user.RoleId = newRole.RoleId;
        user.Role = newRole;
        if (oldRoleName != newRole.RoleName)
        {
            user.ActiveSessionId = null;
            user.SessionIssuedAt = null;
        }
        if (newRole.RoleName is not (AppRoles.Staff or AppRoles.Manager))
            await db.FacilityStaffAssignments
                .Where(a => a.StaffId == userId && a.Status == "Active")
                .ExecuteUpdateAsync(update => update.SetProperty(a => a.Status, "Ended"), ct);
        AddLog(actorId, "AdminUserRoleChanged", $"Changed user {userId} role from {oldRoleName} to {newRole.RoleName}");
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToAdminUser(user);
    }

    [HttpPut("users/{userId:int}/status")]
    public async Task<AdminUserDto> ChangeStatus(int userId, ChangeUserStatusRequest req, CancellationToken ct)
    {
        if (req.Status is not ("Active" or "Inactive" or "Suspended"))
            throw AppException.BadRequest("Trạng thái tài khoản không hợp lệ");
        var actorId = User.GetUserId();
        var user = await db.Users.Include(u => u.Role).FirstOrDefaultAsync(u => u.UserId == userId, ct)
            ?? throw AppException.NotFound("Không tìm thấy tài khoản");
        if (userId == actorId && req.Status != "Active")
            throw AppException.Conflict("Không thể tự vô hiệu hóa tài khoản quản trị của mình");
        if (user.Role.RoleName == AppRoles.Admin && req.Status != "Active")
            await EnsureAnotherActiveAdminExists(userId, ct);

        user.Status = req.Status;
        if (req.Status != "Active")
        {
            user.ActiveSessionId = null;
            user.SessionIssuedAt = null;
        }
        user.UpdatedAt = clock.GetLocalNow().DateTime;
        AddLog(actorId, "AdminUserStatusChanged", $"Changed user {userId} status to {req.Status}");
        await db.SaveChangesAsync(ct);
        return ToAdminUser(user);
    }

    [HttpGet("users/{userId:int}/activity")]
    public async Task<List<ActivityLogDto>> UserActivity(
        int userId, [FromQuery] int take = 100, CancellationToken ct = default)
    {
        if (take is < 1 or > 500)
            throw AppException.BadRequest("Số lượng bản ghi cần đọc phải từ 1 đến 500");
        if (!await db.Users.AnyAsync(u => u.UserId == userId, ct))
            throw AppException.NotFound("Không tìm thấy tài khoản");
        return await db.ActivityLogs.Where(log => log.UserId == userId)
            .OrderByDescending(log => log.CreatedAt).Take(take)
            .Select(log => new ActivityLogDto(log.LogId, log.Action, log.Details, log.IpAddress, log.CreatedAt))
            .ToListAsync(ct);
    }

    /// <summary>System-wide audit log with filters, newest first.</summary>
    [HttpGet("activity-logs")]
    public async Task<List<AdminActivityLogDto>> ActivityLogs(
        [FromQuery] int? userId, [FromQuery] string? action,
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        ValidatePaging(page, pageSize);
        if (from is not null && to is not null && from > to)
            throw AppException.BadRequest("Ngày bắt đầu không được sau ngày kết thúc");

        var query = db.ActivityLogs.AsQueryable();
        if (userId is not null) query = query.Where(l => l.UserId == userId);
        if (!string.IsNullOrWhiteSpace(action))
        {
            var term = action.Trim();
            query = query.Where(l => l.Action.Contains(term));
        }
        if (from is not null) query = query.Where(l => l.CreatedAt >= from);
        if (to is not null) query = query.Where(l => l.CreatedAt <= to);

        Response.Headers["X-Total-Count"] = (await query.CountAsync(ct)).ToString();
        return await query.OrderByDescending(l => l.CreatedAt).ThenByDescending(l => l.LogId)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(l => new AdminActivityLogDto(l.LogId, l.UserId,
                db.Users.Where(u => u.UserId == l.UserId).Select(u => u.Username).FirstOrDefault(),
                l.Action, l.Details, l.IpAddress, l.CreatedAt))
            .ToListAsync(ct);
    }

    /// <summary>All payments in the system, for reconciliation with VNPay/MoMo statements and staff collection audit.</summary>
    [HttpGet("payments")]
    public async Task<List<AdminPaymentDto>> Payments(
        [FromQuery] string? status, [FromQuery] string? method, [FromQuery] string? search,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50,
        [FromQuery] int? facilityId = null, [FromQuery] int? staffId = null,
        [FromQuery] string? invoiceType = null, [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null,
        CancellationToken ct = default)
    {
        ValidatePaging(page, pageSize);
        if (status is not null && status is not ("Pending" or "Success" or "Failed" or "Refunded" or "RefundDue" or "Reversed"))
            throw AppException.BadRequest("Trạng thái giao dịch không hợp lệ");
        if (method is not null && method is not ("VNPay" or "MoMo" or "BankTransfer" or "Cash" or "CreditCard" or "DepositOffset"))
            throw AppException.BadRequest("Phương thức thanh toán không hợp lệ");
        if (!string.IsNullOrWhiteSpace(invoiceType)
            && invoiceType is not ("DEPOSIT" or "MONTHLY_RENT" or "RENEWAL" or "OVERDUE_FINE" or "EXTRA_CHARGE"))
            throw AppException.BadRequest("Loại hóa đơn không hợp lệ");
        if (from is not null && to is not null && from > to)
            throw AppException.BadRequest("Ngày bắt đầu không được sau ngày kết thúc");

        var query = from p in db.Payments
                    join i in db.Invoices on p.InvoiceId equals i.InvoiceId
                    select new { Payment = p, Invoice = i };
        if (status is not null) query = query.Where(x => x.Payment.Status == status);
        if (method is not null) query = query.Where(x => x.Payment.PaymentMethod == method);
        if (facilityId is not null)
        {
            query = query.Where(x =>
                (x.Invoice.ContractId != null && db.Contracts.Any(c => c.ContractId == x.Invoice.ContractId
                    && c.Unit.FacilityId == facilityId))
                || (x.Invoice.ReservationId != null && db.Reservations.Any(r => r.ReservationId == x.Invoice.ReservationId
                    && r.FacilityId == facilityId)));
        }
        if (staffId is not null) query = query.Where(x => x.Payment.ReceivedByStaffId == staffId);
        if (!string.IsNullOrWhiteSpace(invoiceType)) query = query.Where(x => x.Invoice.InvoiceType == invoiceType);
        if (from is not null) query = query.Where(x => x.Payment.PaymentDate >= from);
        if (to is not null) query = query.Where(x => x.Payment.PaymentDate <= to);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(x => x.Invoice.InvoiceNumber.Contains(term)
                || (x.Payment.TransactionCode != null && x.Payment.TransactionCode.Contains(term))
                || x.Invoice.Customer.FullName.Contains(term)
                || (x.Payment.ReceivedByStaffId != null && db.Users.Any(u => u.UserId == x.Payment.ReceivedByStaffId
                    && (u.FullName.Contains(term) || u.Username.Contains(term)))));
        }

        Response.Headers["X-Total-Count"] = (await query.CountAsync(ct)).ToString();
        var rows = await query.OrderByDescending(x => x.Payment.PaymentDate).ThenByDescending(x => x.Payment.PaymentId)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(x => new
            {
                x.Payment.PaymentId,
                x.Invoice.InvoiceId,
                x.Invoice.InvoiceNumber,
                x.Invoice.InvoiceType,
                x.Invoice.ContractId,
                x.Invoice.ReservationId,
                x.Invoice.CustomerId,
                CustomerName = x.Invoice.Customer.FullName,
                x.Payment.PaymentMethod,
                x.Payment.Status,
                x.Payment.AmountPaid,
                x.Payment.PaymentDate,
                x.Payment.TransactionCode,
                x.Payment.ReceivedByStaffId,
                x.Payment.PaymentNotes,
            })
            .ToListAsync(ct);

        var staffIds = rows.Where(r => r.ReceivedByStaffId is not null)
            .Select(r => r.ReceivedByStaffId!.Value)
            .Distinct()
            .ToArray();
        var staffNames = staffIds.Length == 0
            ? new Dictionary<int, string>()
            : await db.Users.Where(u => staffIds.Contains(u.UserId))
                .ToDictionaryAsync(u => u.UserId, u => u.FullName, ct);

        var contractIds = rows.Where(r => r.ContractId is not null).Select(r => r.ContractId!.Value).Distinct().ToArray();
        var contractFacilities = contractIds.Length == 0
            ? new Dictionary<int, (int FacilityId, string FacilityName)>()
            : (await db.Contracts.Where(c => contractIds.Contains(c.ContractId))
                .Select(c => new { c.ContractId, c.Unit.FacilityId, c.Unit.Facility.FacilityName })
                .ToListAsync(ct))
                .ToDictionary(c => c.ContractId, c => (c.FacilityId, c.FacilityName));

        var reservationIds = rows.Where(r => r.ReservationId is not null).Select(r => r.ReservationId!.Value).Distinct().ToArray();
        var reservationFacilities = reservationIds.Length == 0
            ? new Dictionary<int, (int FacilityId, string FacilityName)>()
            : (await db.Reservations.Where(r => reservationIds.Contains(r.ReservationId))
                .Select(r => new { r.ReservationId, r.FacilityId, r.Facility.FacilityName })
                .ToListAsync(ct))
                .ToDictionary(r => r.ReservationId, r => (r.FacilityId, r.FacilityName));

        return rows.Select(r =>
        {
            int? resolvedFacilityId = null;
            string? resolvedFacilityName = null;
            if (r.ContractId is int cid && contractFacilities.TryGetValue(cid, out var cf))
            {
                resolvedFacilityId = cf.FacilityId;
                resolvedFacilityName = cf.FacilityName;
            }
            else if (r.ReservationId is int rid && reservationFacilities.TryGetValue(rid, out var rf))
            {
                resolvedFacilityId = rf.FacilityId;
                resolvedFacilityName = rf.FacilityName;
            }

            return new AdminPaymentDto(
                r.PaymentId,
                r.InvoiceId,
                r.InvoiceNumber,
                r.CustomerId,
                r.CustomerName,
                r.PaymentMethod,
                r.Status,
                r.AmountPaid,
                r.PaymentDate,
                r.TransactionCode,
                r.InvoiceType,
                resolvedFacilityId,
                resolvedFacilityName,
                r.ReceivedByStaffId,
                r.ReceivedByStaffId is int sid && staffNames.TryGetValue(sid, out var sname) ? sname : null,
                r.PaymentNotes);
        }).ToList();
    }

    /// <summary>System-wide counters for the administrator home screen.</summary>
    [HttpGet("dashboard")]
    public async Task<SystemDashboardDto> Dashboard(CancellationToken ct)
    {
        var now = clock.GetLocalNow().DateTime;
        var monthStart = new DateTime(now.Year, now.Month, 1);
        var received = await db.Payments.Where(p => p.Status == "Success" && p.PaymentMethod != "DepositOffset"
                && p.PaymentDate >= monthStart)
            .SumAsync(p => (decimal?)p.AmountPaid, ct) ?? 0m;
        var refunded = await db.Payments.Where(p => p.Status == "Refunded" && p.PaymentDate >= monthStart)
            .SumAsync(p => (decimal?)p.AmountPaid, ct) ?? 0m;

        return new SystemDashboardDto(
            now,
            await db.Users.CountAsync(ct),
            await db.Users.CountAsync(u => u.Status == "Active", ct),
            await db.Facilities.CountAsync(ct),
            await db.StorageUnits.CountAsync(ct),
            await db.StorageUnits.CountAsync(u => u.Status == UnitStatus.Available, ct),
            await db.StorageUnits.CountAsync(u => u.Status == UnitStatus.Rented, ct),
            await db.Contracts.CountAsync(c => c.Status == ContractStatus.Active, ct),
            await db.Contracts.CountAsync(c => c.Status == ContractStatus.Overdue, ct),
            await db.SupportRequests.CountAsync(r => r.Status == "Open" || r.Status == "InProgress", ct),
            await db.Payments.CountAsync(p => p.Status == "Pending", ct),
            await db.EmailOutboxMessages.CountAsync(m => m.Status == "Pending" || m.Status == "Processing", ct),
            await db.EmailOutboxMessages.CountAsync(m => m.Status == "Failed", ct),
            received - refunded);
    }

    private async Task ValidateAccountAsync(
        string username, string email, string? citizenId, int? excludeUserId, CancellationToken ct)
    {
        var normalizedUsername = username.Trim();
        var normalizedEmail = Contact.NormalizeEmail(email);
        var others = db.Users.Where(u => excludeUserId == null || u.UserId != excludeUserId.Value);
        if (await others.AnyAsync(u => u.Username == normalizedUsername, ct))
            throw AppException.Conflict("Tên đăng nhập đã được sử dụng");
        if (await others.AnyAsync(u => u.Email == normalizedEmail, ct))
            throw AppException.Conflict("Email đã được sử dụng");
        if (citizenId != null && await others.AnyAsync(u => u.CitizenId == citizenId, ct))
            throw AppException.Conflict("Số CCCD đã được đăng ký cho tài khoản khác");
    }

    private static void ValidateFacilityAssignments(string roleName, IReadOnlyCollection<int> facilityIds)
    {
        if (facilityIds.Count > 0 && roleName is not (AppRoles.Staff or AppRoles.Manager))
            throw AppException.BadRequest("Chỉ nhân viên cơ sở hoặc quản lý cơ sở mới được phân công theo cơ sở");
    }

    private async Task EnsureAnotherActiveAdminExists(int excludedUserId, CancellationToken ct)
    {
        if (!await db.Users.AnyAsync(u => u.UserId != excludedUserId && u.Status == "Active"
            && u.Role.RoleName == AppRoles.Admin, ct))
            throw AppException.Conflict("Không thể thay đổi trạng thái/vai trò của quản trị viên hoạt động cuối cùng");
    }

    private void AddLog(int? userId, string action, string details) =>
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = userId,
            Action = action,
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = details,
            CreatedAt = clock.GetLocalNow().DateTime,
        });

    private static AdminUserDto ToAdminUser(User user) =>
        new(user.UserId, user.Username, user.FullName, user.Email, user.PhoneNumber,
            user.CitizenId, user.Status, user.RoleId, user.Role.RoleName);

    private static string? NormalizeCitizenId(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : Contact.NormalizeCitizenId(value);

    private static void ValidatePaging(int page, int pageSize)
    {
        if (page < 1 || pageSize is < 1 or > 200)
            throw AppException.BadRequest("Trang phải từ 1 trở lên và pageSize từ 1 đến 200");
    }
}
