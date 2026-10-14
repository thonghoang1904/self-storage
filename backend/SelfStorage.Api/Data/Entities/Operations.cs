namespace SelfStorage.Api.Data.Entities;

public class HandoverRecord
{
    public int HandoverId { get; set; }
    public int ContractId { get; set; }
    public int StaffId { get; set; }
    public string HandoverType { get; set; } = null!;
    public DateTime HandoverDateTime { get; set; }
    public int PhysicalKeyCount { get; set; }
    public string? AccessCardCode { get; set; }
    public string? PasscodeActivated { get; set; }
    public string UnitConditionNotes { get; set; } = null!;
    public bool CustomerSignatureConfirmed { get; set; }
    public string? StaffNotes { get; set; }
    public Contract Contract { get; set; } = null!;
}

public class ContractRenewal
{
    public int RenewalId { get; set; }
    public int ContractId { get; set; }
    public int? ApprovedByStaffId { get; set; }
    public DateOnly OldEndDate { get; set; }
    public DateOnly NewEndDate { get; set; }
    public int ExtensionMonths { get; set; }
    public decimal RenewalFee { get; set; }
    public string Status { get; set; } = "Pending";
    public DateTime RequestedAt { get; set; }
    public DateTime? ProcessedAt { get; set; }
}

public class OverdueRecord
{
    public int OverdueId { get; set; }
    public int ContractId { get; set; }
    public int? HandledByStaffId { get; set; }
    public int DaysOverdue { get; set; }
    public decimal AccumulatedLateFee { get; set; }
    public DateTime? LockAppliedDate { get; set; }
    public DateTime? NoticeSentDate { get; set; }
    public string ActionTaken { get; set; } = "NoticeSent";
    public DateTime? ResolvedDate { get; set; }
    public string? Notes { get; set; }
}

public class SupportRequest
{
    public int RequestId { get; set; }
    public string RequestCode { get; set; } = null!;
    public int CustomerId { get; set; }
    public int FacilityId { get; set; }
    public int? ContractId { get; set; }
    public int? UnitId { get; set; }
    public int? AssignedStaffId { get; set; }
    public string Category { get; set; } = null!;
    public string Priority { get; set; } = "Medium";
    public string Title { get; set; } = null!;
    public string Description { get; set; } = null!;
    public string Status { get; set; } = "Open";
    public DateTime CreatedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }

    public Contract? Contract { get; set; }
    public StorageUnit? Unit { get; set; }
    public User Customer { get; set; } = null!;
    public User? AssignedStaff { get; set; }
}

public class SupportUpdate
{
    public int UpdateId { get; set; }
    public int RequestId { get; set; }
    public int UpdatedByUserId { get; set; }
    public string ActionMessage { get; set; } = null!;
    public string? PreviousStatus { get; set; }
    public string? NewStatus { get; set; }
    public DateTime CreatedAt { get; set; }
    public SupportRequest Request { get; set; } = null!;
}
