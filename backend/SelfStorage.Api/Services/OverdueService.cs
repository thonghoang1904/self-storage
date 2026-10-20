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
        var policies = scope.ServiceProvider.GetRequiredService<RentalPolicyService>();
        var now = clock.GetLocalNow().DateTime;
        var today = DateOnly.FromDateTime(now);
        var expiredReservations = await db.Reservations
            .Where(r => r.Status == ReservationStatus.PendingDeposit && r.DepositDeadline <= now)
            .ToListAsync(ct);
        foreach (var reservation in expiredReservations)
        {
            reservation.Status = ReservationStatus.Expired;
            var invoice = await db.Invoices.FirstOrDefaultAsync(i =>
                i.ReservationId == reservation.ReservationId && i.InvoiceType == "DEPOSIT" && i.Status == "Unpaid", ct);
            if (invoice is not null) invoice.Status = "Cancelled";
        }

        var contracts = await db.Contracts.Include(c => c.Unit)
            .Where(c => c.EndDate <= today
                && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Overdue))
            .ToListAsync(ct);
        var lateFee = contracts.Count == 0
            ? null
            : await db.FeeConfigurations.FirstOrDefaultAsync(f => f.FeeCode == "LATE_FEE_DAILY", ct)
                ?? throw new InvalidOperationException("LATE_FEE_DAILY must be configured in FeeConfigurations.");

        foreach (var contract in contracts)
        {
            var policy = await policies.ForFacilityAsync(contract.Unit.FacilityId, ct);
            var lockAt = contract.EndDate.ToDateTime(new TimeOnly(20, 0))
                .AddDays(policy.MaxOverdueDaysBeforeLock);
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

            var dailyRate = lateFee!.CalculationMethod switch
            {
                "DailyRate" => lateFee.DefaultAmount,
                "Percentage" => decimal.Round(contract.MonthlyRentFee * lateFee.DefaultAmount / 3000m, 2,
                    MidpointRounding.AwayFromZero),
                _ => throw new InvalidOperationException("LATE_FEE_DAILY must use DailyRate or Percentage."),
            };
            overdue.DaysOverdue = daysOverdue;
            overdue.AccumulatedLateFee = dailyRate * daysOverdue;
            overdue.ActionTaken = "UnitLocked";
            overdue.LockAppliedDate = lockAt;
            overdue.Notes = $"Phí lưu kho quá hạn {dailyRate:N2}đ/ngày, cấn trừ tự động vào tiền cọc.";
            contract.Status = ContractStatus.Overdue;
            contract.Unit.Status = UnitStatus.OverdueLocked;
        }

        if (contracts.Count > 0 || expiredReservations.Count > 0)
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation(
                "Updated overdue charges for {ContractCount} contracts and expired {ReservationCount} reservations",
                contracts.Count, expiredReservations.Count);
        }
    }
}
