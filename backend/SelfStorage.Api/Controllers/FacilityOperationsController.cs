using System.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/facilities/{facilityId:int}")]
[Authorize]
public sealed class FacilityOperationsController(
    SelfStorageDbContext db,
    AccessService access,
    RentalPolicyService rentalPolicies,
    TimeProvider clock) : ControllerBase
{
    [HttpGet("daily-operations")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<FacilityWorkQueueDto> DailyOperations(
        int facilityId, [FromQuery] DateOnly? date, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        var targetDate = date ?? DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        if (!await db.Facilities.AnyAsync(f => f.FacilityId == facilityId, ct))
            throw AppException.NotFound("Không tìm thấy cơ sở");

        var reservations = await db.Reservations
            .Where(r => r.FacilityId == facilityId
                && (r.CheckInAppointmentAt.HasValue
                    ? DateOnly.FromDateTime(r.CheckInAppointmentAt.Value.DateTime) == targetDate
                    : r.ExpectedStartDate == targetDate)
                && r.Status == ReservationStatus.Confirmed)
            .OrderBy(r => r.CheckInAppointmentAt)
            .Select(r => new ReservationDto(r.ReservationId, r.ReservationCode, r.Facility.FacilityName,
                r.UnitType.TypeName, r.AssignedUnit != null ? r.AssignedUnit.UnitCode : null,
                r.Promotion != null ? r.Promotion.PromoCode : null, r.PromotionDiscountAmount,
                r.ExpectedStartDate, r.CheckInAppointmentAt, r.DurationMonths, r.DepositAmount,
                r.EstimatedTotalFee, r.Status,
                r.DepositDeadline, r.Customer.FullName,
                db.Invoices.Where(i => i.ReservationId == r.ReservationId && i.InvoiceType == "DEPOSIT")
                    .Select(i => (int?)i.InvoiceId).FirstOrDefault()))
            .ToListAsync(ct);

        var returns = await db.Contracts
            .Where(c => c.Unit.FacilityId == facilityId && c.EndDate == targetDate
                && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Overdue))
            .OrderBy(c => c.ContractNumber)
            .Select(c => new FacilityTaskContractDto(c.ContractId, c.ContractNumber, c.Customer.FullName,
                c.Unit.UnitCode, c.EndDate, c.Status, c.DepositPaid,
                db.OverdueRecords.Where(o => o.ContractId == c.ContractId && o.ResolvedDate == null)
                    .OrderByDescending(o => o.OverdueId)
                    .Select(o => (decimal?)o.AccumulatedLateFee).FirstOrDefault() ?? 0m))
            .ToListAsync(ct);

        var supportRequests = await db.SupportRequests
            .Where(r => r.FacilityId == facilityId && (r.Status == "Open" || r.Status == "InProgress"))
            .OrderByDescending(r => r.Priority == "Urgent")
            .ThenByDescending(r => r.Priority == "High")
            .ThenBy(r => r.CreatedAt)
            .Select(r => new SupportRequestDto(r.RequestId, r.RequestCode, r.ContractId ?? 0,
                r.Unit != null ? r.Unit.UnitCode : "", r.Category, r.Priority, r.Title, r.Description,
                r.Status, r.CreatedAt, r.AssignedStaff != null ? r.AssignedStaff.FullName : null))
            .ToListAsync(ct);

        return new FacilityWorkQueueDto(targetDate, reservations, returns, supportRequests);
    }

    [HttpGet("contracts")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<ContractDto>> Contracts(
        int facilityId, [FromQuery] string? status, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        var query = db.Contracts.Where(c => c.Unit.FacilityId == facilityId);
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status is not (ContractStatus.Active or ContractStatus.Overdue
                or ContractStatus.Terminated or ContractStatus.Renewed or ContractStatus.Liquidated))
                throw AppException.BadRequest("Trạng thái hợp đồng không hợp lệ");
            query = query.Where(c => c.Status == status);
        }

        return await query.OrderByDescending(c => c.StartDate)
            .Take(500)
            .Select(ContractsController.ToDto)
            .ToListAsync(ct);
    }

    [HttpGet("cancellation-requests")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<CancellationRequestDto>> CancellationRequests(
        int facilityId, [FromQuery] string? status, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        var q = db.ReservationCancellationRequests
            .Where(r => r.Reservation.FacilityId == facilityId);
        if (!string.IsNullOrWhiteSpace(status))
            q = q.Where(r => r.Status == status);
        return await q.OrderBy(r => r.RequestedAt)
            .Select(r => new CancellationRequestDto(r.CancellationRequestId, r.ReservationId,
                r.Reservation.ReservationCode, r.Customer.FullName, r.Reason, r.Status, r.RequestedAt,
                r.ResolvedAt, r.ResolutionNotes, r.ApprovedRefundAmount))
            .ToListAsync(ct);
    }

    [HttpPost("cancellation-requests/{requestId:int}/resolve")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<CancellationRequestDto> ResolveCancellation(
        int facilityId, int requestId, ResolveCancellationRequest req, CancellationToken ct)
    {
        var staffId = User.GetUserId();
        await access.EnsureAssignedAsync(staffId, facilityId, ct);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var request = await db.ReservationCancellationRequests
            .Include(r => r.Reservation)
            .FirstOrDefaultAsync(r => r.CancellationRequestId == requestId
                && r.Reservation.FacilityId == facilityId, ct)
            ?? throw AppException.NotFound("Không tìm thấy yêu cầu hủy");
        if (request.Status != "Pending")
            throw AppException.Conflict("Yêu cầu hủy đã được xử lý");
        var approve = req.Approve == true;
        if (!approve && string.IsNullOrWhiteSpace(req.Notes))
            throw AppException.BadRequest("Vui lòng ghi lý do từ chối yêu cầu hủy để khách biết");
        if (approve && request.Reservation.Status is not
            (ReservationStatus.PendingDeposit or ReservationStatus.Confirmed))
            throw AppException.Conflict("Đơn đặt kho không còn ở trạng thái có thể hủy");

        if (approve)
        {
            var depositInvoice = await db.Invoices.Include(i => i.Payments)
                .FirstOrDefaultAsync(i => i.ReservationId == request.ReservationId
                    && i.InvoiceType == "DEPOSIT", ct);
            // Cancelling under a running online payment would leave the customer's money without an invoice.
            if (depositInvoice is not null && depositInvoice.Payments.Any(p => p.Status == "Pending"))
                throw AppException.Conflict("Khách đang thanh toán cọc trực tuyến; hãy chờ giao dịch hoàn tất rồi duyệt hủy");
            var paidDeposit = depositInvoice?.Payments.Where(p => p.Status == "Success")
                .Sum(p => p.AmountPaid) ?? 0m;
            var policy = await rentalPolicies.ForFacilityAsync(facilityId, ct);
            // Free within the grace period counted from booking to when the customer asked to cancel.
            request.ApprovedRefundAmount = policy.CancellationRefund(
                paidDeposit, request.Reservation.CreatedAt, request.RequestedAt);
            request.Reservation.Status = ReservationStatus.Cancelled;
            if (depositInvoice is { Status: "Unpaid" }) depositInvoice.Status = "Cancelled";
        }

        request.Status = approve ? "Approved" : "Rejected";
        request.ResolvedByStaffId = staffId;
        request.ResolvedAt = clock.GetLocalNow().DateTime;
        request.ResolutionNotes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = staffId,
            Action = approve ? "ReservationCancellationApproved" : "ReservationCancellationRejected",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = $"Reservation {request.Reservation.ReservationCode}; approved refund {request.ApprovedRefundAmount ?? 0m:N0}",
            CreatedAt = clock.GetLocalNow().DateTime,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await db.ReservationCancellationRequests
            .Where(r => r.CancellationRequestId == requestId)
            .Select(r => new CancellationRequestDto(r.CancellationRequestId, r.ReservationId,
                r.Reservation.ReservationCode, r.Customer.FullName, r.Reason, r.Status, r.RequestedAt,
                r.ResolvedAt, r.ResolutionNotes, r.ApprovedRefundAmount))
            .SingleAsync(ct);
    }

    [HttpGet("dashboard")]
    [Authorize(Roles = AppRoles.Manager + "," + AppRoles.OpsManager + "," + AppRoles.Admin)]
    public async Task<FacilityDashboardDto> Dashboard(
        int facilityId,
        [FromQuery] DateOnly? fromDate,
        [FromQuery] DateOnly? toDate,
        CancellationToken ct)
    {
        if (User.IsInRole(AppRoles.Manager))
            await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);

        var end = toDate ?? DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var start = fromDate ?? end.AddDays(-29);
        if (start > end)
            throw AppException.BadRequest("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");

        var facility = await db.Facilities.FirstOrDefaultAsync(f => f.FacilityId == facilityId, ct)
            ?? throw AppException.NotFound("Không tìm thấy cơ sở");
        var unitCounts = await db.StorageUnits.Where(u => u.FacilityId == facilityId)
            .GroupBy(u => u.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToDictionaryAsync(x => x.Status, x => x.Count, ct);
        var contractCounts = await db.Contracts.Where(c => c.Unit.FacilityId == facilityId)
            .GroupBy(c => c.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToDictionaryAsync(x => x.Status, x => x.Count, ct);

        var revenueByStatus = await db.Payments
            .Where(p => (p.Status == "Success" || p.Status == "Refunded") && p.PaymentMethod != "DepositOffset"
                && p.PaymentDate >= start.ToDateTime(TimeOnly.MinValue)
                && p.PaymentDate < end.AddDays(1).ToDateTime(TimeOnly.MinValue)
                && db.Invoices.Any(i => i.InvoiceId == p.InvoiceId
                    && ((i.ContractId != null && db.Contracts.Any(c => c.ContractId == i.ContractId
                        && c.Unit.FacilityId == facilityId))
                        || (i.ReservationId != null && db.Reservations.Any(r =>
                            r.ReservationId == i.ReservationId && r.FacilityId == facilityId)))))
            .GroupBy(p => p.Status)
            .Select(group => new { Status = group.Key, Amount = group.Sum(p => p.AmountPaid) })
            .ToDictionaryAsync(x => x.Status, x => x.Amount, ct);
        var netRevenue = revenueByStatus.GetValueOrDefault("Success")
            - revenueByStatus.GetValueOrDefault("Refunded");
        var openTickets = await db.SupportRequests.CountAsync(r =>
            r.FacilityId == facilityId && (r.Status == "Open" || r.Status == "InProgress"), ct);

        return new FacilityDashboardDto(
            facilityId, facility.FacilityName, start, end,
            unitCounts.Values.Sum(),
            unitCounts.GetValueOrDefault(UnitStatus.Available),
            unitCounts.GetValueOrDefault(UnitStatus.Rented),
            unitCounts.GetValueOrDefault(UnitStatus.UnderMaintenance),
            unitCounts.GetValueOrDefault(UnitStatus.OverdueLocked),
            contractCounts.GetValueOrDefault(ContractStatus.Active),
            contractCounts.GetValueOrDefault(ContractStatus.Overdue),
            openTickets, netRevenue);
    }
}
