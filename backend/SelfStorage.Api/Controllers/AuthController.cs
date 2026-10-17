using Microsoft.AspNetCore.Authorization;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
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
        if (await db.Users.AnyAsync(u => u.Username == req.Username || u.Email == req.Email || u.CitizenId == req.CitizenId, ct))
            throw AppException.Conflict("Tên đăng nhập, email hoặc CCCD đã được sử dụng");

        var role = await db.Roles.SingleAsync(r => r.RoleName == AppRoles.Customer, ct);
        var user = new User
        {
            RoleId = role.RoleId,
            Role = role,
            Username = req.Username,
            FullName = req.FullName,
            Email = req.Email,
            PhoneNumber = req.PhoneNumber,
            CitizenId = req.CitizenId,
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
        var user = await db.Users.Include(u => u.Role).FirstOrDefaultAsync(u => u.Username == req.Username, ct);
        if (user is null || user.Status != "Active" ||
            hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password) == PasswordVerificationResult.Failed)
            throw new AppException(StatusCodes.Status401Unauthorized, "Sai tên đăng nhập hoặc mật khẩu");

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
        catch (SmtpException ex)
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

    private Task<int> InvalidateResetTokenAsync(int userId, string details, CancellationToken ct) =>
        db.ActivityLogs
            .Where(log => log.UserId == userId && log.Action == ResetTokenAction && log.Details == details)
            .ExecuteUpdateAsync(update => update.SetProperty(log => log.Details, "invalidated"), ct);

    private static string Base64UrlEncode(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
