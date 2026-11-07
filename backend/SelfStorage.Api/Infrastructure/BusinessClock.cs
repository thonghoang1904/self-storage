using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

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

public readonly record struct OperatingWindow(bool Is24Hours, int OpenMinutes, int CloseMinutes)
{
    public bool ContainsPoint(DateTime localTime)
    {
        if (Is24Hours) return true;
        var minutes = localTime.Hour * 60 + localTime.Minute;
        return minutes >= OpenMinutes && minutes < CloseMinutes;
    }

    public bool ContainsVisit(DateTime localEntry, DateTime localExit)
    {
        if (Is24Hours) return true;
        if (localEntry.Date != localExit.Date) return false;
        var entryMinutes = localEntry.Hour * 60 + localEntry.Minute;
        var exitMinutes = localExit.Hour * 60 + localExit.Minute;
        var exitHasSubMinute = localExit.Second > 0 || localExit.Millisecond > 0;
        return entryMinutes >= OpenMinutes
            && (exitMinutes < CloseMinutes || (exitMinutes == CloseMinutes && !exitHasSubMinute));
    }

    public string FormatRange() => Is24Hours
        ? "00:00 - 24:00"
        : $"{OpenMinutes / 60:00}:{OpenMinutes % 60:00} - {CloseMinutes / 60:00}:{CloseMinutes % 60:00}";
}

/// <summary>
/// Parses Facility.OperatingHours strings such as "24/7 Access" or "06:00 - 22:00" so check-in appointments and
/// visit registrations are validated against the facility's actual opening hours.
/// </summary>
public static partial class OperatingHoursParser
{
    [GeneratedRegex(@"(?<!\d)(\d{1,2})[:h](\d{2})?\s*[-–—]\s*(\d{1,2})[:h](\d{2})?(?!\d)", RegexOptions.IgnoreCase)]
    private static partial Regex RangeRegex();

    public static bool TryParse(string? raw, out OperatingWindow window)
    {
        window = default;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        if (raw.Contains("24/7", StringComparison.OrdinalIgnoreCase)
            || raw.Contains("24/24", StringComparison.OrdinalIgnoreCase)
            || raw.Contains("24h", StringComparison.OrdinalIgnoreCase))
        {
            window = new OperatingWindow(true, 0, 24 * 60);
            return true;
        }

        var match = RangeRegex().Match(raw);
        if (!match.Success) return false;

        var openHour = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        var openMinute = match.Groups[2].Success ? int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture) : 0;
        var closeHour = int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
        var closeMinute = match.Groups[4].Success ? int.Parse(match.Groups[4].Value, CultureInfo.InvariantCulture) : 0;

        if (openHour > 24 || openMinute >= 60 || closeHour > 24 || closeMinute >= 60) return false;
        var openTotal = openHour * 60 + openMinute;
        var closeTotal = closeHour * 60 + closeMinute;
        if (openTotal > 24 * 60 || closeTotal > 24 * 60 || openTotal >= closeTotal) return false;

        window = openTotal == 0 && closeTotal == 24 * 60
            ? new OperatingWindow(true, 0, 24 * 60)
            : new OperatingWindow(false, openTotal, closeTotal);
        return true;
    }
}
