using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Services;

public sealed class OverdueService(
    IServiceScopeFactory scopeFactory,
    TimeProvider clock,
    ILogger<OverdueService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            await ProcessOverdueContractsAsync(stoppingToken);
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task ProcessOverdueContractsAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SelfStorageDbContext>();
        var now = clock.GetLocalNow().DateTime;
        var today = DateOnly.FromDateTime(now);
        var contracts = await db.Contracts.Include(c => c.Unit)
            .Where(c => c.EndDate <= today
                && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Overdue))
            .ToListAsync(ct);

        foreach (var contract in contracts)
        {
            var lockAt = contract.EndDate.ToDateTime(new TimeOnly(20, 0)).AddDays(1);
            if (now < lockAt) continue;

            var daysOverdue = 1 + (int)(now - lockAt).TotalDays;
            var overdue = await db.OverdueRecords
                .Where(r => r.ContractId == contract.ContractId && r.ResolvedDate == null)
                .OrderByDescending(r => r.OverdueId)
                .FirstOrDefaultAsync(ct);
            if (overdue is null)
            {
                overdue = new OverdueRecord
                {
                    ContractId = contract.ContractId,
                    LockAppliedDate = lockAt,
                    NoticeSentDate = now,
                };
                db.OverdueRecords.Add(overdue);
            }

            var dailyRate = decimal.Round(contract.MonthlyRentFee / 30m, 2, MidpointRounding.AwayFromZero);
            overdue.DaysOverdue = daysOverdue;
            overdue.AccumulatedLateFee = dailyRate * daysOverdue;
            overdue.ActionTaken = "UnitLocked";
            overdue.LockAppliedDate = lockAt;
            overdue.Notes = $"Phí lưu kho quá hạn {dailyRate:N2}đ/ngày, cấn trừ tự động vào tiền cọc.";
            contract.Status = ContractStatus.Overdue;
            contract.Unit.Status = UnitStatus.OverdueLocked;
        }

        if (contracts.Count > 0)
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Updated overdue lock and daily charges for {ContractCount} contracts", contracts.Count);
        }
    }
}
