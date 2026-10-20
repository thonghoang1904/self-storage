namespace SelfStorage.Api.Data.Entities;

public class ActivityLog
{
    public long LogId { get; set; }
    public int? UserId { get; set; }
    public string Action { get; set; } = null!;
    public string? IpAddress { get; set; }
    public string? Details { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Invoice
{
    public int InvoiceId { get; set; }
    public string InvoiceNumber { get; set; } = null!;
    public int? ContractId { get; set; }
    public int? ReservationId { get; set; }
    public int CustomerId { get; set; }
    public string InvoiceType { get; set; } = null!;
    public decimal SubTotal { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal TotalAmount { get; private set; }
    public DateOnly DueDate { get; set; }
    public DateOnly? BillingPeriodStart { get; set; }
    public DateOnly? BillingPeriodEnd { get; set; }
    public string Status { get; set; } = "Unpaid";
    public DateTime CreatedAt { get; set; }

    public ICollection<InvoiceDetail> Details { get; set; } = new List<InvoiceDetail>();
    public ICollection<Payment> Payments { get; set; } = new List<Payment>();
}

public class InvoiceDetail
{
    public int DetailId { get; set; }
    public int InvoiceId { get; set; }
    public int? FeeTypeId { get; set; }
    public string Description { get; set; } = null!;
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal LineTotal { get; private set; }
}

public class Payment
{
    public int PaymentId { get; set; }
    public int InvoiceId { get; set; }
    public int? ReceivedByStaffId { get; set; }
    public string PaymentMethod { get; set; } = null!;
    public string? TransactionCode { get; set; }
    public decimal AmountPaid { get; set; }
    public DateTime PaymentDate { get; set; }
    public string Status { get; set; } = "Success";
    public string? PaymentNotes { get; set; }
}

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
    public int? InvoiceId { get; set; }
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
    public ICollection<SupportChecklistItem> ChecklistItems { get; set; } = new List<SupportChecklistItem>();
}

public class SupportChecklistItem
{
    public int ChecklistItemId { get; set; }
    public int RequestId { get; set; }
    public int SortOrder { get; set; }
    public string Description { get; set; } = null!;
    public bool IsCompleted { get; set; }
    public int? CompletedByStaffId { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? Notes { get; set; }

    public SupportRequest Request { get; set; } = null!;
    public User? CompletedByStaff { get; set; }
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
