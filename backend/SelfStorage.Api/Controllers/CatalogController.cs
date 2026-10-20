using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Controllers;

/// <summary>Public browsing: facilities, unit types, prices and available units.</summary>
[ApiController]
[Route("api")]
[AllowAnonymous]
public class CatalogController(SelfStorageDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet("facilities")]
    public Task<List<FacilityDto>> Facilities(CancellationToken ct) =>
        db.Facilities.Where(f => f.Status != "Closed").OrderBy(f => f.FacilityName)
            .Select(f => new FacilityDto(f.FacilityId, f.FacilityName, f.Address, f.City, f.District,
                f.Hotline, f.OperatingHours, f.Status))
            .ToListAsync(ct);

    [HttpGet("unit-types")]
    public Task<List<UnitTypeDto>> UnitTypes(CancellationToken ct) =>
        db.UnitTypes.OrderBy(t => t.BaseMonthlyRate)
            .Select(t => new UnitTypeDto(t.UnitTypeId, t.TypeName, t.LengthMeters, t.WidthMeters, t.HeightMeters,
                t.VolumeCubicMeters, t.HasClimateControl, t.BaseDailyRate, t.BaseMonthlyRate, t.Description))
            .ToListAsync(ct);

    /// <summary>Number of available units per unit type at one facility.</summary>
    [HttpGet("facilities/{facilityId:int}/availability")]
    public async Task<List<AvailabilityDto>> Availability(int facilityId, CancellationToken ct)
    {
        var facilityStatus = await db.Facilities.Where(f => f.FacilityId == facilityId)
            .Select(f => f.Status).SingleOrDefaultAsync(ct);
        if (facilityStatus is null || facilityStatus == "Closed")
            throw AppException.NotFound("Không tìm thấy cơ sở đang hoạt động");

        var now = clock.GetLocalNow().DateTime;
        var availability = db.UnitTypes.OrderBy(t => t.BaseMonthlyRate)
            .Select(t => new
            {
                t.UnitTypeId,
                t.TypeName,
                t.BaseMonthlyRate,
                Available = db.StorageUnits.Count(u => u.FacilityId == facilityId
                        && u.UnitTypeId == t.UnitTypeId && u.Status == UnitStatus.Available)
                    - db.Reservations.Count(r => r.FacilityId == facilityId && r.UnitTypeId == t.UnitTypeId
                        && (r.Status == ReservationStatus.Confirmed
                            || (r.Status == ReservationStatus.PendingDeposit && r.DepositDeadline > now))),
            });
        return await availability.Select(t => new AvailabilityDto(t.UnitTypeId, t.TypeName,
                t.BaseMonthlyRate,
                facilityStatus == "Active" && t.Available > 0 ? t.Available : 0))
            .ToListAsync(ct);
    }

    [HttpGet("facilities/{facilityId:int}/units")]
    public async Task<List<StorageUnitDto>> Units(int facilityId, [FromQuery] string? status, [FromQuery] int? unitTypeId,
        CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(status) && status != UnitStatus.Available)
            throw AppException.BadRequest("Danh mục công khai chỉ cho phép lọc kho còn trống");
        var facilityStatus = await db.Facilities.Where(f => f.FacilityId == facilityId)
            .Select(f => f.Status).SingleOrDefaultAsync(ct);
        if (facilityStatus is null || facilityStatus == "Closed")
            throw AppException.NotFound("Không tìm thấy cơ sở đang hoạt động");
        if (facilityStatus != "Active")
            return [];
        var q = db.StorageUnits.Where(u => u.FacilityId == facilityId
            && u.Status == UnitStatus.Available);
        if (unitTypeId is not null) q = q.Where(u => u.UnitTypeId == unitTypeId);
        return await q.OrderBy(u => u.FloorNumber).ThenBy(u => u.UnitCode)
            .Select(u => new StorageUnitDto(u.UnitId, u.UnitCode, u.FloorNumber, u.ZoneArea,
                u.UnitType.BaseMonthlyRate,
                u.Status, u.UnitTypeId, u.UnitType.TypeName))
            .ToListAsync(ct);
    }
}
