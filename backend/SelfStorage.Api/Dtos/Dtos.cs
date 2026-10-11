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

public record CheckInRequest([Required] int UnitId);

// ---- Contracts ----

public record ContractDto(int ContractId, string ContractNumber, int FacilityId, string FacilityName, string UnitCode,
    DateOnly StartDate, DateOnly EndDate, decimal MonthlyRentFee, string Status, bool HasPin, DateTime? PinLockedUntil);

public record AddAuthorizedPersonRequest(
    [Required, StringLength(100)] string FullName,
    [Required, StringLength(20)] string PhoneNumber,
    [Required, StringLength(25)] string CitizenId,
    [StringLength(50)] string? Relationship);
