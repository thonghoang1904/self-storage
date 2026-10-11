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
/// One visit. Staff checks the visitor's ID at the gate, then records Granted (entry) or Denied.
/// A Granted row with no ExitTime means the visitor is still inside; staff fills ExitTime when they leave.
/// </summary>
public class AccessRecord
{
    public long AccessRecordId { get; set; }
    public int ContractId { get; set; }
    public int FacilityId { get; set; }
    public int UnitId { get; set; }
    public int? AuthorizedPersonId { get; set; }
    public int VerifiedByStaffId { get; set; }
    public string VerificationMethod { get; set; } = "CitizenID";
    public string Result { get; set; } = null!;
    public string? DenyReason { get; set; }
    public string? Purpose { get; set; }
    public DateTime EntryTime { get; set; }
    public DateTime? ExitTime { get; set; }
    public int? ExitConfirmedByStaffId { get; set; }
    public string? Notes { get; set; }

    public Contract Contract { get; set; } = null!;
    public StorageUnit Unit { get; set; } = null!;
    public AuthorizedPerson? AuthorizedPerson { get; set; }
    public User VerifiedByStaff { get; set; } = null!;
}
