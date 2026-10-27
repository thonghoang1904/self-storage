using System.Security.Cryptography;

namespace SelfStorage.Api.Infrastructure;

/// <summary>
/// Business time is Vietnam time whatever time zone the server runs in; every GetLocalNow() relies on this
/// (deposit deadlines, 20:00 pick-up/return times, invoices falling due by date).
/// </summary>
public sealed class BusinessTimeProvider(TimeZoneInfo zone) : TimeProvider
{
    public override TimeZoneInfo LocalTimeZone => zone;

    public static BusinessTimeProvider FromConfiguration(IConfiguration configuration)
    {
        var id = configuration["BusinessTimeZone"] ?? "Asia/Ho_Chi_Minh";
        try
        {
            return new(TimeZoneInfo.FindSystemTimeZoneById(id));
        }
        catch (TimeZoneNotFoundException) when (id == "Asia/Ho_Chi_Minh")
        {
            // Windows without ICU only knows the Windows id.
            return new(TimeZoneInfo.FindSystemTimeZoneById("SE Asia Standard Time"));
        }
    }
}

/// <summary>Reservation, contract and ticket codes: date + 8 random characters, so two requests never collide.</summary>
public static class BusinessCodes
{
    private const string Alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

    public static string New(string prefix, DateTime now) =>
        $"{prefix}-{now:yyyyMMdd}-{RandomNumberGenerator.GetString(Alphabet, 8)}";
}
