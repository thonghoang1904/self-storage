namespace SelfStorage.Api.Data.Entities;

/// <summary>Someone the customer allows to enter the unit on their behalf.</summary>
public class AuthorizedPerson
{
    public int AuthorizedPersonId { get; set; }
    public int ContractId { get; set; }
    public string FullName { get; set; } = null!;
    public string PhoneNumber { get; set; } = null!;
    public string CitizenId { get; set; } = null!;
    public string? Relationship { get; set; }
    public string Status { get; set; } = "Active";
    public DateTime CreatedAt { get; set; }
    public DateTime? RevokedAt { get; set; }

    public Contract Contract { get; set; } = null!;
}

/// <summary>
/// One visit: PIN entered at the kiosk (Pending) -> staff checks ID (Granted/Denied) -> staff confirms exit.
/// </summary>
public class AccessRecord
{
    public long AccessRecordId { get; set; }
    public int ContractId { get; set; }
    public int FacilityId { get; set; }
    public int UnitId { get; set; }
    public int? AuthorizedPersonId { get; set; }
    public int? VerifiedByStaffId { get; set; }
    public string VerificationMethod { get; set; } = "CitizenID";
    public string Result { get; set; } = AccessResult.Pending;
    public string? DenyReason { get; set; }
    public string? Purpose { get; set; }
    public DateTime EntryTime { get; set; }
    public DateTime? ExitTime { get; set; }
    public int? ExitConfirmedByStaffId { get; set; }
    public string? Notes { get; set; }
    public DateTime? PinEnteredAt { get; set; }
    public DateTime? VerifiedAt { get; set; }

    public Contract Contract { get; set; } = null!;
    public StorageUnit Unit { get; set; } = null!;
    public AuthorizedPerson? AuthorizedPerson { get; set; }
    public User? VerifiedByStaff { get; set; }
}
