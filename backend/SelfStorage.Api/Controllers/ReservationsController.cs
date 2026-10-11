using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
public class ReservationsController(SelfStorageDbContext db, AccessService access, TimeProvider clock) : ControllerBase
{
    private DateTime Now => clock.GetLocalNow().DateTime;

    [HttpPost("reservations")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<ReservationDto> Create(CreateReservationRequest req, CancellationToken ct)
    {
        if (req.ExpectedStartDate < DateOnly.FromDateTime(Now))
            throw AppException.BadRequest("Ngày bắt đầu không được ở quá khứ");

        var unitType = await db.UnitTypes.FindAsync([req.UnitTypeId], ct)
                       ?? throw AppException.NotFound("Không tìm thấy loại kho");
        var available = await db.StorageUnits.CountAsync(u => u.FacilityId == req.FacilityId
            && u.UnitTypeId == req.UnitTypeId && u.Status == UnitStatus.Available, ct);
        if (available == 0)
            throw AppException.Conflict("Cơ sở này đã hết kho trống thuộc loại đã chọn");

        // TODO: read DepositPercent / grace hours from RentalPolicies. Default policy: deposit = 1 month (100%), 24h to pay.
        var reservation = new Reservation
        {
            ReservationCode = $"RSV-{Now:yyyyMMdd}-{Random.Shared.Next(100000, 999999)}",
            CustomerId = User.GetUserId(),
            FacilityId = req.FacilityId,
            UnitTypeId = req.UnitTypeId,
            ExpectedStartDate = req.ExpectedStartDate,
            DurationMonths = req.DurationMonths,
            DepositAmount = unitType.BaseMonthlyRate,
            EstimatedTotalFee = unitType.BaseMonthlyRate * req.DurationMonths,
            DepositDeadline = Now.AddHours(24),
        };
        db.Reservations.Add(reservation);
        await db.SaveChangesAsync(ct);
        return await Project(db.Reservations.Where(r => r.ReservationId == reservation.ReservationId)).SingleAsync(ct);
    }

    [HttpGet("reservations/my")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<List<ReservationDto>> Mine(CancellationToken ct)
    {
        var me = User.GetUserId();
        return Project(db.Reservations.Where(r => r.CustomerId == me).OrderByDescending(r => r.CreatedAt)).ToListAsync(ct);
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

    /// <summary>Staff: deposit received (until the payment module exists).</summary>
    [HttpPost("reservations/{id:int}/confirm-deposit")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<ReservationDto> ConfirmDeposit(int id, CancellationToken ct)
    {
        var r = await db.Reservations.FindAsync([id], ct) ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
        await access.EnsureAssignedAsync(User.GetUserId(), r.FacilityId, ct);
        if (r.Status != ReservationStatus.PendingDeposit)
            throw AppException.Conflict("Đơn không ở trạng thái chờ đặt cọc");
        r.Status = ReservationStatus.Confirmed;
        await db.SaveChangesAsync(ct);
        return await Project(db.Reservations.Where(x => x.ReservationId == id)).SingleAsync(ct);
    }

    /// <summary>Staff: customer arrived; assign a unit and create the rental contract. The customer then sets the gate PIN.</summary>
    [HttpPost("reservations/{id:int}/check-in")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<ContractDto> CheckIn(int id, CheckInRequest req, CancellationToken ct)
    {
        var staffId = User.GetUserId();
        var r = await db.Reservations.FindAsync([id], ct) ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
        await access.EnsureAssignedAsync(staffId, r.FacilityId, ct);
        if (r.Status != ReservationStatus.Confirmed)
            throw AppException.Conflict("Đơn chưa được xác nhận đặt cọc");

        var unit = await db.StorageUnits.FindAsync([req.UnitId], ct) ?? throw AppException.NotFound("Không tìm thấy kho");
        if (unit.FacilityId != r.FacilityId || unit.UnitTypeId != r.UnitTypeId || unit.Status != UnitStatus.Available)
            throw AppException.BadRequest("Kho không phù hợp hoặc không còn trống");

        var start = r.ExpectedStartDate < DateOnly.FromDateTime(Now) ? DateOnly.FromDateTime(Now) : r.ExpectedStartDate;
        var contract = new Contract
        {
            ContractNumber = $"HD-{Now:yyyyMMdd}-{Random.Shared.Next(100000, 999999)}",
            ReservationId = r.ReservationId,
            CustomerId = r.CustomerId,
            UnitId = unit.UnitId,
            StaffCreatedId = staffId,
            StartDate = start,
            EndDate = start.AddMonths(r.DurationMonths),
            MonthlyRentFee = unit.MonthlyPrice,
            DepositPaid = r.DepositAmount,
        };
        unit.Status = UnitStatus.Rented;
        r.AssignedUnitId = unit.UnitId;
        r.Status = ReservationStatus.CheckedIn;
        db.Contracts.Add(contract);
        await db.SaveChangesAsync(ct);

        return await db.Contracts.Where(c => c.ContractId == contract.ContractId)
            .Select(ContractsController.ToDto).SingleAsync(ct);
    }

    private static IQueryable<ReservationDto> Project(IQueryable<Reservation> q) =>
        q.Select(r => new ReservationDto(r.ReservationId, r.ReservationCode, r.Facility.FacilityName, r.UnitType.TypeName,
            r.AssignedUnit != null ? r.AssignedUnit.UnitCode : null, r.ExpectedStartDate, r.DurationMonths,
            r.DepositAmount, r.EstimatedTotalFee, r.Status, r.DepositDeadline, r.Customer.FullName));
}
