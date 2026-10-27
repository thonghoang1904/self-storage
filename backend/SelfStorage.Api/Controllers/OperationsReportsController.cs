using System.Globalization;
using System.Text;
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
[Authorize(Roles = AppRoles.OpsManager + "," + AppRoles.Admin)]
public sealed class OperationsReportsController(SelfStorageDbContext db, TimeProvider clock) : ControllerBase
{
    private static readonly string[] ContractStatuses =
    [
        ContractStatus.Active,
        ContractStatus.Overdue,
        ContractStatus.Terminated,
        ContractStatus.Renewed,
        ContractStatus.Liquidated,
    ];

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

    [HttpGet("details")]
    public Task<List<OperationsReportRowDto>> Details(
        [FromQuery] DateOnly? fromDate,
        [FromQuery] DateOnly? toDate,
        [FromQuery] int? facilityId,
        [FromQuery] int? unitTypeId,
        [FromQuery] string? contractStatus,
        CancellationToken ct) =>
        GetReportRowsAsync(fromDate, toDate, facilityId, unitTypeId, contractStatus, ct);

    [HttpGet("details.csv")]
    public async Task<IActionResult> ExportDetails(
        [FromQuery] DateOnly? fromDate,
        [FromQuery] DateOnly? toDate,
        [FromQuery] int? facilityId,
        [FromQuery] int? unitTypeId,
        [FromQuery] string? contractStatus,
        CancellationToken ct)
    {
        var rows = await GetReportRowsAsync(fromDate, toDate, facilityId, unitTypeId, contractStatus, ct);
        var csv = new StringBuilder();
        csv.AppendLine("FacilityId,FacilityName,UnitTypeId,UnitTypeName,FromDate,ToDate,TotalUnits,AvailableUnits,ReservedUnits,RentedUnits,MaintenanceUnits,OverdueLockedUnits,OccupancyRatePercent,ActiveContracts,OverdueContracts,TerminatedContracts,RenewedContracts,LiquidatedContracts,NetRevenueVND");
        foreach (var row in rows)
        {
            csv.Append(row.FacilityId).Append(',')
                .Append(CsvText(row.FacilityName)).Append(',')
                .Append(row.UnitTypeId).Append(',')
                .Append(CsvText(row.UnitTypeName)).Append(',')
                .Append(row.FromDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append(',')
                .Append(row.ToDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append(',')
                .Append(row.TotalUnits).Append(',')
                .Append(row.AvailableUnits).Append(',')
                .Append(row.ReservedUnits).Append(',')
                .Append(row.RentedUnits).Append(',')
                .Append(row.MaintenanceUnits).Append(',')
                .Append(row.OverdueLockedUnits).Append(',')
                .Append(row.OccupancyRatePercent.ToString("0.##", CultureInfo.InvariantCulture)).Append(',')
                .Append(row.ActiveContracts).Append(',')
                .Append(row.OverdueContracts).Append(',')
                .Append(row.TerminatedContracts).Append(',')
                .Append(row.RenewedContracts).Append(',')
                .Append(row.LiquidatedContracts).Append(',')
                .AppendLine(row.NetRevenue.ToString("0.00", CultureInfo.InvariantCulture));
        }

        var start = fromDate ?? DateOnly.FromDateTime(clock.GetLocalNow().DateTime).AddDays(-29);
        var end = toDate ?? DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var fileName = $"self-storage-report-{start:yyyyMMdd}-{end:yyyyMMdd}.csv";
        return File(new UTF8Encoding(encoderShouldEmitUTF8Identifier: true).GetBytes(csv.ToString()),
            "text/csv; charset=utf-8", fileName);
    }

    private async Task<List<OperationsReportRowDto>> GetReportRowsAsync(
        DateOnly? fromDate,
        DateOnly? toDate,
        int? facilityId,
        int? unitTypeId,
        string? contractStatus,
        CancellationToken ct)
    {
        var end = toDate ?? DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var start = fromDate ?? end.AddDays(-29);
        if (start > end)
            throw AppException.BadRequest("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
        if (facilityId is <= 0 || unitTypeId is <= 0)
            throw AppException.BadRequest("Mã cơ sở và loại kho phải là số dương");
        if (contractStatus is not null && !ContractStatuses.Contains(contractStatus))
            throw AppException.BadRequest("Trạng thái hợp đồng không hợp lệ");
        if (facilityId is not null
            && !await db.Facilities.AnyAsync(f => f.FacilityId == facilityId, ct))
            throw AppException.NotFound("Không tìm thấy cơ sở");
        if (unitTypeId is not null
            && !await db.UnitTypes.AnyAsync(t => t.UnitTypeId == unitTypeId, ct))
            throw AppException.NotFound("Không tìm thấy loại kho");

        var unitQuery = db.StorageUnits.AsQueryable();
        if (facilityId is not null)
            unitQuery = unitQuery.Where(u => u.FacilityId == facilityId);
        if (unitTypeId is not null)
            unitQuery = unitQuery.Where(u => u.UnitTypeId == unitTypeId);
        var unitGroups = await unitQuery
            .GroupBy(u => new
            {
                u.FacilityId,
                FacilityName = u.Facility.FacilityName,
                u.UnitTypeId,
                UnitTypeName = u.UnitType.TypeName,
            })
            .Select(g => new
            {
                g.Key.FacilityId,
                g.Key.FacilityName,
                g.Key.UnitTypeId,
                g.Key.UnitTypeName,
                TotalUnits = g.Count(),
                AvailableUnits = g.Count(u => u.Status == UnitStatus.Available),
                ReservedUnits = g.Count(u => u.Status == UnitStatus.Reserved),
                RentedUnits = g.Count(u => u.Status == UnitStatus.Rented),
                MaintenanceUnits = g.Count(u => u.Status == UnitStatus.UnderMaintenance),
                OverdueLockedUnits = g.Count(u => u.Status == UnitStatus.OverdueLocked),
            })
            .ToListAsync(ct);

        var contractQuery = db.Contracts.AsQueryable();
        if (facilityId is not null)
            contractQuery = contractQuery.Where(c => c.Unit.FacilityId == facilityId);
        if (unitTypeId is not null)
            contractQuery = contractQuery.Where(c => c.Unit.UnitTypeId == unitTypeId);
        var contractGroups = await contractQuery
            .GroupBy(c => new { c.Unit.FacilityId, c.Unit.UnitTypeId })
            .Select(g => new
            {
                g.Key.FacilityId,
                g.Key.UnitTypeId,
                ActiveContracts = g.Count(c => c.Status == ContractStatus.Active),
                OverdueContracts = g.Count(c => c.Status == ContractStatus.Overdue),
                TerminatedContracts = g.Count(c => c.Status == ContractStatus.Terminated),
                RenewedContracts = g.Count(c => c.Status == ContractStatus.Renewed),
                LiquidatedContracts = g.Count(c => c.Status == ContractStatus.Liquidated),
            })
            .ToListAsync(ct);
        var contractsByUnitType = contractGroups.ToDictionary(
            g => (g.FacilityId, g.UnitTypeId));

        var rangeStart = start.ToDateTime(TimeOnly.MinValue);
        var rangeEnd = end.AddDays(1).ToDateTime(TimeOnly.MinValue);
        var contractRevenue = await (
            from payment in db.Payments
            join invoice in db.Invoices on payment.InvoiceId equals invoice.InvoiceId
            join contract in db.Contracts on invoice.ContractId!.Value equals contract.ContractId
            where (payment.Status == "Success" || payment.Status == "Refunded") && payment.PaymentMethod != "DepositOffset"
                && invoice.ReservationId == null
                && payment.PaymentDate >= rangeStart && payment.PaymentDate < rangeEnd
                && (facilityId == null || contract.Unit.FacilityId == facilityId)
                && (unitTypeId == null || contract.Unit.UnitTypeId == unitTypeId)
            group payment by new
            {
                contract.Unit.FacilityId,
                contract.Unit.UnitTypeId,
                payment.Status,
            }
            into g
            select new
            {
                g.Key.FacilityId,
                g.Key.UnitTypeId,
                g.Key.Status,
                Amount = g.Sum(p => p.AmountPaid),
            })
            .ToListAsync(ct);
        var reservationRevenue = await (
            from payment in db.Payments
            join invoice in db.Invoices on payment.InvoiceId equals invoice.InvoiceId
            join reservation in db.Reservations on invoice.ReservationId!.Value equals reservation.ReservationId
            where (payment.Status == "Success" || payment.Status == "Refunded")
                && invoice.ContractId == null
                && payment.PaymentDate >= rangeStart && payment.PaymentDate < rangeEnd
                && (facilityId == null || reservation.FacilityId == facilityId)
                && (unitTypeId == null || reservation.UnitTypeId == unitTypeId)
            group payment by new
            {
                reservation.FacilityId,
                reservation.UnitTypeId,
                payment.Status,
            }
            into g
            select new
            {
                g.Key.FacilityId,
                g.Key.UnitTypeId,
                g.Key.Status,
                Amount = g.Sum(p => p.AmountPaid),
            })
            .ToListAsync(ct);
        var revenueByUnitType = new Dictionary<(int FacilityId, int UnitTypeId), decimal>();
        foreach (var item in contractRevenue.Concat(reservationRevenue))
        {
            var key = (item.FacilityId, item.UnitTypeId);
            var sign = item.Status == "Refunded" ? -1m : 1m;
            revenueByUnitType[key] = revenueByUnitType.GetValueOrDefault(key) + item.Amount * sign;
        }

        return unitGroups
            .Select(unit =>
            {
                var key = (unit.FacilityId, unit.UnitTypeId);
                var contracts = contractsByUnitType.GetValueOrDefault(key);
                return new OperationsReportRowDto(
                    start,
                    end,
                    unit.FacilityId,
                    unit.FacilityName,
                    unit.UnitTypeId,
                    unit.UnitTypeName,
                    unit.TotalUnits,
                    unit.AvailableUnits,
                    unit.ReservedUnits,
                    unit.RentedUnits,
                    unit.MaintenanceUnits,
                    unit.OverdueLockedUnits,
                    unit.TotalUnits == 0 ? 0m : decimal.Round(unit.RentedUnits * 100m / unit.TotalUnits, 2),
                    contracts?.ActiveContracts ?? 0,
                    contracts?.OverdueContracts ?? 0,
                    contracts?.TerminatedContracts ?? 0,
                    contracts?.RenewedContracts ?? 0,
                    contracts?.LiquidatedContracts ?? 0,
                    revenueByUnitType.GetValueOrDefault(key));
            })
            .Where(row => contractStatus switch
            {
                ContractStatus.Active => row.ActiveContracts > 0,
                ContractStatus.Overdue => row.OverdueContracts > 0,
                ContractStatus.Terminated => row.TerminatedContracts > 0,
                ContractStatus.Renewed => row.RenewedContracts > 0,
                ContractStatus.Liquidated => row.LiquidatedContracts > 0,
                _ => true,
            })
            .OrderBy(row => row.FacilityName)
            .ThenBy(row => row.UnitTypeName)
            .ToList();
    }

    private static string CsvText(string value)
    {
        var firstNonWhitespace = value.TrimStart();
        if (firstNonWhitespace.StartsWith('=') || firstNonWhitespace.StartsWith('+')
            || firstNonWhitespace.StartsWith('-') || firstNonWhitespace.StartsWith('@')
            || firstNonWhitespace.StartsWith('\t') || firstNonWhitespace.StartsWith('\r'))
            value = $"'{value}";
        return $"\"{value.Replace("\"", "\"\"")}\"";
    }
}
