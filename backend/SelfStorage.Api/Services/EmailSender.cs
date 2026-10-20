using System.Net;
using System.Net.Mail;
using System.Text;
using Microsoft.Extensions.Options;

namespace SelfStorage.Api.Services;

public sealed class SmtpEmailOptions
{
    public const string SectionName = "Smtp";
    public string Host { get; set; } = "smtp.gmail.com";
    public int Port { get; set; } = 587;
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "Self-Storage";
    public bool EnableSsl { get; set; } = true;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Username)
        && !string.IsNullOrWhiteSpace(Password)
        && MailAddress.TryCreate(FromAddress, out _);
}

public sealed class EmailDeliveryException(string message, Exception innerException)
    : Exception(message, innerException);

public interface IEmailSender
{
    void ValidateConfiguration();
    Task SendPasswordResetAsync(string email, string fullName, string token, CancellationToken ct);
}

public sealed class SmtpEmailSender(IOptions<SmtpEmailOptions> options) : IEmailSender
{
    private const string Subject = "Đặt lại mật khẩu tài khoản Self-Storage";

    public void ValidateConfiguration()
    {
        var smtp = options.Value;
        if (string.IsNullOrWhiteSpace(smtp.Host)
            || smtp.Port is < 1 or > 65535
            || string.IsNullOrWhiteSpace(smtp.Username)
            || string.IsNullOrWhiteSpace(smtp.Password)
            || !MailAddress.TryCreate(smtp.FromAddress, out _)
            || !smtp.EnableSsl)
            throw new InvalidOperationException(
                "Cấu hình SMTP chưa đầy đủ hoặc chưa bật TLS. Hãy kiểm tra các khóa Smtp trong User Secrets.");
    }

    public async Task SendPasswordResetAsync(string email, string fullName, string token, CancellationToken ct)
    {
        ValidateConfiguration();
        var smtp = options.Value;
        if (!MailAddress.TryCreate(email, out var recipient))
            throw new InvalidOperationException("Địa chỉ email nhận không hợp lệ.");

        using var message = CreateMessage(smtp, recipient, fullName, token);
        using var client = new SmtpClient(smtp.Host, smtp.Port)
        {
            EnableSsl = true,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            UseDefaultCredentials = false,
            Credentials = new NetworkCredential(smtp.Username, smtp.Password),
        };

        try
        {
            await client.SendMailAsync(message, ct);
        }
        catch (SmtpException ex)
        {
            throw new EmailDeliveryException("The SMTP server could not send the message.", ex);
        }
    }

    internal static MailMessage CreateMessage(
        SmtpEmailOptions smtp, MailAddress recipient, string fullName, string token)
    {
        var safeName = WebUtility.HtmlEncode(fullName);
        var safeToken = WebUtility.HtmlEncode(token);
        var html = $"""
            <!doctype html>
            <html lang="vi">
              <body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
                <div style="max-width:560px;margin:32px auto;padding:0 16px">
                  <div style="background:#173b57;padding:22px 28px;border-radius:12px 12px 0 0;color:#fff">
                    <div style="font-size:20px;font-weight:700">SELF-STORAGE</div>
                    <div style="margin-top:5px;font-size:13px;color:#d8e5ef">Hệ thống quản lý kho lưu trữ tự phục vụ</div>
                  </div>
                  <div style="background:#fff;padding:30px 28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 12px 12px">
                    <h1 style="margin:0 0 18px;font-size:22px">Đặt lại mật khẩu</h1>
                    <p>Xin chào <strong>{safeName}</strong>,</p>
                    <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Self-Storage của bạn. Dùng mã bảo mật dưới đây trong API <code>POST /api/auth/reset-password</code>:</p>
                    <div style="margin:24px 0;padding:16px;background:#f3f6f9;border:1px solid #dce4eb;border-radius:8px;text-align:center">
                      <code style="font-size:18px;font-weight:700;letter-spacing:1px;overflow-wrap:anywhere">{safeToken}</code>
                    </div>
                    <p>Mã có hiệu lực trong <strong>30 phút</strong> và chỉ sử dụng được một lần. Không chia sẻ mã này với bất kỳ ai.</p>
                    <p>Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Mật khẩu hiện tại của bạn sẽ không thay đổi.</p>
                    <hr style="margin:26px 0;border:0;border-top:1px solid #e5e7eb">
                    <p style="margin:0;color:#6b7280;font-size:12px">Đây là email tự động, vui lòng không trả lời. Đội ngũ Self-Storage</p>
                  </div>
                </div>
              </body>
            </html>
            """;
        var text = $"Xin chào {fullName}, mã đặt lại mật khẩu Self-Storage của bạn là: {token}\r\n" +
                   "Gửi mã này tới POST /api/auth/reset-password trong vòng 30 phút. Mã chỉ dùng được một lần. " +
                   "Nếu bạn không yêu cầu, hãy bỏ qua email này.";
        var message = new MailMessage
        {
            From = new MailAddress(smtp.FromAddress, smtp.FromName, Encoding.UTF8),
            Subject = Subject,
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
        };
        message.To.Add(recipient);
        message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(text, Encoding.UTF8, "text/plain"));
        message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(html, Encoding.UTF8, "text/html"));
        return message;
    }
}

/// <summary>
/// Used in Development when no SMTP credentials are configured (e.g. right after cloning the repo):
/// instead of sending, the reset token is logged and the email is saved as an .eml file under dev-emails/.
/// </summary>
public sealed class DevelopmentEmailSender(
    IWebHostEnvironment environment, ILogger<DevelopmentEmailSender> logger) : IEmailSender
{
    public void ValidateConfiguration() { }

    public async Task SendPasswordResetAsync(string email, string fullName, string token, CancellationToken ct)
    {
        if (!MailAddress.TryCreate(email, out var recipient))
            throw new InvalidOperationException("Địa chỉ email nhận không hợp lệ.");

        var folder = Path.Combine(environment.ContentRootPath, "dev-emails");
        Directory.CreateDirectory(folder);
        var smtp = new SmtpEmailOptions { FromAddress = "no-reply@self-storage.local" };
        using var message = SmtpEmailSender.CreateMessage(smtp, recipient, fullName, token);
        using var client = new SmtpClient
        {
            DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory,
            PickupDirectoryLocation = folder,
        };
        await client.SendMailAsync(message, ct);

        logger.LogWarning(
            "SMTP chưa cấu hình, email không được gửi thật. Mã đặt lại mật khẩu cho {Email}: {Token} (bản email lưu tại {Folder})",
            email, token, folder);
    }
}
