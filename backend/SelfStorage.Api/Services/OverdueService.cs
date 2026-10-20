using System.Data;
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
        var expiredReservationIds = await db.Reservations
            .Where(r => r.Status == ReservationStatus.PendingDeposit && r.DepositDeadline <= now)
            .Select(r => r.ReservationId)
            .ToListAsync(ct);
        var expiredReservationCount = 0;
        foreach (var reservationId in expiredReservationIds)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var reservation = await db.Reservations.FirstOrDefaultAsync(r =>
                r.ReservationId == reservationId && r.Status == ReservationStatus.PendingDeposit
                && r.DepositDeadline <= now, ct);
            if (reservation is null)
            {
                await transaction.CommitAsync(ct);
                continue;
            }

            reservation.Status = ReservationStatus.Expired;
            var invoice = await db.Invoices.Include(i => i.Payments).FirstOrDefaultAsync(i =>
                i.ReservationId == reservation.ReservationId && i.InvoiceType == "DEPOSIT" && i.Status == "Unpaid", ct);
            if (invoice is not null)
            {
                invoice.Status = "Cancelled";
                foreach (var payment in invoice.Payments.Where(p => p.Status == "Pending"))
                {
                    payment.Status = "Failed";
                    payment.PaymentNotes = "Giao dịch bị hủy do đơn đặt kho đã hết hạn.";
                }
            }
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            expiredReservationCount++;
        }

        var noShowReservationIds = await db.Reservations
            .Where(r => r.Status == ReservationStatus.Confirmed
                && r.ExpectedStartDate <= today
                && !db.Contracts.Any(c => c.ReservationId == r.ReservationId))
            .Select(r => r.ReservationId)
            .ToListAsync(ct);
        var noShowCount = 0;
        foreach (var reservationId in noShowReservationIds)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var reservation = await db.Reservations.FirstOrDefaultAsync(r =>
                r.ReservationId == reservationId && r.Status == ReservationStatus.Confirmed, ct);
            if (reservation is null
                || reservation.ExpectedStartDate.ToDateTime(new TimeOnly(20, 0)) > now
                || await db.Contracts.AnyAsync(c => c.ReservationId == reservationId, ct))
            {
                await transaction.CommitAsync(ct);
                continue;
            }

            var depositInvoice = await db.Invoices.Include(i => i.Payments)
                .FirstOrDefaultAsync(i => i.ReservationId == reservationId
                    && i.InvoiceType == "DEPOSIT", ct);
            var paidDeposit = depositInvoice?.Payments.Where(p => p.Status == "Success")
                .Sum(p => p.AmountPaid) ?? 0m;
            if (depositInvoice is null || depositInvoice.Status != "Paid"
                || paidDeposit < depositInvoice.TotalAmount)
            {
                logger.LogError(
                    "Cannot expire no-show reservation {ReservationId}: the deposit invoice is not fully paid.",
                    reservationId);
                await transaction.RollbackAsync(ct);
                continue;
            }

            var policy = await policies.ForFacilityAsync(reservation.FacilityId, ct);
            var cancellationFee = decimal.Round(
                paidDeposit * policy.CancellationFeePercent / 100m, 2, MidpointRounding.AwayFromZero);
            var approvedRefund = Math.Max(0m, paidDeposit - cancellationFee);
            var cancellation = await db.ReservationCancellationRequests
                .FirstOrDefaultAsync(r => r.ReservationId == reservationId && r.Status == "Pending", ct);
            if (cancellation is null)
            {
                cancellation = new ReservationCancellationRequest
                {
                    ReservationId = reservationId,
                    CustomerId = reservation.CustomerId,
                    Reason = "Khách không đến nhận kho trước 20:00 ngày bắt đầu thuê.",
                    RequestedAt = now,
                };
                db.ReservationCancellationRequests.Add(cancellation);
            }
            cancellation.Status = "Approved";
            cancellation.ResolvedAt = now;
            cancellation.ApprovedRefundAmount = approvedRefund;
            cancellation.ResolutionNotes =
                $"Đơn tự hết hạn do khách không đến nhận kho. Áp dụng phí hủy {policy.CancellationFeePercent:N2}% ({cancellationFee:N0}đ); staff ghi nhận khoản hoàn thực tế.";
            reservation.Status = ReservationStatus.Expired;
            foreach (var payment in depositInvoice.Payments.Where(p => p.Status == "Pending"))
            {
                payment.Status = "Failed";
                payment.PaymentNotes = "Giao dịch bị hủy do đơn đặt kho hết hạn vì khách không đến nhận kho.";
            }
            db.ActivityLogs.Add(new ActivityLog
            {
                UserId = null,
                Action = "ReservationNoShowExpired",
                Details = $"Reservation {reservation.ReservationCode}; approved refund {approvedRefund:N0}",
                CreatedAt = now,
            });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            noShowCount++;
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

        if (contracts.Count > 0 || expiredReservationCount > 0 || noShowCount > 0)
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation(
                "Updated overdue charges for {ContractCount} contracts, expired {DepositExpiredCount} unpaid reservations, and expired {NoShowCount} no-shows",
                contracts.Count, expiredReservationCount, noShowCount);
        }
    }
}
