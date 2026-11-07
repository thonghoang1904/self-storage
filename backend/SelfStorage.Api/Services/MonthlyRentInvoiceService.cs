using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Services;

public sealed class MonthlyRentInvoiceService(
    IServiceScopeFactory scopeFactory,
    TimeProvider clock,
    ILogger<MonthlyRentInvoiceService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(6));
        do
        {
            try
            {
                await CreateDueInvoicesAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // One failed run (e.g. the database is briefly unavailable) must not stop the service or the host.
                logger.LogError(ex, "Monthly rent invoicing failed; retrying on the next tick");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task CreateDueInvoicesAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SelfStorageDbContext>();
        var billing = scope.ServiceProvider.GetRequiredService<BillingService>();
        var emailOutbox = scope.ServiceProvider.GetRequiredService<EmailOutboxService>();
        var today = DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var generationThrough = today.AddDays(7);
        await db.Invoices
            .Where(i => i.Status == "Unpaid" && i.DueDate < today
                && (i.InvoiceType == "MONTHLY_RENT" || i.InvoiceType == "EXTRA_CHARGE"))
            .ExecuteUpdateAsync(update => update.SetProperty(i => i.Status, "Overdue"), ct);
        var contracts = await db.Contracts
            .Where(c => c.Status == ContractStatus.Active && c.StartDate < c.EndDate)
            .Select(c => new
            {
                c.ContractId,
                c.ContractNumber,
                c.CustomerId,
                c.StartDate,
                c.EndDate,
                c.MonthlyRentFee,
            })
            .ToListAsync(ct);

        var contractIds = contracts.Select(c => c.ContractId).ToArray();
        var pendingEarlyReturnDates = contractIds.Length == 0
            ? new Dictionary<int, DateOnly>()
            : await db.EarlyReturnRequests
                .Where(r => contractIds.Contains(r.ContractId)
                    && r.Status == EarlyReturnStatus.Pending
                    && r.ReturnDate >= today)
                .ToDictionaryAsync(r => r.ContractId, r => r.ReturnDate, ct);

        foreach (var contract in contracts)
        {
            var paidRenewalIntervals = await LoadMergedPaidRenewalIntervalsAsync(db, contract.ContractId, ct);
            var hasUpcomingEarlyReturn = pendingEarlyReturnDates.TryGetValue(
                contract.ContractId, out var scheduledEarlyReturnDate);

            for (var month = 0; month < 600; month++)
            {
                var periodStart = contract.StartDate.AddMonths(month);
                if (periodStart >= contract.EndDate || periodStart > generationThrough)
                    break;
                if (hasUpcomingEarlyReturn && periodStart >= scheduledEarlyReturnDate)
                    break;
                var periodEnd = contract.StartDate.AddMonths(month + 1);
                if (periodEnd > contract.EndDate)
                    periodEnd = contract.EndDate;
                if (IsCoveredByMergedIntervals(paidRenewalIntervals, periodStart, periodEnd))
                    continue;
                if (await db.Invoices.AnyAsync(i => i.ContractId == contract.ContractId
                    && i.InvoiceType == "MONTHLY_RENT" && i.BillingPeriodStart == periodStart, ct))
                    continue;

                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var invoice = billing.CreateInvoice(
                    contract.CustomerId,
                    "MONTHLY_RENT",
                    periodStart,
                    $"Tiền thuê kỳ {periodStart:dd/MM/yyyy} - {periodEnd:dd/MM/yyyy} cho hợp đồng {contract.ContractNumber}",
                    contract.MonthlyRentFee,
                    contractId: contract.ContractId,
                    billingPeriodStart: periodStart,
                    billingPeriodEnd: periodEnd);
                if (periodStart < today)
                    invoice.Status = "Overdue";
                db.Invoices.Add(invoice);
                try
                {
                    await db.SaveChangesAsync(ct);
                    await emailOutbox.QueueInvoiceIssuedAsync(invoice.InvoiceId, ct);
                    await db.SaveChangesAsync(ct);
                    await transaction.CommitAsync(ct);
                    logger.LogInformation("Created monthly rent invoice for contract {ContractId}, period {PeriodStart}",
                        contract.ContractId, periodStart);
                }
                catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
                {
                    await transaction.RollbackAsync(ct);
                    db.Entry(invoice).State = EntityState.Detached;
                    logger.LogInformation("Monthly rent invoice already exists for contract {ContractId}, period {PeriodStart}",
                        contract.ContractId, periodStart);
                }
            }
        }
    }

    /// <summary>
    /// Merges contiguous or overlapping paid renewals (e.g. [28/02..28/03] + [28/03..28/04] -> [28/02..28/04])
    /// so a monthly billing period [StartDate.AddMonths(m), StartDate.AddMonths(m+1)] straddling a clamped month-end
    /// boundary is still recognized as already paid via renewal.
    /// </summary>
    private static async Task<List<(DateOnly Start, DateOnly End)>> LoadMergedPaidRenewalIntervalsAsync(
        SelfStorageDbContext db, int contractId, CancellationToken ct)
    {
        var raw = await db.ContractRenewals
            .Where(r => r.ContractId == contractId && r.Status == "Paid")
            .OrderBy(r => r.OldEndDate)
            .ThenBy(r => r.NewEndDate)
            .Select(r => new { r.OldEndDate, r.NewEndDate })
            .ToListAsync(ct);

        var merged = new List<(DateOnly Start, DateOnly End)>();
        foreach (var item in raw)
        {
            if (merged.Count > 0 && item.OldEndDate <= merged[^1].End)
            {
                var current = merged[^1];
                if (item.NewEndDate > current.End)
                    merged[^1] = (current.Start, item.NewEndDate);
            }
            else
            {
                merged.Add((item.OldEndDate, item.NewEndDate));
            }
        }

        return merged;
    }

    private static bool IsCoveredByMergedIntervals(
        IReadOnlyList<(DateOnly Start, DateOnly End)> intervals, DateOnly periodStart, DateOnly periodEnd) =>
        intervals.Any(interval => interval.Start <= periodStart && interval.End >= periodEnd);
}
