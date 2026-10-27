namespace SelfStorage.Api.Data.Entities;

/// <summary>
/// Handing a unit back before the contract's end date. A customer creates it as Pending (the day they plan to
/// come); staff completing an early return mark it Completed (or create a Completed row when the customer came
/// without a request). EarlyReturnFee is the fee charged, deducted from the deposit like overdue fees.
/// </summary>
public class EarlyReturnRequest
{
    public int RequestId { get; set; }
    public int ContractId { get; set; }
    public int CustomerId { get; set; }
    public DateOnly ReturnDate { get; set; }
    public string Reason { get; set; } = null!;
    public decimal EarlyReturnFee { get; set; }
    public string Status { get; set; } = EarlyReturnStatus.Pending;
    public DateTime RequestedAt { get; set; }
    public int? CompletedByStaffId { get; set; }
    public DateTime? CompletedAt { get; set; }

    public Contract Contract { get; set; } = null!;
    public User Customer { get; set; } = null!;
}

public static class EarlyReturnStatus
{
    public const string Pending = "Pending";
    public const string Completed = "Completed";
    public const string Cancelled = "Cancelled";
}
