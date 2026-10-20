using System.ComponentModel.DataAnnotations;

namespace SelfStorage.Api.Dtos;

// ---- Staff at the gate ----

public record PersonDto(int? AuthorizedPersonId, string FullName, string? CitizenId, string? PhoneNumber, string? Relationship);

// Code is one of the DenyReason values in the schema, so staff can deny with it directly.
public record AccessIssueDto(string Code, string Message);

// One contract the visitor may be coming for, found by the staff lookup.
public record VisitCandidateDto(
    int ContractId,
    string ContractNumber,
    string ContractStatus,
    DateOnly StartDate,
    DateOnly EndDate,
    string UnitCode,
    string UnitStatus,
    PersonDto Customer,
    IReadOnlyList<PersonDto> AuthorizedPersons,
    IReadOnlyList<string> PeopleInside,
    IReadOnlyList<AccessIssueDto> Issues,
    bool HasApprovedVisitRegistration,
    bool CanEnter);

public record GrantEntryRequest(
    [Required] int ContractId,
    [Required] long VisitRegistrationId,
    // Null = the contract's customer came in person.
    int? AuthorizedPersonId,
    // CCCD number read off the visitor's card, compared with the one on file.
    [Required, StringLength(25)] string CitizenId,
    [StringLength(255)] string? Purpose,
    [StringLength(500)] string? Notes);

public record DenyEntryRequest(
    [Required] int ContractId,
    int? AuthorizedPersonId,
    [Required] string Reason,
    [StringLength(500)] string? Notes);

public record CreateVisitRegistrationRequest(
    [Required, StringLength(25)] string CitizenId,
    int? AuthorizedPersonId,
    [Required] DateTimeOffset ScheduledEntryAt,
    [Required] DateTimeOffset ScheduledExitAt,
    [Required, StringLength(255)] string Purpose);

public record ReviewVisitRegistrationRequest(
    [Required] bool Approve,
    [StringLength(500)] string? Notes);

public record VisitRegistrationDto(
    long VisitRegistrationId,
    int ContractId,
    string ContractNumber,
    int FacilityId,
    string UnitCode,
    int? AuthorizedPersonId,
    string VisitorName,
    DateTimeOffset ScheduledEntryAt,
    DateTimeOffset ScheduledExitAt,
    string Purpose,
    string Status,
    DateTime RequestedAt,
    DateTime? ReviewedAt,
    string? ReviewNotes);

public record AccessRecordDto(
    long AccessRecordId,
    long? VisitRegistrationId,
    string UnitCode,
    string ContractNumber,
    string VisitorName,
    string Result,
    string? DenyReason,
    string? Purpose,
    DateTime EntryTime,
    DateTime? ExitTime,
    string VerifiedBy);
