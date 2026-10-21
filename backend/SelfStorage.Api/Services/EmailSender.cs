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
}

public sealed class EmailDeliveryException(string message, Exception innerException)
    : Exception(message, innerException);

public sealed record EmailContent(string Subject, string HtmlBody, string TextBody);

public interface IEmailSender
{
    void ValidateConfiguration();
    Task SendAsync(string email, string fullName, EmailContent content, CancellationToken ct);
    Task SendPasswordResetAsync(string email, string fullName, string token, CancellationToken ct);
}

public sealed class SmtpEmailSender(IOptions<SmtpEmailOptions> options) : IEmailSender
{
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
        var safeToken = WebUtility.HtmlEncode(token);
        var content = EmailTemplate.Layout(
            "Đặt lại mật khẩu tài khoản Self-Storage",
            "Yêu cầu đặt lại mật khẩu",
            $"""
            <p>Chào {EmailTemplate.Encode(fullName)},</p>
            <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Self-Storage của bạn. Nhập mã bên dưới trong màn hình/API đặt lại mật khẩu:</p>
            <div class="code">{safeToken}</div>
            <p>Mã có hiệu lực trong <strong>30 phút</strong> và chỉ sử dụng một lần. Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email; mật khẩu hiện tại không thay đổi.</p>
            """,
            $"Xin chào {fullName}, mã đặt lại mật khẩu Self-Storage của bạn là: {token}\r\nMã có hiệu lực trong 30 phút và chỉ sử dụng một lần. Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.");
        await SendAsync(email, fullName, content, ct);
    }

    public async Task SendAsync(string email, string fullName, EmailContent content, CancellationToken ct)
    {
        ValidateConfiguration();
        var smtp = options.Value;
        if (!MailAddress.TryCreate(email, out var recipient))
            throw new InvalidOperationException("Địa chỉ email nhận không hợp lệ.");

        var message = new MailMessage
        {
            From = new MailAddress(smtp.FromAddress, smtp.FromName, Encoding.UTF8),
            Subject = content.Subject,
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
        };
        message.To.Add(recipient);
        message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(
            content.TextBody, Encoding.UTF8, "text/plain"));
        message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(
            content.HtmlBody, Encoding.UTF8, "text/html"));
        using (message)
        using (var client = new SmtpClient(smtp.Host, smtp.Port)
        {
            EnableSsl = true,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            UseDefaultCredentials = false,
            Credentials = new NetworkCredential(smtp.Username, smtp.Password),
        })
        {
            try
            {
                await client.SendMailAsync(message, ct);
            }
            catch (SmtpException ex)
            {
                throw new EmailDeliveryException("The SMTP server could not send the message.", ex);
            }
        }
    }
}
