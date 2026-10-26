using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/operations/reports")]
[Authorize(Roles = AppRoles.OpsManager)]
public sealed class OperationsReportsController(SelfStorageDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet("facilities")]
    public async Task<OperationsDashboardDto> Facilities(
        [FromQuery] DateOnly? fromDate,
        [FromQuery] DateOnly? toDate,
        CancellationToken ct)
    {
        var end = toDate ?? DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var start = fromDate ?? end.AddDays(-29);
        if (start > end)
            throw AppException.BadRequest("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");

        var facilities = await db.Facilities.OrderBy(f => f.FacilityName)
            .Select(f => new { f.FacilityId, f.FacilityName }).ToListAsync(ct);
        var reports = new List<FacilityDashboardDto>(facilities.Count);
        foreach (var facility in facilities)
        {
            var unitCounts = await db.StorageUnits.Where(u => u.FacilityId == facility.FacilityId)
                .GroupBy(u => u.Status).Select(g => new { Status = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Status, x => x.Count, ct);
            var contractCounts = await db.Contracts.Where(c => c.Unit.FacilityId == facility.FacilityId)
                .GroupBy(c => c.Status).Select(g => new { Status = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Status, x => x.Count, ct);
            var revenueGroups = await db.Payments
                .Where(p => (p.Status == "Success" || p.Status == "Refunded") && p.PaymentMethod != "DepositOffset"
                    && p.PaymentDate >= start.ToDateTime(TimeOnly.MinValue)
                    && p.PaymentDate < end.AddDays(1).ToDateTime(TimeOnly.MinValue)
                    && db.Invoices.Any(i => i.InvoiceId == p.InvoiceId
                        && ((i.ContractId != null && db.Contracts.Any(c => c.ContractId == i.ContractId
                            && c.Unit.FacilityId == facility.FacilityId))
                            || (i.ReservationId != null && db.Reservations.Any(r =>
                                r.ReservationId == i.ReservationId && r.FacilityId == facility.FacilityId)))))
                .GroupBy(p => p.Status)
                .Select(g => new { Status = g.Key, Amount = g.Sum(p => p.AmountPaid) })
                .ToDictionaryAsync(x => x.Status, x => x.Amount, ct);
            var openTickets = await db.SupportRequests.CountAsync(r =>
                r.FacilityId == facility.FacilityId && (r.Status == "Open" || r.Status == "InProgress"), ct);

            reports.Add(new FacilityDashboardDto(
                facility.FacilityId, facility.FacilityName, start, end, unitCounts.Values.Sum(),
                unitCounts.GetValueOrDefault(UnitStatus.Available),
                unitCounts.GetValueOrDefault(UnitStatus.Rented),
                unitCounts.GetValueOrDefault(UnitStatus.UnderMaintenance),
                unitCounts.GetValueOrDefault(UnitStatus.OverdueLocked),
                contractCounts.GetValueOrDefault(ContractStatus.Active),
                contractCounts.GetValueOrDefault(ContractStatus.Overdue),
                openTickets,
                revenueGroups.GetValueOrDefault("Success") - revenueGroups.GetValueOrDefault("Refunded")));
        }

        return new OperationsDashboardDto(start, end, reports.Count,
            reports.Sum(r => r.TotalUnits), reports.Sum(r => r.AvailableUnits), reports.Sum(r => r.RentedUnits),
            reports.Sum(r => r.MaintenanceUnits), reports.Sum(r => r.OverdueLockedUnits),
            reports.Sum(r => r.ActiveContracts), reports.Sum(r => r.OverdueContracts),
            reports.Sum(r => r.OpenSupportRequests), reports.Sum(r => r.NetRevenue), reports);
    }
}
