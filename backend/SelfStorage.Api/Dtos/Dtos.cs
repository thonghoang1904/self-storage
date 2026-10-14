using System.ComponentModel.DataAnnotations;

namespace SelfStorage.Api.Dtos;

// ---- Auth ----

public record RegisterRequest(
    [Required, StringLength(50, MinimumLength = 3)] string Username,
    [Required, StringLength(100, MinimumLength = 8)] string Password,
    [Required, StringLength(100)] string FullName,
    [Required, EmailAddress, StringLength(100)] string Email,
    [Required, StringLength(20)] string PhoneNumber,
    // Needed so staff can check the customer's ID card at the gate.
    [Required, StringLength(25)] string CitizenId);

public record LoginRequest([Required] string Username, [Required] string Password);

public record UserDto(int UserId, string Username, string FullName, string Role);

public record LoginResponse(string Token, DateTime ExpiresAt, UserDto User);

// ---- Catalog ----

public record FacilityDto(int FacilityId, string FacilityName, string Address, string City, string District,
    string Hotline, string OperatingHours, string Status);

public record UnitTypeDto(int UnitTypeId, string TypeName, decimal LengthMeters, decimal WidthMeters, decimal HeightMeters,
    decimal VolumeCubicMeters, bool HasClimateControl, decimal BaseDailyRate, decimal BaseMonthlyRate, string? Description);

public record StorageUnitDto(int UnitId, string UnitCode, int FloorNumber, string? ZoneArea, decimal MonthlyPrice,
    string Status, int UnitTypeId, string UnitTypeName);

public record AvailabilityDto(int UnitTypeId, string TypeName, decimal BaseMonthlyRate, int AvailableUnits);

// ---- Reservations ----

public record CreateReservationRequest(
    [Required] int FacilityId,
    [Required] int UnitTypeId,
    [Required] DateOnly ExpectedStartDate,
    [Range(1, 60)] int DurationMonths);

public record ReservationDto(int ReservationId, string ReservationCode, string FacilityName, string UnitTypeName,
    string? AssignedUnitCode, DateOnly ExpectedStartDate, int DurationMonths, decimal DepositAmount,
    decimal EstimatedTotalFee, string Status, DateTime DepositDeadline, string CustomerName);

public record CheckInRequest([Required] int UnitId,
    [Required, StringLength(1000)] string UnitConditionNotes = "Tình trạng kho bình thường khi bàn giao");

// ---- Contracts ----

public record ContractDto(int ContractId, string ContractNumber, int FacilityId, string FacilityName, string UnitCode,
    DateOnly StartDate, DateOnly EndDate, decimal MonthlyRentFee, string Status);

public record AddAuthorizedPersonRequest(
    [Required, StringLength(100)] string FullName,
    [Required, StringLength(20)] string PhoneNumber,
    [Required, StringLength(25)] string CitizenId,
    [StringLength(50)] string? Relationship);

public record ContractDetailDto(
    int ContractId,
    string ContractNumber,
    int FacilityId,
    string FacilityName,
    int UnitId,
    string UnitCode,
    string UnitStatus,
    DateOnly StartDate,
    DateOnly EndDate,
    string Status,
    decimal MonthlyRentFee,
    decimal DepositPaid,
    decimal AccumulatedLateFee,
    decimal DepositBalance,
    decimal OutstandingLateFee,
    DateTime RenewalAvailableFrom);

public record RequestRenewalRequest([Range(1, 60)] int ExtensionMonths);
public record RenewalDto(int RenewalId, int ContractId, DateOnly OldEndDate, DateOnly NewEndDate,
    int ExtensionMonths, decimal RenewalFee, string Status, DateTime RequestedAt);
public record ReturnUnitRequest([Required, StringLength(1000)] string UnitConditionNotes,
    bool AllItemsRemoved,
    [StringLength(500)] string? StaffNotes);
public record ReturnUnitDto(int ContractId, string Status, string UnitStatus, decimal DepositPaid,
    decimal LateFeesDeducted, decimal DepositRefundDue, decimal LateFeesStillOwed, DateTime ReturnedAt);
public record OverdueSummaryDto(int OverdueId, int ContractId, string ContractNumber, string CustomerName,
    string UnitCode, DateOnly EndDate, string ContractStatus, string UnitStatus, int DaysOverdue,
    decimal AccumulatedLateFee, decimal DepositBalance, decimal OutstandingLateFee, DateTime? LockAppliedAt);

public record CreateSupportRequest(
    [Required] int ContractId,
    [Required] string Category,
    [Required, StringLength(200)] string Title,
    [Required, StringLength(4000)] string Description,
    [StringLength(20)] string Priority = "Medium");
public record SupportRequestDto(int RequestId, string RequestCode, int ContractId, string UnitCode,
    string Category, string Priority, string Title, string Description, string Status, DateTime CreatedAt,
    string? AssignedStaffName);
public record SupportUpdateDto(int UpdateId, string UpdatedBy, string ActionMessage,
    string? PreviousStatus, string? NewStatus, DateTime CreatedAt);
public record UpdateSupportRequest([Required] string Status, [Required, StringLength(4000)] string ActionMessage);
