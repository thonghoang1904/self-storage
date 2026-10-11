using System.ComponentModel.DataAnnotations;

namespace SelfStorage.Api.Dtos;

// ---- Kiosk at the gate ----

public record KioskPinRequest(
    [Required, StringLength(30)] string UnitCode,
    [Required, StringLength(6, MinimumLength = 6)] string Pin);

// Status: Pending | Granted | Denied
public record KioskRequestStatus(long RequestId, string UnitCode, string Status, string Message);

// ---- Staff at the gate ----

public record PersonDto(int? AuthorizedPersonId, string FullName, string? CitizenId, string? PhoneNumber, string? Relationship);

public record PendingAccessDto(
    long RequestId,
    DateTime PinEnteredAt,
    string UnitCode,
    string ContractNumber,
    DateOnly ContractEndDate,
    PersonDto Customer,
    IReadOnlyList<PersonDto> AuthorizedPersons);

public record ApproveAccessRequest(
    // Null = the contract's customer came in person.
    int? AuthorizedPersonId,
    [Required] string VerificationMethod,
    // Number read off the visitor's ID card. Required for CitizenID and compared with the stored one.
    [StringLength(25)] string? DocumentNumber,
    [StringLength(255)] string? Purpose,
    [StringLength(500)] string? Notes);

public record DenyAccessRequest([Required] string Reason, [StringLength(500)] string? Notes);

public record AccessRecordDto(
    long RequestId,
    string UnitCode,
    string ContractNumber,
    string VisitorName,
    string Result,
    string? DenyReason,
    string? Purpose,
    DateTime? PinEnteredAt,
    DateTime EntryTime,
    DateTime? ExitTime,
    string? VerifiedBy);

// ---- Customer ----

public record SetPinRequest(
    // Required when a PIN is already set.
    string? CurrentPin,
    [Required] string NewPin);
