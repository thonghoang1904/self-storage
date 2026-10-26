using System.ComponentModel.DataAnnotations;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Dtos;

// ---- Staff at the gate ----

public record PersonDto(int? AuthorizedPersonId, string FullName, string? CitizenId, string? PhoneNumber, string? Relationship);

// Code is one of the DenyReason values in the schema, so staff can deny with it directly.
// MoveOutAllowed: the visitor may still come in to empty the unit before returning it.
public record AccessIssueDto(string Code, string Message, bool MoveOutAllowed = false);

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
    bool CanEnter,
    bool CanEnterForMoveOut);

public record GrantEntryRequest(
    [Required] int ContractId,
    // Null = the contract's customer came in person.
    int? AuthorizedPersonId,
    // CCCD number read off the visitor's card, compared with the one on file.
    [Required(ErrorMessage = "Vui lòng nhập số CCCD trên thẻ của khách")]
    [CitizenId]
    string CitizenId,
    [StringLength(200)] string? Purpose,
    [StringLength(500)] string? Notes,
    // People entering with the visitor, not counting the visitor.
    [Range(0, 50)] int CompanionCount = 0,
    // Null = now. Lets staff record an entry a little after the fact; never in the future.
    DateTime? EntryTime = null,
    // Contract expired or overdue-locked: let the visitor in only to empty the unit for the return.
    bool MoveOut = false);

public record DenyEntryRequest(
    [Required] int ContractId,
    int? AuthorizedPersonId,
    [Required] string Reason,
    [StringLength(500)] string? Notes);

public record AccessRecordDto(
    long AccessRecordId,
    string UnitCode,
    string ContractNumber,
    string VisitorName,
    string Result,
    string? DenyReason,
    string? Purpose,
    int CompanionCount,
    DateTime EntryTime,
    DateTime? ExitTime,
    string VerifiedBy);
