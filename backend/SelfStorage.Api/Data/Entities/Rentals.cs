namespace SelfStorage.Api.Data.Entities;

public class Reservation
{
    public int ReservationId { get; set; }
    public string ReservationCode { get; set; } = null!;
    public int CustomerId { get; set; }
    public int FacilityId { get; set; }
    public int UnitTypeId { get; set; }
    public int? AssignedUnitId { get; set; }
    public DateOnly ExpectedStartDate { get; set; }
    public int DurationMonths { get; set; }
    public decimal DepositAmount { get; set; }
    public decimal EstimatedTotalFee { get; set; }
    public string Status { get; set; } = ReservationStatus.PendingDeposit;
    public DateTime DepositDeadline { get; set; }
    public DateTime CreatedAt { get; set; }

    public User Customer { get; set; } = null!;
    public Facility Facility { get; set; } = null!;
    public UnitType UnitType { get; set; } = null!;
    public StorageUnit? AssignedUnit { get; set; }
}

public class Contract
{
    public int ContractId { get; set; }
    public string ContractNumber { get; set; } = null!;
    public int? ReservationId { get; set; }
    public int CustomerId { get; set; }
    public int UnitId { get; set; }
    public int StaffCreatedId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public decimal MonthlyRentFee { get; set; }
    public decimal DepositPaid { get; set; }
    public string Status { get; set; } = ContractStatus.Active;
    public DateTime SignedDate { get; set; }
    public string? TermsConditions { get; set; }

    public User Customer { get; set; } = null!;
    public StorageUnit Unit { get; set; } = null!;
    public ICollection<AuthorizedPerson> AuthorizedPersons { get; set; } = new List<AuthorizedPerson>();
}
