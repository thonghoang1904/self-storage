using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/admin/email-outbox")]
[Authorize(Roles = AppRoles.Admin)]
public sealed class AdminEmailOutboxController(SelfStorageDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet]
    public async Task<List<EmailOutboxDto>> List(
        [FromQuery] string? status,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        if (page < 1 || pageSize is < 1 or > 100)
            throw AppException.BadRequest("page phải từ 1 và pageSize phải từ 1 đến 100");
        if (!string.IsNullOrWhiteSpace(status)
            && status is not ("Pending" or "Processing" or "Sent" or "Failed"))
            throw AppException.BadRequest("Trạng thái email không hợp lệ");

        var query = db.EmailOutboxMessages
            .Where(m => m.EventKey.StartsWith("invoice-issued:")
                || m.EventKey.StartsWith("payment-received:"));
        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(m => m.Status == status);
        return await query.OrderByDescending(m => m.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(m => new EmailOutboxDto(m.EmailOutboxMessageId, m.EventKey,
                m.RecipientEmail, m.Subject, m.Status, m.AttemptCount,
                m.CreatedAt, m.NextAttemptAt, m.SentAt, m.LastError))
            .ToListAsync(ct);
    }

    [HttpPost("{messageId:long}/retry")]
    public async Task<EmailOutboxDto> Retry(long messageId, CancellationToken ct)
    {
        var message = await db.EmailOutboxMessages.FirstOrDefaultAsync(
            m => m.EmailOutboxMessageId == messageId
                && (m.EventKey.StartsWith("invoice-issued:")
                    || m.EventKey.StartsWith("payment-received:")), ct)
            ?? throw AppException.NotFound("Không tìm thấy email trong hàng đợi");
        if (message.Status != "Failed")
            throw AppException.Conflict("Chỉ có thể gửi lại email ở trạng thái Failed");

        message.Status = "Pending";
        message.AttemptCount = 0;
        message.NextAttemptAt = clock.GetLocalNow().DateTime;
        message.LockedUntil = null;
        message.LastError = null;
        await db.SaveChangesAsync(ct);
        return new EmailOutboxDto(message.EmailOutboxMessageId, message.EventKey,
            message.RecipientEmail, message.Subject, message.Status, message.AttemptCount,
            message.CreatedAt, message.NextAttemptAt, message.SentAt, message.LastError);
    }
}
