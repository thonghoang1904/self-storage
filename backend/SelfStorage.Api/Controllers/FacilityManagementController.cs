using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;
using System.Data;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/facility-management/facilities/{facilityId:int}")]
[Authorize(Roles = AppRoles.GateRoles)]
public sealed class FacilityManagementController(
    SelfStorageDbContext db,
    AccessService access,
    BillingService billing,
    TimeProvider clock) : ControllerBase
{
    [HttpGet("units")]
    [Authorize(Roles = AppRoles.Manager)]
    public async Task<List<StorageUnitDto>> Units(int facilityId, CancellationToken ct)
    {
        await EnsureManagerOwnsFacilityAsync(facilityId, ct);
        return await db.StorageUnits.Where(u => u.FacilityId == facilityId)
            .OrderBy(u => u.FloorNumber).ThenBy(u => u.UnitCode)
            .Select(u => new StorageUnitDto(u.UnitId, u.UnitCode, u.FloorNumber, u.ZoneArea,
                u.MonthlyPrice, u.Status, u.UnitTypeId, u.UnitType.TypeName))
            .ToListAsync(ct);
    }

    [HttpPost("units")]
    [Authorize(Roles = AppRoles.Manager)]
    public async Task<StorageUnitDto> CreateUnit(
        int facilityId, CreateStorageUnitRequest req, CancellationToken ct)
    {
        await EnsureManagerOwnsFacilityAsync(facilityId, ct);
        if (!await db.Facilities.AnyAsync(f => f.FacilityId == facilityId && f.Status == "Active", ct))
            throw AppException.Conflict("Chỉ được tạo kho tại cơ sở đang hoạt động");
        if (!await db.UnitTypes.AnyAsync(t => t.UnitTypeId == req.UnitTypeId, ct))
            throw AppException.NotFound("Không tìm thấy loại kho");

        var unitCode = req.UnitCode.Trim();
        if (await db.StorageUnits.AnyAsync(u => u.FacilityId == facilityId && u.UnitCode == unitCode, ct))
            throw AppException.Conflict("Mã kho này đã tồn tại tại cơ sở");

        var unit = new StorageUnit
        {
            FacilityId = facilityId,
            UnitTypeId = req.UnitTypeId,
            UnitCode = unitCode,
            FloorNumber = req.FloorNumber,
            ZoneArea = Normalize(req.ZoneArea),
            MonthlyPrice = req.MonthlyPrice,
            Status = UnitStatus.Available,
        };
        db.StorageUnits.Add(unit);
        await db.SaveChangesAsync(ct);
        return await ProjectUnit(unit.UnitId, ct);
    }

    [HttpPut("units/{unitId:int}")]
    [Authorize(Roles = AppRoles.Manager)]
    public async Task<StorageUnitDto> UpdateUnit(
        int facilityId, int unitId, UpdateStorageUnitRequest req, CancellationToken ct)
    {
        await EnsureManagerOwnsFacilityAsync(facilityId, ct);
        var unit = await db.StorageUnits.FirstOrDefaultAsync(
            u => u.UnitId == unitId && u.FacilityId == facilityId, ct)
            ?? throw AppException.NotFound("Không tìm thấy kho tại cơ sở");
        if (unit.Status is UnitStatus.Rented or UnitStatus.OverdueLocked or UnitStatus.Reserved)
            throw AppException.Conflict("Không thể sửa thông tin loại/vị trí kho khi kho đang được thuê hoặc giữ chỗ");
        if (!await db.UnitTypes.AnyAsync(t => t.UnitTypeId == req.UnitTypeId, ct))
            throw AppException.NotFound("Không tìm thấy loại kho");
        var unitCode = req.UnitCode.Trim();
        if (await db.StorageUnits.AnyAsync(u => u.FacilityId == facilityId
            && u.UnitId != unitId && u.UnitCode == unitCode, ct))
            throw AppException.Conflict("Mã kho này đã tồn tại tại cơ sở");

        unit.UnitTypeId = req.UnitTypeId;
        unit.UnitCode = unitCode;
        unit.FloorNumber = req.FloorNumber;
        unit.ZoneArea = Normalize(req.ZoneArea);
        unit.MonthlyPrice = req.MonthlyPrice;
        await db.SaveChangesAsync(ct);
        return await ProjectUnit(unitId, ct);
    }

    /// <summary>
    /// Start (UnderMaintenance) or end (Available) maintenance; staff and managers of the facility may do this.
    /// Ending maintenance on a unit that is still rented puts it back to Rented, or OverdueLocked if its
    /// contract is overdue, so the customer can use it again.
    /// </summary>
    [HttpPut("units/{unitId:int}/status")]
    public async Task<StorageUnitDto> UpdateUnitStatus(
        int facilityId, int unitId, UpdateStorageUnitStatusRequest req, CancellationToken ct)
    {
        await EnsureManagerOwnsFacilityAsync(facilityId, ct);
        if (req.Status is not (UnitStatus.Available or UnitStatus.UnderMaintenance))
            throw AppException.BadRequest("Trạng thái kho chỉ có thể chuyển thủ công giữa Available và UnderMaintenance");
        var unit = await db.StorageUnits.FirstOrDefaultAsync(
            u => u.UnitId == unitId && u.FacilityId == facilityId, ct)
            ?? throw AppException.NotFound("Không tìm thấy kho tại cơ sở");

        var newStatus = req.Status;
        if (req.Status == UnitStatus.Available)
        {
            var contractStatus = await db.Contracts
                .Where(c => c.UnitId == unitId
                    && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Overdue))
                .Select(c => c.Status)
                .FirstOrDefaultAsync(ct);
            newStatus = contractStatus switch
            {
                ContractStatus.Active => UnitStatus.Rented,
                ContractStatus.Overdue => UnitStatus.OverdueLocked,
                _ => UnitStatus.Available,
            };
        }

        var oldStatus = unit.Status;
        unit.Status = newStatus;
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = User.GetUserId(),
            Action = "StorageUnitStatusChanged",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = $"Unit {unit.UnitCode}: {oldStatus} -> {newStatus}",
            CreatedAt = clock.GetLocalNow().DateTime,
        });
        await db.SaveChangesAsync(ct);
        return await ProjectUnit(unitId, ct);
    }

    [HttpGet("staff")]
    [Authorize(Roles = AppRoles.Manager)]
    public async Task<List<FacilityStaffDto>> Staff(int facilityId, CancellationToken ct)
    {
        await EnsureManagerOwnsFacilityAsync(facilityId, ct);
        return await db.FacilityStaffAssignments
            .Where(a => a.FacilityId == facilityId && a.Status == "Active"
                && a.Staff.Role.RoleName == AppRoles.Staff)
            .OrderBy(a => a.Staff.FullName)
            .Select(a => new FacilityStaffDto(a.StaffId, a.Staff.Username, a.Staff.FullName,
                a.Staff.Email, a.Staff.Status, a.AssignedDate))
            .ToListAsync(ct);
    }

    [HttpPost("staff")]
    [Authorize(Roles = AppRoles.Manager)]
    public async Task<FacilityStaffDto> AssignStaff(
        int facilityId, AssignFacilityStaffRequest req, CancellationToken ct)
    {
        await EnsureManagerOwnsFacilityAsync(facilityId, ct);
        var staff = await db.Users.Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.UserId == req.StaffUserId, ct)
            ?? throw AppException.NotFound("Không tìm thấy tài khoản nhân viên");
        if (staff.Role.RoleName != AppRoles.Staff || staff.Status != "Active")
            throw AppException.BadRequest("Chỉ có thể phân công tài khoản Facility Staff đang hoạt động");

        var assignment = await db.FacilityStaffAssignments
            .FirstOrDefaultAsync(a => a.FacilityId == facilityId && a.StaffId == staff.UserId, ct);
        if (assignment is null)
        {
            assignment = new FacilityStaffAssignment
            {
                FacilityId = facilityId,
                StaffId = staff.UserId,
                AssignedDate = DateOnly.FromDateTime(clock.GetLocalNow().DateTime),
                Status = "Active",
            };
            db.FacilityStaffAssignments.Add(assignment);
        }
        else if (assignment.Status == "Active")
        {
            throw AppException.Conflict("Nhân viên đã được phân công tại cơ sở này");
        }
        else
        {
            assignment.AssignedDate = DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
            assignment.Status = "Active";
        }

        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = User.GetUserId(),
            Action = "FacilityStaffAssigned",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = $"Assigned staff user {staff.UserId} to facility {facilityId}",
            CreatedAt = clock.GetLocalNow().DateTime,
        });
        await db.SaveChangesAsync(ct);
        return new FacilityStaffDto(staff.UserId, staff.Username, staff.FullName, staff.Email,
            staff.Status, assignment.AssignedDate);
    }

    [HttpDelete("staff/{staffUserId:int}")]
    [Authorize(Roles = AppRoles.Manager)]
    public async Task<IActionResult> RemoveStaff(int facilityId, int staffUserId, CancellationToken ct)
    {
        await EnsureManagerOwnsFacilityAsync(facilityId, ct);
        var assignment = await db.FacilityStaffAssignments.FirstOrDefaultAsync(
            a => a.FacilityId == facilityId && a.StaffId == staffUserId && a.Status == "Active", ct)
            ?? throw AppException.NotFound("Không tìm thấy phân công đang hoạt động");
        assignment.Status = "Ended";
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = User.GetUserId(),
            Action = "FacilityStaffRemoved",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = $"Removed staff user {staffUserId} from facility {facilityId}",
            CreatedAt = clock.GetLocalNow().DateTime,
        });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>
    /// Extra charge (staff or manager). Also allowed right after the return (e.g. cleaning fee) as long as the
    /// deposit has not been refunded yet: an unpaid charge is held back from the deposit refund.
    /// </summary>
    [HttpPost("contracts/{contractId:int}/extra-charges")]
    public async Task<ExtraChargeInvoiceDto> CreateExtraCharge(
        int facilityId, int contractId, CreateExtraChargeRequest req, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        var contract = await db.Contracts.Include(c => c.Unit)
            .FirstOrDefaultAsync(c => c.ContractId == contractId && c.Unit.FacilityId == facilityId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng tại cơ sở");
        if (contract.Status is not (ContractStatus.Active or ContractStatus.Overdue or ContractStatus.Terminated))
            throw AppException.Conflict("Chỉ được lập phụ thu cho hợp đồng đang hoạt động hoặc vừa trả kho");
        if (contract.Status == ContractStatus.Terminated && await db.Payments.AnyAsync(p => p.Status == "Refunded"
                && db.Invoices.Any(i => i.InvoiceId == p.InvoiceId && i.ReservationId == contract.ReservationId
                    && i.InvoiceType == "DEPOSIT"), ct))
            throw AppException.Conflict("Tiền cọc của hợp đồng đã được hoàn; không thể lập thêm phụ thu");
        var fee = await db.FeeConfigurations.FindAsync([req.FeeTypeId], ct)
            ?? throw AppException.NotFound("Không tìm thấy loại phí");
        var unitPrice = fee.CalculationMethod switch
        {
            "Fixed" or "DailyRate" => fee.DefaultAmount,
            "Percentage" => decimal.Round(contract.MonthlyRentFee * fee.DefaultAmount / 100m, 2,
                MidpointRounding.AwayFromZero),
            _ => throw AppException.Conflict("Loại phí có cách tính không được hỗ trợ"),
        };
        if (unitPrice <= 0)
            throw AppException.Conflict("Loại phí chưa có đơn giá lớn hơn 0");

        var today = DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var dueDate = req.DueDate ?? today;
        if (dueDate < today)
            throw AppException.BadRequest("Ngày đến hạn phụ thu không được ở quá khứ");
        var notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();
        var description = string.IsNullOrWhiteSpace(notes)
            ? fee.FeeName
            : $"{fee.FeeName}: {notes}";

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var invoice = billing.CreateInvoice(contract.CustomerId, "EXTRA_CHARGE", dueDate,
            description, unitPrice, req.Quantity, contractId: contract.ContractId);
        db.Invoices.Add(invoice);
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = User.GetUserId(),
            Action = "ExtraChargeInvoiceCreated",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = $"Created {fee.FeeCode} charge invoice for contract {contract.ContractNumber}",
            CreatedAt = clock.GetLocalNow().DateTime,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new ExtraChargeInvoiceDto(invoice.InvoiceId, invoice.InvoiceNumber, invoice.InvoiceType,
            invoice.TotalAmount, invoice.DueDate, invoice.Status, contractId);
    }

    private Task EnsureManagerOwnsFacilityAsync(int facilityId, CancellationToken ct) =>
        access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);

    private Task<StorageUnitDto> ProjectUnit(int unitId, CancellationToken ct) =>
        db.StorageUnits.Where(u => u.UnitId == unitId)
            .Select(u => new StorageUnitDto(u.UnitId, u.UnitCode, u.FloorNumber, u.ZoneArea,
                u.MonthlyPrice, u.Status, u.UnitTypeId, u.UnitType.TypeName))
            .SingleAsync(ct);

    private static string? Normalize(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
