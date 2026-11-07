using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Services;

public class JwtOptions
{
    public string Issuer { get; set; } = "SelfStorage";
    public string Audience { get; set; } = "SelfStorage";
    public string SigningKey { get; set; } = null!;
    public int ExpiresMinutes { get; set; } = 480;
}

public class TokenService(IOptions<JwtOptions> options, TimeProvider clock)
{
    public const string SessionClaimType = "sid";
    private readonly JwtOptions _opt = options.Value;

    public static string NewSessionId() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16));

    public (string Token, DateTime ExpiresAt) CreateToken(User user, string sessionId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sessionId);
        var expires = clock.GetUtcNow().UtcDateTime.AddMinutes(_opt.ExpiresMinutes);
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.UserId.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role.RoleName),
            new Claim("full_name", user.FullName),
            new Claim(JwtRegisteredClaimNames.Jti, sessionId),
            new Claim(SessionClaimType, sessionId),
        };
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_opt.SigningKey));
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = _opt.Issuer,
            Audience = _opt.Audience,
            Subject = new ClaimsIdentity(claims),
            Expires = expires,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        });
        return (token, expires);
    }
}
