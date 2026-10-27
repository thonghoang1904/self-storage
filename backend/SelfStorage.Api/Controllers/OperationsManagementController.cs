using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/operations")]
[Authorize(Roles = AppRoles.OpsManager)]
public sealed class OperationsManagementController(
    SelfStorageDbContext db,
    TimeProvider clock) : ControllerBase
{
    private static readonly string[] FacilityStatuses = ["Active", "Maintenance", "Closed"];
    private static readonly string[] FeeMethods = ["Fixed", "DailyRate", "Percentage"];

    [HttpGet("facilities")]
    public Task<List<FacilityDto>> Facilities(CancellationToken ct) =>
        db.Facilities.OrderBy(f => f.FacilityName)
            .Select(f => new FacilityDto(f.FacilityId, f.FacilityName, f.Address, f.City,
                f.District, f.Hotline, f.OperatingHours, f.Status))
            .ToListAsync(ct);

    [HttpPost("facilities")]
    public async Task<FacilityDto> CreateFacility(CreateFacilityRequest req, CancellationToken ct)
    {
        var facility = new Facility
        {
            FacilityName = req.FacilityName.Trim(),
            Address = req.Address.Trim(),
            City = req.City.Trim(),
            District = req.District.Trim(),
            Hotline = req.Hotline.Trim(),
            OperatingHours = req.OperatingHours.Trim(),
            Status = "Active",
        };
        db.Facilities.Add(facility);
        AddLog("FacilityCreated", "Created a facility");
        await db.SaveChangesAsync(ct);
        return ToFacilityDto(facility);
    }

    [HttpPut("facilities/{facilityId:int}")]
    public async Task<FacilityDto> UpdateFacility(
        int facilityId, UpdateFacilityRequest req, CancellationToken ct)
    {
        if (!FacilityStatuses.Contains(req.Status))
            throw AppException.BadRequest("Trạng thái cơ sở không hợp lệ");
        var facility = await db.Facilities.FindAsync([facilityId], ct)
            ?? throw AppException.NotFound("Không tìm thấy cơ sở");
        facility.FacilityName = req.FacilityName.Trim();
        facility.Address = req.Address.Trim();
        facility.City = req.City.Trim();
        facility.District = req.District.Trim();
        facility.Hotline = req.Hotline.Trim();
        facility.OperatingHours = req.OperatingHours.Trim();
        facility.Status = req.Status;
        AddLog("FacilityUpdated", $"Updated facility {facilityId}");
        await db.SaveChangesAsync(ct);
        return ToFacilityDto(facility);
    }

    [HttpGet("unit-types")]
    public Task<List<UnitTypeDto>> UnitTypes(CancellationToken ct) =>
        db.UnitTypes.OrderBy(t => t.BaseMonthlyRate)
            .Select(t => new UnitTypeDto(t.UnitTypeId, t.TypeName, t.LengthMeters, t.WidthMeters,
                t.HeightMeters, t.VolumeCubicMeters, t.HasClimateControl, t.BaseDailyRate,
                t.BaseMonthlyRate, t.Description))
            .ToListAsync(ct);

    [HttpPut("unit-types/{unitTypeId:int}/pricing")]
    public async Task<UnitTypeDto> UpdateUnitTypePricing(
        int unitTypeId, UpdateUnitTypePricingRequest req, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, ct);
        var unitType = await db.UnitTypes.FindAsync([unitTypeId], ct)
            ?? throw AppException.NotFound("Không tìm thấy loại kho");
        unitType.BaseDailyRate = req.BaseDailyRate;
        unitType.BaseMonthlyRate = req.BaseMonthlyRate;
        await db.StorageUnits.Where(u => u.UnitTypeId == unitTypeId)
            .ExecuteUpdateAsync(update => update.SetProperty(u => u.MonthlyPrice, req.BaseMonthlyRate), ct);
        AddLog("UnitTypePricingUpdated",
            $"Updated prices for unit type {unitTypeId}: daily {req.BaseDailyRate:N2}, monthly {req.BaseMonthlyRate:N2}");
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new UnitTypeDto(unitType.UnitTypeId, unitType.TypeName, unitType.LengthMeters,
            unitType.WidthMeters, unitType.HeightMeters, unitType.VolumeCubicMeters,
            unitType.HasClimateControl, unitType.BaseDailyRate, unitType.BaseMonthlyRate, unitType.Description);
    }

    [HttpGet("rental-policies")]
    public Task<List<RentalPolicyDto>> RentalPolicies(CancellationToken ct) =>
        db.RentalPolicies.OrderByDescending(p => p.EffectiveDate).ThenBy(p => p.FacilityId)
            .Select(p => new RentalPolicyDto(p.PolicyId, p.PolicyName, p.FacilityId,
                p.DepositPercent, p.CancellationGraceHours, p.CancellationFeePercent,
                p.RenewalNoticeDays, p.MaxOverdueDaysBeforeLock, p.IsActive, p.EffectiveDate))
            .ToListAsync(ct);

    [HttpPost("rental-policies")]
    public async Task<RentalPolicyDto> CreateRentalPolicy(SaveRentalPolicyRequest req, CancellationToken ct)
    {
        if (req.FacilityId is int facilityId
            && !await db.Facilities.AnyAsync(f => f.FacilityId == facilityId, ct))
            throw AppException.NotFound("Không tìm thấy cơ sở cho chính sách");
        var policy = new RentalPolicy
        {
            PolicyName = req.PolicyName.Trim(),
            FacilityId = req.FacilityId,
            DepositPercent = req.DepositPercent,
            CancellationGraceHours = req.CancellationGraceHours,
            CancellationFeePercent = req.CancellationFeePercent,
            RenewalNoticeDays = req.RenewalNoticeDays,
            MaxOverdueDaysBeforeLock = req.MaxOverdueDaysBeforeLock,
            IsActive = req.IsActive,
            EffectiveDate = req.EffectiveDate,
        };
        db.RentalPolicies.Add(policy);
        AddLog("RentalPolicyCreated", "Created a rental policy");
        await db.SaveChangesAsync(ct);
        return ToPolicyDto(policy);
    }

    [HttpPut("rental-policies/{policyId:int}")]
    public async Task<RentalPolicyDto> UpdateRentalPolicy(
        int policyId, SaveRentalPolicyRequest req, CancellationToken ct)
    {
        if (req.FacilityId is int facilityId
            && !await db.Facilities.AnyAsync(f => f.FacilityId == facilityId, ct))
            throw AppException.NotFound("Không tìm thấy cơ sở cho chính sách");
        var policy = await db.RentalPolicies.FindAsync([policyId], ct)
            ?? throw AppException.NotFound("Không tìm thấy chính sách thuê");
        policy.PolicyName = req.PolicyName.Trim();
        policy.FacilityId = req.FacilityId;
        policy.DepositPercent = req.DepositPercent;
        policy.CancellationGraceHours = req.CancellationGraceHours;
        policy.CancellationFeePercent = req.CancellationFeePercent;
        policy.RenewalNoticeDays = req.RenewalNoticeDays;
        policy.MaxOverdueDaysBeforeLock = req.MaxOverdueDaysBeforeLock;
        policy.IsActive = req.IsActive;
        policy.EffectiveDate = req.EffectiveDate;
        AddLog("RentalPolicyUpdated", $"Updated rental policy {policyId}");
        await db.SaveChangesAsync(ct);
        return ToPolicyDto(policy);
    }

    [HttpGet("fees")]
    public Task<List<FeeConfigurationDto>> Fees(CancellationToken ct) =>
        db.FeeConfigurations.OrderBy(f => f.FeeCode)
            .Select(f => new FeeConfigurationDto(f.FeeTypeId, f.FeeCode, f.FeeName,
                f.DefaultAmount, f.CalculationMethod, f.Description))
            .ToListAsync(ct);

    [HttpPost("fees")]
    public async Task<FeeConfigurationDto> CreateFee(SaveFeeConfigurationRequest req, CancellationToken ct)
    {
        ValidateFee(req);
        var code = req.FeeCode.Trim().ToUpperInvariant();
        if (await db.FeeConfigurations.AnyAsync(f => f.FeeCode == code, ct))
            throw AppException.Conflict("Mã loại phí đã tồn tại");
        var fee = new FeeConfiguration
        {
            FeeCode = code,
            FeeName = req.FeeName.Trim(),
            DefaultAmount = req.DefaultAmount,
            CalculationMethod = req.CalculationMethod,
            Description = Normalize(req.Description),
        };
        db.FeeConfigurations.Add(fee);
        AddLog("FeeConfigurationCreated", $"Created fee configuration {code}");
        await db.SaveChangesAsync(ct);
        return ToFeeDto(fee);
    }

    [HttpPut("fees/{feeTypeId:int}")]
    public async Task<FeeConfigurationDto> UpdateFee(
        int feeTypeId, SaveFeeConfigurationRequest req, CancellationToken ct)
    {
        ValidateFee(req);
        var fee = await db.FeeConfigurations.FindAsync([feeTypeId], ct)
            ?? throw AppException.NotFound("Không tìm thấy loại phí");
        var code = req.FeeCode.Trim().ToUpperInvariant();
        if (await db.FeeConfigurations.AnyAsync(f => f.FeeTypeId != feeTypeId && f.FeeCode == code, ct))
            throw AppException.Conflict("Mã loại phí đã tồn tại");
        fee.FeeCode = code;
        fee.FeeName = req.FeeName.Trim();
        fee.DefaultAmount = req.DefaultAmount;
        fee.CalculationMethod = req.CalculationMethod;
        fee.Description = Normalize(req.Description);
        AddLog("FeeConfigurationUpdated", $"Updated fee configuration {code}");
        await db.SaveChangesAsync(ct);
        return ToFeeDto(fee);
    }

    [HttpGet("promotions")]
    public Task<List<PromotionDto>> Promotions(CancellationToken ct) =>
        db.Promotions.OrderByDescending(p => p.StartDate)
            .Select(p => new PromotionDto(p.PromotionId, p.PromoCode, p.Title, p.DiscountPercent,
                p.MaxDiscountAmount, p.MinRentalMonths, p.StartDate, p.EndDate, p.IsActive))
            .ToListAsync(ct);

    [HttpPost("promotions")]
    public async Task<PromotionDto> CreatePromotion(SavePromotionRequest req, CancellationToken ct)
    {
        ValidatePromotion(req);
        var code = req.PromoCode.Trim().ToUpperInvariant();
        if (await db.Promotions.AnyAsync(p => p.PromoCode == code, ct))
            throw AppException.Conflict("Mã khuyến mãi đã tồn tại");
        var promotion = new Promotion
        {
            PromoCode = code,
            Title = req.Title.Trim(),
            DiscountPercent = req.DiscountPercent,
            MaxDiscountAmount = req.MaxDiscountAmount,
            MinRentalMonths = req.MinRentalMonths,
            StartDate = req.StartDate,
            EndDate = req.EndDate,
            IsActive = req.IsActive,
        };
        db.Promotions.Add(promotion);
        AddLog("PromotionCreated", $"Created promotion {code}");
        await db.SaveChangesAsync(ct);
        return ToPromotionDto(promotion);
    }

    [HttpPut("promotions/{promotionId:int}")]
    public async Task<PromotionDto> UpdatePromotion(
        int promotionId, SavePromotionRequest req, CancellationToken ct)
    {
        ValidatePromotion(req);
        var promotion = await db.Promotions.FindAsync([promotionId], ct)
            ?? throw AppException.NotFound("Không tìm thấy khuyến mãi");
        var code = req.PromoCode.Trim().ToUpperInvariant();
        if (await db.Promotions.AnyAsync(p => p.PromotionId != promotionId && p.PromoCode == code, ct))
            throw AppException.Conflict("Mã khuyến mãi đã tồn tại");
        promotion.PromoCode = code;
        promotion.Title = req.Title.Trim();
        promotion.DiscountPercent = req.DiscountPercent;
        promotion.MaxDiscountAmount = req.MaxDiscountAmount;
        promotion.MinRentalMonths = req.MinRentalMonths;
        promotion.StartDate = req.StartDate;
        promotion.EndDate = req.EndDate;
        promotion.IsActive = req.IsActive;
        AddLog("PromotionUpdated", $"Updated promotion {code}");
        await db.SaveChangesAsync(ct);
        return ToPromotionDto(promotion);
    }

    [HttpDelete("rental-policies/{policyId:int}")]
    public async Task<IActionResult> DeleteRentalPolicy(int policyId, CancellationToken ct)
    {
        var policy = await db.RentalPolicies.FindAsync([policyId], ct)
            ?? throw AppException.NotFound("Không tìm thấy chính sách thuê");
        db.RentalPolicies.Remove(policy);
        AddLog("RentalPolicyDeleted", $"Deleted rental policy {policyId}");
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("fees/{feeTypeId:int}")]
    public async Task<IActionResult> DeleteFee(int feeTypeId, CancellationToken ct)
    {
        var fee = await db.FeeConfigurations.FindAsync([feeTypeId], ct)
            ?? throw AppException.NotFound("Không tìm thấy loại phí");
        if (await db.InvoiceDetails.AnyAsync(d => d.FeeTypeId == feeTypeId, ct))
            throw AppException.Conflict("Loại phí đã được dùng trong hóa đơn nên không thể xóa");
        db.FeeConfigurations.Remove(fee);
        AddLog("FeeConfigurationDeleted", $"Deleted fee configuration {fee.FeeCode}");
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("promotions/{promotionId:int}")]
    public async Task<IActionResult> DeletePromotion(int promotionId, CancellationToken ct)
    {
        var promotion = await db.Promotions.FindAsync([promotionId], ct)
            ?? throw AppException.NotFound("Không tìm thấy khuyến mãi");
        if (await db.Reservations.AnyAsync(r => r.PromotionId == promotionId, ct)
            || await db.Contracts.AnyAsync(c => c.PromotionId == promotionId, ct))
            throw AppException.Conflict("Khuyến mãi đã được áp dụng nên không thể xóa; hãy tắt IsActive");
        db.Promotions.Remove(promotion);
        AddLog("PromotionDeleted", $"Deleted promotion {promotion.PromoCode}");
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private void AddLog(string action, string details)
    {
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = User.GetUserId(),
            Action = action,
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = details,
            CreatedAt = clock.GetLocalNow().DateTime,
        });
    }

    private static void ValidateFee(SaveFeeConfigurationRequest req)
    {
        if (!FeeMethods.Contains(req.CalculationMethod))
            throw AppException.BadRequest("Cách tính phí phải là Fixed, DailyRate hoặc Percentage");
        if (string.Equals(req.FeeCode.Trim(), "LATE_FEE_DAILY", StringComparison.OrdinalIgnoreCase)
            && req.CalculationMethod is not ("DailyRate" or "Percentage"))
            throw AppException.BadRequest("LATE_FEE_DAILY chỉ hỗ trợ cách tính DailyRate hoặc Percentage");
    }

    private static void ValidatePromotion(SavePromotionRequest req)
    {
        if (req.EndDate < req.StartDate)
            throw AppException.BadRequest("Ngày kết thúc khuyến mãi phải từ ngày bắt đầu trở đi");
    }

    private static FacilityDto ToFacilityDto(Facility facility) =>
        new(facility.FacilityId, facility.FacilityName, facility.Address, facility.City,
            facility.District, facility.Hotline, facility.OperatingHours, facility.Status);

    private static RentalPolicyDto ToPolicyDto(RentalPolicy policy) =>
        new(policy.PolicyId, policy.PolicyName, policy.FacilityId, policy.DepositPercent,
            policy.CancellationGraceHours, policy.CancellationFeePercent, policy.RenewalNoticeDays,
            policy.MaxOverdueDaysBeforeLock, policy.IsActive, policy.EffectiveDate);

    private static FeeConfigurationDto ToFeeDto(FeeConfiguration fee) =>
        new(fee.FeeTypeId, fee.FeeCode, fee.FeeName, fee.DefaultAmount, fee.CalculationMethod, fee.Description);

    private static PromotionDto ToPromotionDto(Promotion promotion) =>
        new(promotion.PromotionId, promotion.PromoCode, promotion.Title, promotion.DiscountPercent,
            promotion.MaxDiscountAmount, promotion.MinRentalMonths, promotion.StartDate,
            promotion.EndDate, promotion.IsActive);

    private static string? Normalize(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
