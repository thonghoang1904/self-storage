using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Data;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

/// <summary>Flow 1 (reservation) and Flow 2 (check-in creates the contract).</summary>
[ApiController]
[Route("api")]
[Authorize]
public class ReservationsController(
    SelfStorageDbContext db,
    AccessService access,
    BillingService billing,
    RentalPolicyService rentalPolicies,
    TimeProvider clock) : ControllerBase
{
    private DateTime Now => clock.GetLocalNow().DateTime;

    [HttpPost("reservations")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<ReservationDto> Create(CreateReservationRequest req, CancellationToken ct)
    {
        if (req.ExpectedStartDate < DateOnly.FromDateTime(Now))
            throw AppException.BadRequest("Ngày bắt đầu không được ở quá khứ");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        if (!await db.Facilities.AnyAsync(f => f.FacilityId == req.FacilityId && f.Status != "Closed", ct))
            throw AppException.NotFound("Không tìm thấy cơ sở đang hoạt động");
        var unitType = await db.UnitTypes.FindAsync([req.UnitTypeId], ct)
                       ?? throw AppException.NotFound("Không tìm thấy loại kho");
        var now = Now;
        var available = await db.StorageUnits.CountAsync(u => u.FacilityId == req.FacilityId
            && u.UnitTypeId == req.UnitTypeId && u.Status == UnitStatus.Available, ct);
        // Open reservations already hold a unit each, so they count against what is still bookable.
        var held = await db.Reservations.CountAsync(r => r.FacilityId == req.FacilityId && r.UnitTypeId == req.UnitTypeId
            && (r.Status == ReservationStatus.Confirmed
                || (r.Status == ReservationStatus.PendingDeposit && r.DepositDeadline > now)), ct);
        if (available - held <= 0)
            throw AppException.Conflict("Cơ sở này đã hết kho trống thuộc loại đã chọn");

        var policy = await rentalPolicies.ForFacilityAsync(req.FacilityId, ct);
        var customerId = User.GetUserId();
        Promotion? promotion = null;
        var promotionDiscount = 0m;
        if (!string.IsNullOrWhiteSpace(req.PromoCode))
        {
            var promoCode = req.PromoCode.Trim().ToUpperInvariant();
            promotion = await db.Promotions.FirstOrDefaultAsync(p =>
                p.PromoCode == promoCode && p.IsActive
                && p.StartDate <= DateOnly.FromDateTime(now)
                && p.EndDate >= DateOnly.FromDateTime(now), ct)
                ?? throw AppException.BadRequest("Mã khuyến mãi không hợp lệ hoặc đã hết hạn");
            if (req.DurationMonths < promotion.MinRentalMonths)
                throw AppException.BadRequest($"Mã khuyến mãi yêu cầu thuê tối thiểu {promotion.MinRentalMonths} tháng");
            if (await db.Contracts.AnyAsync(c => c.CustomerId == customerId, ct))
                throw AppException.Conflict("Mã khuyến mãi chỉ dành cho lần đầu tiên thuê kho");
            promotionDiscount = decimal.Round(unitType.BaseMonthlyRate * promotion.DiscountPercent / 100m, 2,
                MidpointRounding.AwayFromZero);
            if (promotion.MaxDiscountAmount is decimal maxDiscount)
                promotionDiscount = Math.Min(promotionDiscount, maxDiscount);
        }
        var deposit = decimal.Round(unitType.BaseMonthlyRate * policy.DepositPercent / 100m, 2,
            MidpointRounding.AwayFromZero);
        if (deposit <= 0)
            throw AppException.Conflict("Chính sách đặt cọc của cơ sở chưa được cấu hình hợp lệ");
        var reservation = new Reservation
        {
            ReservationCode = $"RSV-{Now:yyyyMMdd}-{Random.Shared.Next(100000, 999999)}",
            CustomerId = customerId,
            FacilityId = req.FacilityId,
            UnitTypeId = req.UnitTypeId,
            PromotionId = promotion?.PromotionId,
            PromotionDiscountAmount = promotionDiscount,
            ExpectedStartDate = req.ExpectedStartDate,
            DurationMonths = req.DurationMonths,
            DepositAmount = deposit,
            EstimatedTotalFee = unitType.BaseMonthlyRate * req.DurationMonths,
            DepositDeadline = Now.AddHours(policy.CancellationGraceHours),
        };
        db.Reservations.Add(reservation);
        await db.SaveChangesAsync(ct);
        db.Invoices.Add(billing.CreateInvoice(
            reservation.CustomerId,
            "DEPOSIT",
            DateOnly.FromDateTime(reservation.DepositDeadline),
            $"Tiền cọc 1 tháng cho đơn {reservation.ReservationCode}",
            reservation.DepositAmount,
            reservationId: reservation.ReservationId));
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await Project(db.Reservations.Where(r => r.ReservationId == reservation.ReservationId)).SingleAsync(ct);
    }

    [HttpGet("reservations/my")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<List<ReservationDto>> Mine(CancellationToken ct)
    {
        var me = User.GetUserId();
        return Project(db.Reservations.Where(r => r.CustomerId == me).OrderByDescending(r => r.CreatedAt)).ToListAsync(ct);
    }

    [HttpPut("reservations/{id:int}/appointment")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<ReservationDto> SetCheckInAppointment(
        int id, SetCheckInAppointmentRequest req, CancellationToken ct)
    {
        var reservation = await db.Reservations.SingleOrDefaultAsync(
            r => r.ReservationId == id && r.CustomerId == User.GetUserId(), ct)
            ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
        if (reservation.Status != ReservationStatus.Confirmed)
            throw AppException.Conflict("Chỉ đơn đã xác nhận đặt cọc mới được đặt lịch nhận kho");
        if (req.AppointmentAt <= clock.GetUtcNow()
            || DateOnly.FromDateTime(req.AppointmentAt.DateTime) != reservation.ExpectedStartDate)
            throw AppException.BadRequest("Lịch nhận kho phải là thời điểm trong tương lai thuộc ngày bắt đầu đã chọn");

        reservation.CheckInAppointmentAt = req.AppointmentAt;
        await db.SaveChangesAsync(ct);
        return await Project(db.Reservations.Where(r => r.ReservationId == id)).SingleAsync(ct);
    }

    [HttpPost("reservations/{id:int}/cancellation-requests")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<CancellationRequestDto> RequestCancellation(
        int id, CreateCancellationRequest req, CancellationToken ct)
    {
        var reservation = await db.Reservations
            .FirstOrDefaultAsync(r => r.ReservationId == id && r.CustomerId == User.GetUserId(), ct)
            ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
        if (reservation.Status is not (ReservationStatus.PendingDeposit or ReservationStatus.Confirmed))
            throw AppException.Conflict("Chỉ có thể yêu cầu hủy đơn chưa nhận kho");
        if (await db.ReservationCancellationRequests.AnyAsync(r =>
                r.ReservationId == id && r.Status == "Pending", ct))
            throw AppException.Conflict("Đơn này đang có yêu cầu hủy chờ xử lý");

        var cancellationRequest = new ReservationCancellationRequest
        {
            ReservationId = id,
            CustomerId = reservation.CustomerId,
            Reason = req.Reason.Trim(),
            RequestedAt = Now,
        };
        db.ReservationCancellationRequests.Add(cancellationRequest);
        await db.SaveChangesAsync(ct);
        return await CancellationDto(db.ReservationCancellationRequests
            .Where(r => r.CancellationRequestId == cancellationRequest.CancellationRequestId)).SingleAsync(ct);
    }

    [HttpGet("reservations/{id:int}/cancellation-requests/my")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<List<CancellationRequestDto>> MyCancellationRequests(int id, CancellationToken ct)
    {
        if (!await db.Reservations.AnyAsync(r => r.ReservationId == id && r.CustomerId == User.GetUserId(), ct))
            throw AppException.NotFound("Không tìm thấy đơn đặt kho");
        return await CancellationDto(db.ReservationCancellationRequests
            .Where(r => r.ReservationId == id).OrderByDescending(r => r.RequestedAt)).ToListAsync(ct);
    }

    [HttpPost("reservations/{id:int}/cancellation-refunds")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<CancellationRefundDto> RecordCancellationRefund(
        int id, RecordCancellationRefundRequest req, CancellationToken ct)
    {
        if (req.PaymentMethod is not ("Cash" or "BankTransfer"))
            throw AppException.BadRequest("Phương thức hoàn cọc chỉ hỗ trợ tiền mặt hoặc chuyển khoản");
        var transactionCode = string.IsNullOrWhiteSpace(req.TransactionCode) ? null : req.TransactionCode.Trim();
        if (req.PaymentMethod == "BankTransfer" && transactionCode is null)
            throw AppException.BadRequest("Hoàn cọc qua chuyển khoản phải có mã giao dịch");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var reservation = await db.Reservations.FirstOrDefaultAsync(r => r.ReservationId == id, ct)
            ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
        await access.EnsureAssignedAsync(User.GetUserId(), reservation.FacilityId, ct);
        var cancellation = await db.ReservationCancellationRequests
            .Where(r => r.ReservationId == id && r.Status == "Approved")
            .OrderByDescending(r => r.ResolvedAt)
            .FirstOrDefaultAsync(ct)
            ?? throw AppException.Conflict("Yêu cầu hủy chưa được duyệt");
        var depositInvoice = await db.Invoices.Include(i => i.Payments)
            .FirstOrDefaultAsync(i => i.ReservationId == id && i.InvoiceType == "DEPOSIT", ct)
            ?? throw AppException.Conflict("Không tìm thấy hóa đơn cọc");
        if (depositInvoice.Status != "Paid" || !depositInvoice.Payments.Any(p => p.Status == "Success"))
            throw AppException.Conflict("Khoản cọc chưa được ghi nhận thanh toán");
        if (transactionCode is not null
            && await db.Payments.AnyAsync(p => p.TransactionCode == transactionCode, ct))
            throw AppException.Conflict("Mã giao dịch đã được ghi nhận");

        var alreadyRefunded = depositInvoice.Payments.Where(p => p.Status == "Refunded").Sum(p => p.AmountPaid);
        var remaining = (cancellation.ApprovedRefundAmount ?? 0m) - alreadyRefunded;
        if (req.Amount <= 0 || req.Amount > remaining)
            throw AppException.BadRequest($"Số tiền hoàn còn được duyệt là {Math.Max(0m, remaining):N0}đ");

        var now = clock.GetLocalNow().DateTime;
        db.Payments.Add(new Payment
        {
            InvoiceId = depositInvoice.InvoiceId,
            ReceivedByStaffId = User.GetUserId(),
            PaymentMethod = req.PaymentMethod,
            TransactionCode = transactionCode,
            AmountPaid = req.Amount,
            PaymentDate = now,
            Status = "Refunded",
            PaymentNotes = req.Notes,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new CancellationRefundDto(id, req.Amount, remaining - req.Amount, req.PaymentMethod,
            transactionCode, now);
    }

    /// <summary>Staff: reservations at a facility (e.g. today's check-ins).</summary>
    [HttpGet("facilities/{facilityId:int}/reservations")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<ReservationDto>> ForFacility(int facilityId, [FromQuery] string? status, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        var q = db.Reservations.Where(r => r.FacilityId == facilityId);
        if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
        return await Project(q.OrderBy(r => r.ExpectedStartDate)).ToListAsync(ct);
    }

    /// <summary>Staff: record a cash deposit payment.</summary>
    [HttpPost("reservations/{id:int}/confirm-deposit")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<ReservationDto> ConfirmDeposit(int id, CancellationToken ct)
    {
        var r = await db.Reservations.FindAsync([id], ct) ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
        await access.EnsureAssignedAsync(User.GetUserId(), r.FacilityId, ct);
        if (r.Status != ReservationStatus.PendingDeposit)
            throw AppException.Conflict("Đơn không ở trạng thái chờ đặt cọc");
        if (r.DepositDeadline <= Now)
        {
            r.Status = ReservationStatus.Expired;
            var expiredInvoice = await db.Invoices.FirstOrDefaultAsync(i =>
                i.ReservationId == id && i.InvoiceType == "DEPOSIT" && i.Status == "Unpaid", ct);
            if (expiredInvoice is not null) expiredInvoice.Status = "Cancelled";
            await db.SaveChangesAsync(ct);
            throw AppException.Conflict("Đơn đã quá hạn đặt cọc, khách cần đặt lại");
        }
        var invoice = await db.Invoices.FirstOrDefaultAsync(i =>
            i.ReservationId == id && i.InvoiceType == "DEPOSIT", ct)
            ?? throw AppException.Conflict("Không tìm thấy hóa đơn cọc cho đơn đặt kho");
        await billing.RecordStaffPaymentAsync(invoice.InvoiceId, User.GetUserId(),
            new RecordPaymentRequest("Cash", invoice.TotalAmount, null, "Nhân viên xác nhận đã nhận tiền cọc"),
            ct);
        return await Project(db.Reservations.Where(x => x.ReservationId == id)).SingleAsync(ct);
    }

    /// <summary>Staff: customer arrived; assign a unit and create the rental contract.</summary>
    [HttpPost("reservations/{id:int}/check-in")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<ContractDto> CheckIn(int id, CheckInRequest req, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var staffId = User.GetUserId();
        var r = await db.Reservations.FindAsync([id], ct) ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
        await access.EnsureAssignedAsync(staffId, r.FacilityId, ct);
        if (r.Status != ReservationStatus.Confirmed)
            throw AppException.Conflict("Đơn chưa được xác nhận đặt cọc");
        if (r.CheckInAppointmentAt is null)
            throw AppException.Conflict("Khách hàng chưa đặt lịch nhận kho");
        if (clock.GetUtcNow() < r.CheckInAppointmentAt.Value.ToUniversalTime())
            throw AppException.Conflict("Chưa đến thời gian hẹn nhận kho");
        if (r.PromotionId is not null && await db.Contracts.AnyAsync(c => c.CustomerId == r.CustomerId, ct))
            throw AppException.Conflict("Khách hàng đã có hợp đồng thuê; không thể áp dụng ưu đãi lần đầu");
        if (DateOnly.FromDateTime(Now) < r.ExpectedStartDate)
            throw AppException.Conflict($"Chỉ được nhận kho từ ngày {r.ExpectedStartDate:dd/MM/yyyy}");

        var unit = await db.StorageUnits.FindAsync([req.UnitId], ct) ?? throw AppException.NotFound("Không tìm thấy kho");
        if (unit.FacilityId != r.FacilityId || unit.UnitTypeId != r.UnitTypeId || unit.Status != UnitStatus.Available)
            throw AppException.BadRequest("Kho không phù hợp hoặc không còn trống");

        var start = r.ExpectedStartDate < DateOnly.FromDateTime(Now) ? DateOnly.FromDateTime(Now) : r.ExpectedStartDate;
        var contract = new Contract
        {
            ContractNumber = $"HD-{Now:yyyyMMdd}-{Random.Shared.Next(100000, 999999)}",
            ReservationId = r.ReservationId,
            CustomerId = r.CustomerId,
            PromotionId = r.PromotionId,
            UnitId = unit.UnitId,
            StaffCreatedId = staffId,
            StartDate = start,
            EndDate = start.AddMonths(r.DurationMonths),
            MonthlyRentFee = r.EstimatedTotalFee / r.DurationMonths,
            DepositPaid = r.DepositAmount,
        };
        unit.Status = UnitStatus.Rented;
        r.AssignedUnitId = unit.UnitId;
        r.Status = ReservationStatus.CheckedIn;
        db.Contracts.Add(contract);
        db.HandoverRecords.Add(new HandoverRecord
        {
            Contract = contract,
            StaffId = staffId,
            HandoverType = "CHECK_IN",
            HandoverDateTime = Now,
            UnitConditionNotes = req.UnitConditionNotes,
            CustomerSignatureConfirmed = true,
        });
        await db.SaveChangesAsync(ct);
        var firstRentalPeriodEnd = start.AddMonths(1) < contract.EndDate
            ? start.AddMonths(1)
            : contract.EndDate;
        var firstRentInvoice = billing.CreateInvoice(
            contract.CustomerId,
            "MONTHLY_RENT",
            DateOnly.FromDateTime(Now),
            $"Tiền thuê kỳ {start:dd/MM/yyyy} - {firstRentalPeriodEnd:dd/MM/yyyy} cho hợp đồng {contract.ContractNumber}",
            contract.MonthlyRentFee,
            contractId: contract.ContractId,
            billingPeriodStart: start,
            billingPeriodEnd: firstRentalPeriodEnd);
        firstRentInvoice.DiscountAmount = Math.Min(r.PromotionDiscountAmount, firstRentInvoice.SubTotal);
        if (firstRentInvoice.DiscountAmount == firstRentInvoice.SubTotal)
            firstRentInvoice.Status = "Paid";
        db.Invoices.Add(firstRentInvoice);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return await db.Contracts.Where(c => c.ContractId == contract.ContractId)
            .Select(ContractsController.ToDto).SingleAsync(ct);
    }

    private IQueryable<ReservationDto> Project(IQueryable<Reservation> q) =>
        q.Select(r => new ReservationDto(r.ReservationId, r.ReservationCode, r.Facility.FacilityName, r.UnitType.TypeName,
            r.AssignedUnit != null ? r.AssignedUnit.UnitCode : null,
            r.Promotion != null ? r.Promotion.PromoCode : null, r.PromotionDiscountAmount,
            r.ExpectedStartDate, r.CheckInAppointmentAt,
            r.DurationMonths,
            r.DepositAmount, r.EstimatedTotalFee, r.Status, r.DepositDeadline, r.Customer.FullName,
            db.Invoices.Where(i => i.ReservationId == r.ReservationId && i.InvoiceType == "DEPOSIT")
                .Select(i => (int?)i.InvoiceId).FirstOrDefault()));

    private static IQueryable<CancellationRequestDto> CancellationDto(
        IQueryable<ReservationCancellationRequest> q) =>
        q.Select(r => new CancellationRequestDto(r.CancellationRequestId, r.ReservationId,
            r.Reservation.ReservationCode, r.Customer.FullName, r.Reason, r.Status, r.RequestedAt,
            r.ResolvedAt, r.ResolutionNotes, r.ApprovedRefundAmount));
}
