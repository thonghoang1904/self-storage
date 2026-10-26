using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;

namespace SelfStorage.Api.Infrastructure;

/// <summary>
/// CCCD, phone numbers and emails are normalized before they are stored or compared,
/// so "079 300 000 456" and "079300000456" (or "+84912..." and "0912...") are the same value.
/// </summary>
public static partial class Contact
{
    /// <summary>CCCD without spaces, dots or dashes.</summary>
    public static string NormalizeCitizenId(string value) => Separators().Replace(value, "");

    /// <summary>12 digits; the first 3 are the province code (001-096).</summary>
    public static bool IsValidCitizenId(string value)
    {
        var v = NormalizeCitizenId(value);
        return CitizenIdFormat().IsMatch(v) && int.Parse(v[..3]) is >= 1 and <= 96;
    }

    /// <summary>Phone without separators, with +84 / 84 turned into the leading 0.</summary>
    public static string NormalizePhone(string value)
    {
        var v = Separators().Replace(value, "");
        if (v.StartsWith("+84")) return "0" + v[3..];
        if (v.StartsWith("84") && v.Length == 11) return "0" + v[2..];
        return v;
    }

    /// <summary>Vietnamese mobile number: 0 + 9 digits, network prefix 3, 5, 7, 8 or 9.</summary>
    public static bool IsValidPhone(string value) => PhoneFormat().IsMatch(NormalizePhone(value));

    public static string NormalizeEmail(string value) => value.Trim().ToLowerInvariant();

    public static bool IsValidEmail(string value)
    {
        var v = NormalizeEmail(value);
        return v.Length <= 100 && EmailFormat().IsMatch(v);
    }

    [GeneratedRegex(@"[\s.\-()]")]
    private static partial Regex Separators();

    [GeneratedRegex(@"^\d{12}$")]
    private static partial Regex CitizenIdFormat();

    [GeneratedRegex(@"^0[35789]\d{8}$")]
    private static partial Regex PhoneFormat();

    [GeneratedRegex(@"^[a-z0-9](?:[a-z0-9._%+\-]*[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?\.)+[a-z]{2,}$")]
    private static partial Regex EmailFormat();
}

// Empty values pass here; [Required] decides whether the field is mandatory.

public sealed class CitizenIdAttribute() : ValidationAttribute("Số CCCD phải gồm đúng 12 chữ số, 3 số đầu là mã tỉnh (001–096)")
{
    public override bool IsValid(object? value) =>
        value is not string s || string.IsNullOrWhiteSpace(s) || Contact.IsValidCitizenId(s);
}

public sealed class VnPhoneAttribute() : ValidationAttribute("Số điện thoại không hợp lệ (ví dụ 0912345678 hoặc +84912345678)")
{
    public override bool IsValid(object? value) =>
        value is not string s || string.IsNullOrWhiteSpace(s) || Contact.IsValidPhone(s);
}

public sealed class StrictEmailAttribute() : ValidationAttribute("Email không hợp lệ (ví dụ ten@gmail.com)")
{
    public override bool IsValid(object? value) =>
        value is not string s || string.IsNullOrWhiteSpace(s) || Contact.IsValidEmail(s);
}
