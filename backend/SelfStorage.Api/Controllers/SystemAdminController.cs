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
        await ValidateAccountAsync(req.Username, req.Email, req.CitizenId, null, ct);
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
            Email = req.Email.Trim(),
            PhoneNumber = req.PhoneNumber.Trim(),
            CitizenId = Normalize(req.CitizenId),
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
        var email = req.Email.Trim();
        var phoneNumber = req.PhoneNumber.Trim();
        var citizenId = Normalize(req.CitizenId);
        if (fullName.Length == 0 || phoneNumber.Length == 0)
            throw AppException.BadRequest("Họ tên và số điện thoại không được để trống");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var user = await db.Users.Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.UserId == userId, ct)
            ?? throw AppException.NotFound("Không tìm thấy tài khoản");
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
        if (user.Role.RoleName == AppRoles.Admin && newRole.RoleName != AppRoles.Admin)
            await EnsureAnotherActiveAdminExists(userId, ct);

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var oldRoleName = user.Role.RoleName;
        user.RoleId = newRole.RoleId;
        user.Role = newRole;
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

    private async Task ValidateAccountAsync(
        string username, string email, string? citizenId, int? excludeUserId, CancellationToken ct)
    {
        var normalizedUsername = username.Trim();
        var normalizedEmail = email.Trim();
        var normalizedCitizenId = Normalize(citizenId);
        var duplicate = await db.Users.AnyAsync(u => (excludeUserId == null || u.UserId != excludeUserId.Value)
            && (u.Username == normalizedUsername || u.Email == normalizedEmail
                || (normalizedCitizenId != null && u.CitizenId == normalizedCitizenId)), ct);
        if (duplicate)
            throw AppException.Conflict("Tên đăng nhập, email hoặc CCCD đã được sử dụng");
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

    private static string? Normalize(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static void ValidatePaging(int page, int pageSize)
    {
        if (page < 1 || pageSize is < 1 or > 200)
            throw AppException.BadRequest("Trang phải từ 1 trở lên và pageSize từ 1 đến 200");
    }
}
