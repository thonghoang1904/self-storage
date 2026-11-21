using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Services;

public sealed class CloudinaryOptions
{
    public const string SectionName = "Cloudinary";
    public bool Enabled { get; set; }
    public string CloudName { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public string ApiSecret { get; set; } = "";
    public string Folder { get; set; } = "self-storage";
}

/// <summary>
/// Uploads validated image files (JPG, PNG, WebP) directly to Cloudinary via the signed REST upload API
/// using stable public IDs with overwrite enabled so re-uploads never orphan old assets.
/// </summary>
public sealed class CloudinaryImageService(
    HttpClient http,
    IOptions<CloudinaryOptions> options,
    TimeProvider clock,
    ILogger<CloudinaryImageService> logger)
{
    public const int MaxFileBytes = 5 * 1024 * 1024;
    private const string UploadTransformation = "c_limit,w_1600,q_auto";

    public async Task<string> UploadImageAsync(
        IFormFile? file, string subfolder, string publicId, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            throw AppException.BadRequest("Vui lòng chọn tệp hình ảnh");
        if (file.Length > MaxFileBytes)
            throw AppException.BadRequest("Ảnh tải lên không được vượt quá 5 MB");

        byte[] bytes;
        await using (var stream = file.OpenReadStream())
        using (var ms = new MemoryStream((int)file.Length))
        {
            await stream.CopyToAsync(ms, ct);
            bytes = ms.ToArray();
        }

        if (bytes.Length == 0)
            throw AppException.BadRequest("Vui lòng chọn tệp hình ảnh");
        if (bytes.Length > MaxFileBytes)
            throw AppException.BadRequest("Ảnh tải lên không được vượt quá 5 MB");

        var format = DetectImageFormat(bytes)
            ?? throw AppException.BadRequest("Chỉ hỗ trợ ảnh định dạng JPG, PNG hoặc WebP");

        var cfg = options.Value;
        if (!cfg.Enabled
            || string.IsNullOrWhiteSpace(cfg.CloudName)
            || string.IsNullOrWhiteSpace(cfg.ApiKey)
            || string.IsNullOrWhiteSpace(cfg.ApiSecret))
        {
            throw AppException.Conflict("Chức năng tải ảnh (Cloudinary) chưa được cấu hình trên máy chủ");
        }

        var cloudName = cfg.CloudName.Trim();
        var apiKey = cfg.ApiKey.Trim();
        var apiSecret = cfg.ApiSecret.Trim();
        var folder = CombineFolder(cfg.Folder, subfolder);
        var cleanPublicId = publicId.Trim('/');

        var signedParams = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["invalidate"] = "true",
            ["overwrite"] = "true",
            ["public_id"] = cleanPublicId,
            ["timestamp"] = clock.GetUtcNow().ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
            ["transformation"] = UploadTransformation,
        };
        if (!string.IsNullOrEmpty(folder))
            signedParams["folder"] = folder;

        var stringToSign = string.Join("&", signedParams.Select(kv => $"{kv.Key}={kv.Value}")) + apiSecret;
        var signature = Convert.ToHexStringLower(SHA1.HashData(Encoding.UTF8.GetBytes(stringToSign)));

        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(format.ContentType);
        form.Add(fileContent, "file", $"{cleanPublicId}{format.Extension}");
        form.Add(new StringContent(apiKey), "api_key");
        form.Add(new StringContent(signature), "signature");
        foreach (var kv in signedParams)
            form.Add(new StringContent(kv.Value), kv.Key);

        var endpoint = $"https://api.cloudinary.com/v1_1/{Uri.EscapeDataString(cloudName)}/image/upload";
        HttpResponseMessage response;
        string responseBody;
        try
        {
            response = await http.PostAsync(endpoint, form, ct);
            responseBody = await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            logger.LogError(ex, "Cloudinary upload request failed for {PublicId}", cleanPublicId);
            throw AppException.Conflict("Không thể tải ảnh lên Cloudinary, vui lòng thử lại sau");
        }

        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Cloudinary returned HTTP {StatusCode} for {PublicId}: {Body}",
                (int)response.StatusCode, cleanPublicId, responseBody);
            throw AppException.Conflict("Không thể tải ảnh lên Cloudinary, vui lòng thử lại sau");
        }

        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            if (!doc.RootElement.TryGetProperty("secure_url", out var urlProp)
                || urlProp.ValueKind != JsonValueKind.String)
                throw AppException.Conflict("Phản hồi từ Cloudinary không chứa đường dẫn ảnh hợp lệ");

            var secureUrl = urlProp.GetString()?.Trim();
            if (string.IsNullOrEmpty(secureUrl)
                || secureUrl.Length > 500
                || !Uri.TryCreate(secureUrl, UriKind.Absolute, out var uri)
                || uri.Scheme != Uri.UriSchemeHttps)
                throw AppException.Conflict("Đường dẫn ảnh nhận từ Cloudinary không hợp lệ");

            return secureUrl;
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Invalid JSON from Cloudinary for {PublicId}: {Body}", cleanPublicId, responseBody);
            throw AppException.Conflict("Không thể đọc phản hồi từ Cloudinary, vui lòng thử lại sau");
        }
    }

    private static string CombineFolder(string? root, string? sub)
    {
        var parts = new[] { root, sub }
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s!.Trim().Trim('/'))
            .Where(s => s.Length > 0);
        return string.Join('/', parts);
    }

    private static (string ContentType, string Extension)? DetectImageFormat(ReadOnlySpan<byte> bytes)
    {
        // JPEG: FF D8 FF
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            return ("image/jpeg", ".jpg");

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (bytes.Length >= 8
            && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47
            && bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A)
            return ("image/png", ".png");

        // WebP: "RIFF" .... "WEBP"
        if (bytes.Length >= 12
            && bytes[0] == (byte)'R' && bytes[1] == (byte)'I' && bytes[2] == (byte)'F' && bytes[3] == (byte)'F'
            && bytes[8] == (byte)'W' && bytes[9] == (byte)'E' && bytes[10] == (byte)'B' && bytes[11] == (byte)'P')
            return ("image/webp", ".webp");

        return null;
    }
}
