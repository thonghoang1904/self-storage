using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(SelfStorageDbContext db, TokenService tokens, IPasswordHasher<User> hasher) : ControllerBase
{
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

    [HttpGet("me")]
    [Authorize]
    public async Task<UserDto> Me(CancellationToken ct)
    {
        var id = User.GetUserId();
        var user = await db.Users.Include(u => u.Role).SingleAsync(u => u.UserId == id, ct);
        return ToDto(user);
    }

    private static UserDto ToDto(User u) => new(u.UserId, u.Username, u.FullName, u.Role.RoleName);
}
