using Microsoft.AspNetCore.Authorization;
using System.Data;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Google.Apis.Auth;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(
    SelfStorageDbContext db,
    TokenService tokens,
    IPasswordHasher<User> hasher,
    IEmailSender emailSender,
    IOptions<GoogleAuthOptions> googleOptions,
    TimeProvider clock,
    ILogger<AuthController> logger) : ControllerBase
{
    private const string ResetTokenAction = "PasswordResetRequested";
    private static readonly TimeSpan ResetTokenLifetime = TimeSpan.FromMinutes(30);

    /// <summary>Customer self-registration.</summary>
    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult<UserDto>> Register(RegisterRequest req, CancellationToken ct)
    {
        var username = req.Username.Trim();
        var email = req.Email.Trim();
        var citizenId = req.CitizenId.Trim();
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        if (await db.Users.AnyAsync(u => u.Username == username || u.Email == email || u.CitizenId == citizenId, ct))
            throw AppException.Conflict("Tên đăng nhập, email hoặc CCCD đã được sử dụng");

        var role = await db.Roles.SingleAsync(r => r.RoleName == AppRoles.Customer, ct);
        var user = new User
        {
            RoleId = role.RoleId,
            Role = role,
            Username = username,
            FullName = req.FullName.Trim(),
            Email = email,
            PhoneNumber = req.PhoneNumber.Trim(),
            CitizenId = citizenId,
        };
        user.PasswordHash = hasher.HashPassword(user, req.Password);
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToDto(user);
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest req, CancellationToken ct)
    {
        var user = await db.Users.Include(u => u.Role).FirstOrDefaultAsync(u => u.Username == req.Username, ct);
        if (user is null || user.Status != "Active" ||
            hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password) == PasswordVerificationResult.Failed)
            throw new AppException(StatusCodes.Status401Unauthorized, "Sai tên đăng nhập hoặc mật khẩu");

        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = user.UserId,
            Action = "PasswordLogin",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = "Authenticated using username and password",
            CreatedAt = clock.GetLocalNow().DateTime,
        });
        await db.SaveChangesAsync(ct);

        var (token, expires) = tokens.CreateToken(user);
        return new LoginResponse(token, expires, ToDto(user));
    }

    /// <summary>Authenticate an existing account using a verified Google ID token.</summary>
    [HttpPost("google")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> GoogleLogin(GoogleLoginRequest req, CancellationToken ct)
    {
        var clientId = googleOptions.Value.ClientId;
        if (string.IsNullOrWhiteSpace(clientId))
            throw new AppException(StatusCodes.Status503ServiceUnavailable,
                "Đăng nhập Google chưa được cấu hình.");

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(req.IdToken,
                new GoogleJsonWebSignature.ValidationSettings { Audience = [clientId] });
        }
        catch (InvalidJwtException)
        {
            throw new AppException(StatusCodes.Status401Unauthorized, "Google ID token không hợp lệ hoặc đã hết hạn.");
        }

        if (!payload.EmailVerified || string.IsNullOrWhiteSpace(payload.Subject)
            || !MailAddress.TryCreate(payload.Email, out _))
            throw new AppException(StatusCodes.Status401Unauthorized, "Tài khoản Google không thể đăng nhập.");

        var user = await db.Users.Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.GoogleSubject == payload.Subject, ct);
        if (user is null)
        {
            user = await db.Users.Include(u => u.Role)
                .FirstOrDefaultAsync(u => u.Email == payload.Email && u.Status == "Active", ct);
            if (user is null || (user.GoogleSubject is not null && user.GoogleSubject != payload.Subject))
                throw new AppException(StatusCodes.Status401Unauthorized, "Tài khoản Google không thể đăng nhập.");

            user.GoogleSubject = payload.Subject;
        }

        if (user.Status != "Active")
            throw new AppException(StatusCodes.Status401Unauthorized, "Tài khoản Google không thể đăng nhập.");

        var now = clock.GetUtcNow().UtcDateTime;
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = user.UserId,
            Action = "GoogleLogin",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = "Authenticated using a verified Google account",
            CreatedAt = now,
        });
        await db.SaveChangesAsync(ct);

        var (token, expires) = tokens.CreateToken(user);
        return new LoginResponse(token, expires, ToDto(user));
    }

    /// <summary>Send a single-use password reset token to the registered email address.</summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [EnableRateLimiting("password-reset")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest req, CancellationToken ct)
    {
        var genericResponse = new { message = "Nếu email đã đăng ký, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư." };
        try
        {
            emailSender.ValidateConfiguration();
        }
        catch (InvalidOperationException ex)
        {
            logger.LogError(ex, "SMTP is not configured for password reset delivery");
            throw new AppException(StatusCodes.Status503ServiceUnavailable,
                "Dịch vụ email chưa được cấu hình đầy đủ.");
        }

        var email = req.Email.Trim();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email && u.Status == "Active", ct);
        if (user is null) return Ok(genericResponse);

        var rawToken = Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var tokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));
        var expiresAt = clock.GetUtcNow().Add(ResetTokenLifetime);
        var details = $"pending:{expiresAt.ToUnixTimeSeconds()}:{tokenHash}";

        await db.ActivityLogs
            .Where(log => log.UserId == user.UserId && log.Action == ResetTokenAction
                && log.Details != null && log.Details.StartsWith("pending:"))
            .ExecuteUpdateAsync(update => update.SetProperty(log => log.Details, "invalidated"), ct);

        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = user.UserId,
            Action = ResetTokenAction,
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = details,
            CreatedAt = clock.GetUtcNow().UtcDateTime,
        });
        await db.SaveChangesAsync(ct);

        try
        {
            await emailSender.SendPasswordResetAsync(user.Email, user.FullName, rawToken, ct);
        }
        catch (EmailDeliveryException ex)
        {
            await InvalidateResetTokenAsync(user.UserId, details, ct);
            logger.LogError(ex, "SMTP delivery failed for password reset request");
            throw new AppException(StatusCodes.Status503ServiceUnavailable,
                "Hiện không gửi được email đặt lại mật khẩu. Vui lòng thử lại sau.");
        }
        catch (InvalidOperationException ex)
        {
            await InvalidateResetTokenAsync(user.UserId, details, ct);
            logger.LogError(ex, "SMTP is not configured for password reset delivery");
            throw new AppException(StatusCodes.Status503ServiceUnavailable,
                "Dịch vụ email chưa được cấu hình đầy đủ.");
        }

        return Ok(genericResponse);
    }

    /// <summary>Set a new password using the single-use token sent by email.</summary>
    [HttpPost("reset-password")]
    [AllowAnonymous]
    [EnableRateLimiting("password-reset")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest req, CancellationToken ct)
    {
        var tokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(req.Token)));
        var now = clock.GetUtcNow();
        var tokenLog = await db.ActivityLogs
            .Where(log => log.Action == ResetTokenAction && log.Details != null
                && log.Details.StartsWith("pending:") && log.Details.EndsWith($":{tokenHash}")
                && log.CreatedAt >= now.UtcDateTime.Add(-ResetTokenLifetime))
            .OrderByDescending(log => log.CreatedAt)
            .Select(log => new { log.LogId, log.UserId, log.Details })
            .FirstOrDefaultAsync(ct);
        var parts = tokenLog?.Details?.Split(':', 3);
        if (tokenLog?.UserId is not int userId || parts is not { Length: 3 }
            || !long.TryParse(parts[1], out var expiration) || now.ToUnixTimeSeconds() >= expiration)
            throw AppException.BadRequest("Mã đặt lại mật khẩu không hợp lệ, đã hết hạn hoặc đã được sử dụng");

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var consumed = await db.ActivityLogs
            .Where(log => log.LogId == tokenLog.LogId && log.UserId == userId
                && log.Action == ResetTokenAction && log.Details == tokenLog.Details)
            .ExecuteUpdateAsync(update => update.SetProperty(log => log.Details, "consumed"), ct);
        if (consumed != 1)
            throw AppException.BadRequest("Mã đặt lại mật khẩu không hợp lệ, đã hết hạn hoặc đã được sử dụng");

        var user = await db.Users.FirstOrDefaultAsync(u => u.UserId == userId && u.Status == "Active", ct)
                   ?? throw AppException.BadRequest("Mã đặt lại mật khẩu không hợp lệ, đã hết hạn hoặc đã được sử dụng");
        user.PasswordHash = hasher.HashPassword(user, req.NewPassword);
        user.UpdatedAt = now.UtcDateTime;
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = user.UserId,
            Action = "PasswordResetCompleted",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = "Password reset completed using a single-use email token",
            CreatedAt = now.UtcDateTime,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Ok(new { message = "Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới." });
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<UserDto> Me(CancellationToken ct)
    {
        var id = User.GetUserId();
        var user = await db.Users.Include(u => u.Role).SingleAsync(u => u.UserId == id, ct);
        return ToDto(user);
    }

    private static UserDto ToDto(User u) => new(u.UserId, u.Username, u.FullName, u.Role.RoleName);

    /// <summary>Full profile of the signed-in account.</summary>
    [HttpGet("profile")]
    [Authorize]
    public async Task<UserProfileDto> Profile(CancellationToken ct)
    {
        var id = User.GetUserId();
        var user = await db.Users.Include(u => u.Role).SingleAsync(u => u.UserId == id, ct);
        return ToProfileDto(user);
    }

    /// <summary>Update own name, email, phone and address.</summary>
    [HttpPut("me")]
    [Authorize]
    public async Task<UserProfileDto> UpdateMe(UpdateProfileRequest req, CancellationToken ct)
    {
        var id = User.GetUserId();
        var fullName = req.FullName.Trim();
        var email = req.Email.Trim();
        var phoneNumber = req.PhoneNumber.Trim();
        var address = string.IsNullOrWhiteSpace(req.Address) ? null : req.Address.Trim();
        if (fullName.Length == 0 || phoneNumber.Length == 0)
            throw AppException.BadRequest("Họ tên và số điện thoại không được để trống");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var user = await db.Users.Include(u => u.Role).SingleAsync(u => u.UserId == id, ct);
        if (await db.Users.AnyAsync(u => u.UserId != id && u.Email == email, ct))
            throw AppException.Conflict("Email đã được sử dụng");

        user.FullName = fullName;
        user.Email = email;
        user.PhoneNumber = phoneNumber;
        user.Address = address;
        user.UpdatedAt = clock.GetLocalNow().DateTime;
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = id,
            Action = "ProfileUpdated",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = "Account holder updated profile information",
            CreatedAt = user.UpdatedAt.Value,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToProfileDto(user);
    }

    /// <summary>Change the password of the signed-in account after confirming the current one.</summary>
    [HttpPost("change-password")]
    [Authorize]
    [EnableRateLimiting("password-reset")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest req, CancellationToken ct)
    {
        var id = User.GetUserId();
        var user = await db.Users.SingleAsync(u => u.UserId == id, ct);
        if (hasher.VerifyHashedPassword(user, user.PasswordHash, req.CurrentPassword) == PasswordVerificationResult.Failed)
            throw AppException.BadRequest("Mật khẩu hiện tại không đúng");
        if (req.CurrentPassword == req.NewPassword)
            throw AppException.BadRequest("Mật khẩu mới phải khác mật khẩu hiện tại");

        user.PasswordHash = hasher.HashPassword(user, req.NewPassword);
        user.UpdatedAt = clock.GetLocalNow().DateTime;
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = id,
            Action = "PasswordChanged",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = "Account holder changed password",
            CreatedAt = user.UpdatedAt.Value,
        });
        await db.SaveChangesAsync(ct);
        return Ok(new { message = "Đổi mật khẩu thành công." });
    }

    private static UserProfileDto ToProfileDto(User u) => new(u.UserId, u.Username, u.FullName, u.Email,
        u.PhoneNumber, u.CitizenId, u.Address, u.Role.RoleName, u.Status, u.CreatedAt);

    private Task<int> InvalidateResetTokenAsync(int userId, string details, CancellationToken ct) =>
        db.ActivityLogs
            .Where(log => log.UserId == userId && log.Action == ResetTokenAction && log.Details == details)
            .ExecuteUpdateAsync(update => update.SetProperty(log => log.Details, "invalidated"), ct);

    private static string Base64UrlEncode(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
