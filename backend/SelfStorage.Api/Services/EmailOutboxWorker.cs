using System.Data;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Services;

public sealed class EmailOutboxWorker(
    IServiceScopeFactory scopeFactory,
    TimeProvider clock,
    ILogger<EmailOutboxWorker> logger) : BackgroundService
{
    private const int MaximumAttempts = 8;
    private static readonly TimeSpan ClaimLease = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var sent = await ProcessNextAsync(stoppingToken);
                if (!sent)
                    await Task.Delay(IdleDelay, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Email outbox worker encountered an unexpected error.");
                await Task.Delay(IdleDelay, stoppingToken);
            }
        }
    }

    private async Task<bool> ProcessNextAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SelfStorageDbContext>();
        var now = clock.GetLocalNow().DateTime;
        EmailOutboxMessage? message;

        await using (var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct))
        {
            message = await db.EmailOutboxMessages
                .Where(m => (m.EventKey.StartsWith("invoice-issued:")
                    || m.EventKey.StartsWith("payment-received:"))
                    && ((m.Status == "Pending" && m.NextAttemptAt <= now)
                    || (m.Status == "Processing" && m.LockedUntil <= now))
                )
                .OrderBy(m => m.CreatedAt)
                .ThenBy(m => m.EmailOutboxMessageId)
                .FirstOrDefaultAsync(ct);
            if (message is null)
            {
                await transaction.CommitAsync(ct);
                return false;
            }

            message.Status = "Processing";
            message.LockedUntil = now.Add(ClaimLease);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }

        try
        {
            var sender = scope.ServiceProvider.GetRequiredService<IEmailSender>();
            await sender.SendAsync(message.RecipientEmail, message.RecipientName,
                new EmailContent(message.Subject, message.HtmlBody, message.TextBody), ct);
            message.Status = "Sent";
            message.SentAt = clock.GetLocalNow().DateTime;
            message.LockedUntil = null;
            message.LastError = null;
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Delivered email outbox message {MessageId} ({EventKey})",
                message.EmailOutboxMessageId, message.EventKey);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            message.AttemptCount++;
            message.LockedUntil = null;
            message.LastError = ex.Message.Length <= 2000 ? ex.Message : ex.Message[..2000];
            if (message.AttemptCount >= MaximumAttempts)
            {
                message.Status = "Failed";
                logger.LogError(ex,
                    "Email outbox message {MessageId} ({EventKey}) failed permanently after {AttemptCount} attempts.",
                    message.EmailOutboxMessageId, message.EventKey, message.AttemptCount);
            }
            else
            {
                var delayMinutes = Math.Min(5 * Math.Pow(2, message.AttemptCount - 1), 360);
                message.Status = "Pending";
                message.NextAttemptAt = clock.GetLocalNow().DateTime.AddMinutes(delayMinutes);
                logger.LogWarning(ex,
                    "Email outbox message {MessageId} ({EventKey}) failed on attempt {AttemptCount}; retry scheduled after {DelayMinutes} minutes.",
                    message.EmailOutboxMessageId, message.EventKey, message.AttemptCount, delayMinutes);
            }

            await db.SaveChangesAsync(ct);
        }

        return true;
    }
}
