using Microsoft.AspNetCore.Authorization;
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
        var email = Contact.NormalizeEmail(req.Email);
        var citizenId = Contact.NormalizeCitizenId(req.CitizenId);
        if (await db.Users.AnyAsync(u => u.Username == username, ct))
            throw AppException.Conflict("Tên đăng nhập đã được sử dụng");
        await EnsureEmailFreeAsync(email, null, ct);
        await EnsureCitizenIdFreeAsync(citizenId, null, ct);

        var role = await db.Roles.SingleAsync(r => r.RoleName == AppRoles.Customer, ct);
        var user = new User
        {
            RoleId = role.RoleId,
            Role = role,
            Username = username,
            FullName = req.FullName.Trim(),
            Email = email,
            PhoneNumber = Contact.NormalizePhone(req.PhoneNumber),
            CitizenId = citizenId,
        };
        user.PasswordHash = hasher.HashPassword(user, req.Password);
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        return ToDto(user);
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest req, CancellationToken ct)
    {
        var username = req.Username.Trim();
        var user = await db.Users.Include(u => u.Role).FirstOrDefaultAsync(u => u.Username == username, ct);
        if (user is null || user.Status != "Active" ||
            hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password) == PasswordVerificationResult.Failed)
            throw new AppException(StatusCodes.Status401Unauthorized, "Sai tên đăng nhập hoặc mật khẩu");

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
            var googleEmail = Contact.NormalizeEmail(payload.Email);
            user = await db.Users.Include(u => u.Role)
                .FirstOrDefaultAsync(u => u.Email == googleEmail && u.Status == "Active", ct);
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

        var email = Contact.NormalizeEmail(req.Email);
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

    /// <summary>Own contact details (email, phone, CCCD, address).</summary>
    [HttpGet("profile")]
    [Authorize]
    public async Task<ProfileDto> Profile(CancellationToken ct)
    {
        var id = User.GetUserId();
        var user = await db.Users.Include(u => u.Role).SingleAsync(u => u.UserId == id, ct);
        return ToProfileDto(user);
    }

    /// <summary>Update own contact details. A CCCD on file is fixed; an empty one can be filled in once.</summary>
    [HttpPut("profile")]
    [Authorize]
    public async Task<ProfileDto> UpdateProfile(UpdateProfileRequest req, CancellationToken ct)
    {
        var id = User.GetUserId();
        var user = await db.Users.Include(u => u.Role).SingleAsync(u => u.UserId == id, ct);
        var email = Contact.NormalizeEmail(req.Email);
        await EnsureEmailFreeAsync(email, id, ct);

        if (!string.IsNullOrWhiteSpace(req.CitizenId))
        {
            var citizenId = Contact.NormalizeCitizenId(req.CitizenId);
            if (user.CitizenId is not null && Contact.NormalizeCitizenId(user.CitizenId) != citizenId)
                throw AppException.Conflict("Số CCCD đã lưu không thể tự thay đổi. Vui lòng mang CCCD đến cơ sở để nhân viên cập nhật.");
            await EnsureCitizenIdFreeAsync(citizenId, id, ct);
            user.CitizenId = citizenId;
        }

        user.FullName = req.FullName.Trim();
        user.Email = email;
        user.PhoneNumber = Contact.NormalizePhone(req.PhoneNumber);
        user.Address = string.IsNullOrWhiteSpace(req.Address) ? null : req.Address.Trim();
        user.UpdatedAt = clock.GetLocalNow().DateTime;
        await db.SaveChangesAsync(ct);
        return ToProfileDto(user);
    }

    private async Task EnsureEmailFreeAsync(string email, int? exceptUserId, CancellationToken ct)
    {
        if (await db.Users.AnyAsync(u => u.Email == email && u.UserId != exceptUserId, ct))
            throw AppException.Conflict("Email đã được sử dụng");
    }

    private async Task EnsureCitizenIdFreeAsync(string citizenId, int? exceptUserId, CancellationToken ct)
    {
        if (await db.Users.AnyAsync(u => u.CitizenId == citizenId && u.UserId != exceptUserId, ct))
            throw AppException.Conflict("Số CCCD đã được đăng ký cho tài khoản khác");
    }

    private static UserDto ToDto(User u) => new(u.UserId, u.Username, u.FullName, u.Role.RoleName);

    private static ProfileDto ToProfileDto(User u) =>
        new(u.UserId, u.Username, u.FullName, u.Role.RoleName, u.Email, u.PhoneNumber, u.CitizenId, u.Address);

    private Task<int> InvalidateResetTokenAsync(int userId, string details, CancellationToken ct) =>
        db.ActivityLogs
            .Where(log => log.UserId == userId && log.Action == ResetTokenAction && log.Details == details)
            .ExecuteUpdateAsync(update => update.SetProperty(log => log.Details, "invalidated"), ct);

    private static string Base64UrlEncode(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
