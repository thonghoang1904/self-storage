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

        foreach (var contract in contracts)
        {
            for (var month = 0; month < 61; month++)
            {
                var periodStart = contract.StartDate.AddMonths(month);
                if (periodStart >= contract.EndDate || periodStart > generationThrough)
                    break;
                var periodEnd = periodStart.AddMonths(1);
                if (periodEnd > contract.EndDate)
                    periodEnd = contract.EndDate;
                if (await IsCoveredByPaidRenewalAsync(db, contract.ContractId, periodStart, periodEnd, ct))
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

    private static Task<bool> IsCoveredByPaidRenewalAsync(
        SelfStorageDbContext db, int contractId, DateOnly periodStart, DateOnly periodEnd, CancellationToken ct) =>
        db.ContractRenewals.AnyAsync(r => r.ContractId == contractId && r.Status == "Paid"
            && r.OldEndDate <= periodStart && r.NewEndDate >= periodEnd, ct);
}
