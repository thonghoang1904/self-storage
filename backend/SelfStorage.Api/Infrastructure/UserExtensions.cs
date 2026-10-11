using System.Security.Claims;

namespace SelfStorage.Api.Infrastructure;

public static class UserExtensions
{
    public static int GetUserId(this ClaimsPrincipal user) =>
        int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)
                  ?? throw new AppException(StatusCodes.Status401Unauthorized, "Chưa đăng nhập"));
}
