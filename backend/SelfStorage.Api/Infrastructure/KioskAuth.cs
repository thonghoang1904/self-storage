using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;

namespace SelfStorage.Api.Infrastructure;

public class KioskDevice
{
    public string Name { get; set; } = null!;
    public string ApiKey { get; set; } = null!;
    public int FacilityId { get; set; }
}

public class KioskOptions
{
    public const string HeaderName = "X-Kiosk-Key";
    public List<KioskDevice> Devices { get; set; } = [];
}

/// <summary>
/// Gate kiosks authenticate with a per-device key (header X-Kiosk-Key).
/// The facility comes from the key, so a kiosk can only open units at its own facility.
/// </summary>
public class KioskAuthAttribute() : TypeFilterAttribute(typeof(KioskAuthFilter));

public class KioskAuthFilter(IOptions<KioskOptions> options) : IAuthorizationFilter
{
    public const string FacilityItemKey = "KioskFacilityId";

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var supplied = context.HttpContext.Request.Headers[KioskOptions.HeaderName].ToString();
        var device = options.Value.Devices.FirstOrDefault(d => FixedTimeEquals(d.ApiKey, supplied));
        if (string.IsNullOrEmpty(supplied) || device is null)
        {
            context.Result = new UnauthorizedObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status401Unauthorized,
                Title = "Thiết bị kiosk không hợp lệ",
            });
            return;
        }
        context.HttpContext.Items[FacilityItemKey] = device.FacilityId;
    }

    private static bool FixedTimeEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
}

public static class KioskHttpContextExtensions
{
    public static int GetKioskFacilityId(this HttpContext http) => (int)http.Items[KioskAuthFilter.FacilityItemKey]!;
}
