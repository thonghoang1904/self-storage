using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;

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
    /// <summary>Units still bookable: available units minus those held by open reservations.</summary>
    [HttpGet("facilities/{facilityId:int}/availability")]
    public Task<List<AvailabilityDto>> Availability(int facilityId, CancellationToken ct)
    {
        var now = clock.GetLocalNow().DateTime;
        return db.UnitTypes.OrderBy(t => t.BaseMonthlyRate)
            .Select(t => new AvailabilityDto(t.UnitTypeId, t.TypeName, t.BaseMonthlyRate,
                db.StorageUnits.Count(u => u.FacilityId == facilityId && u.UnitTypeId == t.UnitTypeId
                                           && u.Status == UnitStatus.Available)
                - db.Reservations.Count(r => r.FacilityId == facilityId && r.UnitTypeId == t.UnitTypeId
                                             && (r.Status == ReservationStatus.Confirmed
                                                 || (r.Status == ReservationStatus.PendingDeposit && r.DepositDeadline > now)))))
            .ToListAsync(ct);
    }

    [HttpGet("facilities/{facilityId:int}/units")]
    public Task<List<StorageUnitDto>> Units(int facilityId, [FromQuery] string? status, [FromQuery] int? unitTypeId,
        CancellationToken ct)
    {
        var q = db.StorageUnits.Where(u => u.FacilityId == facilityId);
        if (!string.IsNullOrEmpty(status)) q = q.Where(u => u.Status == status);
        if (unitTypeId is not null) q = q.Where(u => u.UnitTypeId == unitTypeId);
        return q.OrderBy(u => u.FloorNumber).ThenBy(u => u.UnitCode)
            .Select(u => new StorageUnitDto(u.UnitId, u.UnitCode, u.FloorNumber, u.ZoneArea, u.MonthlyPrice,
                u.Status, u.UnitTypeId, u.UnitType.TypeName))
            .ToListAsync(ct);
    }
}
