namespace SelfStorage.Api.Data.Entities;

public class RentalPolicy
{
    public int PolicyId { get; set; }
    public string PolicyName { get; set; } = null!;
    public int? FacilityId { get; set; }
    public decimal DepositPercent { get; set; }
    public int CancellationGraceHours { get; set; }
    public decimal CancellationFeePercent { get; set; }
    public int RenewalNoticeDays { get; set; }
    public int MaxOverdueDaysBeforeLock { get; set; }
    public bool IsActive { get; set; }
    public DateOnly EffectiveDate { get; set; }
}

public class FeeConfiguration
{
    public int FeeTypeId { get; set; }
    public string FeeCode { get; set; } = null!;
    public string FeeName { get; set; } = null!;
    public decimal DefaultAmount { get; set; }
    public string CalculationMethod { get; set; } = "Fixed";
    public string? Description { get; set; }
}

public class Promotion
{
    public int PromotionId { get; set; }
    public string PromoCode { get; set; } = null!;
    public string Title { get; set; } = null!;
    public decimal DiscountPercent { get; set; }
    public decimal? MaxDiscountAmount { get; set; }
    public int MinRentalMonths { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public bool IsActive { get; set; }
}
