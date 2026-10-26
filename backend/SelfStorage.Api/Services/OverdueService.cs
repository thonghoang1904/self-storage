using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Services;

/// <summary>
/// Housekeeping every minute: expire stale online checkouts, unpaid and no-show reservations, and lock contracts
/// that stayed past the lock grace period (late fees are deducted from the deposit).
/// </summary>
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
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // One failed run (e.g. the database is briefly unavailable) must not stop the service or the host.
                logger.LogError(ex, "Overdue processing failed; retrying on the next tick");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SelfStorageDbContext>();
        var policies = scope.ServiceProvider.GetRequiredService<RentalPolicyService>();
        var now = clock.GetLocalNow().DateTime;

        var stalePayments = await ExpireStaleOnlinePaymentsAsync(db, now, ct);
        var unpaid = await ExpireUnpaidReservationsAsync(db, now, ct);
        var noShows = await ExpireNoShowReservationsAsync(db, policies, now, ct);
        var locked = await LockOverdueContractsAsync(db, policies, now, ct);

        if (stalePayments + unpaid + noShows + locked > 0)
            logger.LogInformation(
                "Expired {Payments} stale checkouts, {Unpaid} unpaid and {NoShows} no-show reservations; "
                + "updated overdue charges for {Contracts} contracts",
                stalePayments, unpaid, noShows, locked);
    }

    /// <summary>A checkout the gateway never confirmed stops blocking the invoice; a late confirmation is still recorded.</summary>
    private static Task<int> ExpireStaleOnlinePaymentsAsync(SelfStorageDbContext db, DateTime now, CancellationToken ct)
    {
        var cutoff = now - BillingService.PendingOnlinePaymentTimeout;
        return db.Payments
            .Where(p => p.Status == "Pending" && (p.PaymentMethod == "VNPay" || p.PaymentMethod == "MoMo")
                && p.PaymentDate < cutoff)
            .ExecuteUpdateAsync(update => update
                .SetProperty(p => p.Status, "Failed")
                .SetProperty(p => p.PaymentNotes,
                    "Hết thời gian chờ cổng thanh toán xác nhận; nếu cổng báo thành công sau đó, hệ thống vẫn ghi nhận."), ct);
    }

    /// <summary>Deposit not paid in time. A reservation whose deposit is being paid online right now is left alone.</summary>
    private static async Task<int> ExpireUnpaidReservationsAsync(SelfStorageDbContext db, DateTime now, CancellationToken ct)
    {
        var reservations = await db.Reservations
            .Where(r => r.Status == ReservationStatus.PendingDeposit && r.DepositDeadline <= now
                && !db.Invoices.Any(i => i.ReservationId == r.ReservationId && i.InvoiceType == "DEPOSIT"
                    && i.Payments.Any(p => p.Status == "Pending")))
            .ToListAsync(ct);
        foreach (var reservation in reservations)
        {
            reservation.Status = ReservationStatus.Expired;
            var invoice = await db.Invoices.FirstOrDefaultAsync(i =>
                i.ReservationId == reservation.ReservationId && i.InvoiceType == "DEPOSIT" && i.Status == "Unpaid", ct);
            if (invoice is not null) invoice.Status = "Cancelled";
        }
        if (reservations.Count > 0) await db.SaveChangesAsync(ct);
        return reservations.Count;
    }

    /// <summary>
    /// Deposit paid but nobody came by ReservationSchedule.LastCheckInDate: release the unit and approve the
    /// deposit refund minus the cancellation fee, so staff can pay it back via cancellation-refunds.
    /// </summary>
    private static async Task<int> ExpireNoShowReservationsAsync(
        SelfStorageDbContext db, RentalPolicyService policies, DateTime now, CancellationToken ct)
    {
        var lastAllowedStart = DateOnly.FromDateTime(now).AddDays(-ReservationSchedule.NoShowGraceDays - 1);
        var reservations = await db.Reservations
            .Where(r => r.Status == ReservationStatus.Confirmed && r.ExpectedStartDate <= lastAllowedStart
                && !db.ReservationCancellationRequests.Any(c => c.ReservationId == r.ReservationId && c.Status == "Pending"))
            .ToListAsync(ct);
        foreach (var reservation in reservations)
        {
            var policy = await policies.ForFacilityAsync(reservation.FacilityId, ct);
            var paidDeposit = await db.Payments
                .Where(p => p.Status == "Success" && db.Invoices.Any(i => i.InvoiceId == p.InvoiceId
                    && i.ReservationId == reservation.ReservationId && i.InvoiceType == "DEPOSIT"))
                .SumAsync(p => p.AmountPaid, ct);
            reservation.Status = ReservationStatus.Expired;
            db.ReservationCancellationRequests.Add(new ReservationCancellationRequest
            {
                ReservationId = reservation.ReservationId,
                CustomerId = reservation.CustomerId,
                Reason = $"Khách không đến nhận kho trước hết ngày {ReservationSchedule.LastCheckInDate(reservation.ExpectedStartDate):dd/MM/yyyy}",
                Status = "Approved",
                RequestedAt = now,
                ResolvedAt = now,
                ResolutionNotes = "Hệ thống tự hủy đơn quá hạn nhận kho; tiền cọc được hoàn sau khi trừ phí hủy.",
                ApprovedRefundAmount = policy.CancellationRefund(paidDeposit, reservation.CreatedAt, now),
            });
        }
        if (reservations.Count > 0) await db.SaveChangesAsync(ct);
        return reservations.Count;
    }

    private async Task<int> LockOverdueContractsAsync(
        SelfStorageDbContext db, RentalPolicyService policies, DateTime now, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(now);
        var contracts = await db.Contracts.AsNoTracking().Include(c => c.Unit)
            .Where(c => c.EndDate <= today
                && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Overdue))
            .ToListAsync(ct);
        if (contracts.Count == 0) return 0;
        var lateFee = await db.FeeConfigurations.AsNoTracking().FirstOrDefaultAsync(f => f.FeeCode == "LATE_FEE_DAILY", ct)
            ?? throw new InvalidOperationException("LATE_FEE_DAILY must be configured in FeeConfigurations.");

        var processed = 0;
        foreach (var contract in contracts)
        {
            var policy = await policies.ForFacilityAsync(contract.Unit.FacilityId, ct);
            var lockAt = ContractSchedule.LocksAt(contract.EndDate, contract.SignedDate, policy.MaxOverdueDaysBeforeLock);
            if (now < lockAt) continue;
            // The customer is paying a renewal online right now: wait for the gateway instead of locking under it.
            if (await db.ContractRenewals.AnyAsync(r => r.ContractId == contract.ContractId && r.Status == "Pending"
                    && db.Payments.Any(p => p.InvoiceId == r.InvoiceId && p.Status == "Pending"), ct))
                continue;

            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            // Only if nobody renewed or returned the contract since it was read above (a paid renewal moves EndDate).
            var stillOverdue = await db.Contracts
                .Where(c => c.ContractId == contract.ContractId && c.EndDate == contract.EndDate
                    && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Overdue))
                .ExecuteUpdateAsync(update => update.SetProperty(c => c.Status, ContractStatus.Overdue), ct);
            if (stillOverdue == 0)
            {
                await transaction.RollbackAsync(ct);
                continue;
            }
            // A unit under maintenance keeps that status; the contract status alone blocks entry.
            await db.StorageUnits.Where(u => u.UnitId == contract.UnitId && u.Status == UnitStatus.Rented)
                .ExecuteUpdateAsync(update => update.SetProperty(u => u.Status, UnitStatus.OverdueLocked), ct);

            // A locked contract can no longer renew: close renewal requests so their invoices cannot be paid.
            var pendingRenewals = await db.ContractRenewals
                .Where(r => r.ContractId == contract.ContractId && r.Status == "Pending").ToListAsync(ct);
            foreach (var renewal in pendingRenewals)
            {
                renewal.Status = "Rejected";
                renewal.ProcessedAt = now;
            }
            var renewalInvoiceIds = pendingRenewals.Where(r => r.InvoiceId != null).Select(r => r.InvoiceId!.Value).ToList();
            await db.Invoices.Where(i => renewalInvoiceIds.Contains(i.InvoiceId) && i.Status == "Unpaid")
                .ExecuteUpdateAsync(update => update.SetProperty(i => i.Status, "Cancelled"), ct);

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

            var dailyRate = lateFee.CalculationMethod switch
            {
                "DailyRate" => lateFee.DefaultAmount,
                "Percentage" => decimal.Round(contract.MonthlyRentFee * lateFee.DefaultAmount / 3000m, 2,
                    MidpointRounding.AwayFromZero),
                _ => throw new InvalidOperationException("LATE_FEE_DAILY must use DailyRate or Percentage."),
            };
            var daysOverdue = 1 + (int)(now - lockAt).TotalDays;
            overdue.DaysOverdue = daysOverdue;
            overdue.AccumulatedLateFee = dailyRate * daysOverdue;
            overdue.ActionTaken = "UnitLocked";
            overdue.LockAppliedDate = lockAt;
            overdue.Notes = $"Phí lưu kho quá hạn {dailyRate:N2}đ/ngày, cấn trừ tự động vào tiền cọc.";
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            db.ChangeTracker.Clear();
            processed++;
        }
        return processed;
    }
}
