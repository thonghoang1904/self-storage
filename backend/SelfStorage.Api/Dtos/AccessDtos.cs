using System.ComponentModel.DataAnnotations;
using SelfStorage.Api.Infrastructure;

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
    bool CanEnter,
    // For staff recording the customer's CCCD after checking the card.
    int CustomerId);

public record GrantEntryRequest(
    [Required] int ContractId,
    [Required] long VisitRegistrationId,
    // Null = the contract's customer came in person.
    int? AuthorizedPersonId,
    // CCCD number read off the visitor's card, compared with the one on file.
    [Required(ErrorMessage = "Vui lòng nhập số CCCD trên thẻ của khách")]
    [CitizenId]
    string CitizenId,
    [StringLength(255)] string? Purpose,
    [StringLength(500)] string? Notes);

/// <summary>Staff checked the customer's card in person and records (or corrects) the CCCD on file.</summary>
public record UpdateCustomerCitizenIdRequest(
    [Required(ErrorMessage = "Vui lòng nhập số CCCD trên thẻ của khách")]
    [CitizenId]
    string CitizenId,
    [StringLength(300)] string? Notes);

public record DenyEntryRequest(
    [Required] int ContractId,
    int? AuthorizedPersonId,
    [Required] string Reason,
    [StringLength(500)] string? Notes);

public record MoveInItemRequest(
    [Required(ErrorMessage = "Vui lòng nhập tên món đồ")]
    [StringLength(100, ErrorMessage = "Tên món đồ tối đa 100 ký tự")]
    string Name,
    [Range(1, 999, ErrorMessage = "Số lượng mỗi món phải từ 1 đến 999")]
    int Quantity,
    [Range(typeof(decimal), "0.1", "2000", ErrorMessage = "Chiều dài (cm) phải từ 0,1 đến 2000")]
    decimal LengthCm,
    [Range(typeof(decimal), "0.1", "2000", ErrorMessage = "Chiều rộng (cm) phải từ 0,1 đến 2000")]
    decimal WidthCm,
    [Range(typeof(decimal), "0.1", "2000", ErrorMessage = "Chiều cao (cm) phải từ 0,1 đến 2000")]
    decimal HeightCm,
    [StringLength(80, ErrorMessage = "Loại đồ tối đa 80 ký tự")]
    string? Category = null,
    [StringLength(300, ErrorMessage = "Ghi chú tối đa 300 ký tự")]
    string? Notes = null,
    [StringLength(500, ErrorMessage = "Đường dẫn ảnh tối đa 500 ký tự")]
    string? ImageUrl = null);

public record StoredItemDto(
    long StoredItemId,
    int ContractId,
    long? VisitRegistrationId,
    string ItemName,
    string? Category,
    int Quantity,
    decimal LengthCm,
    decimal WidthCm,
    decimal HeightCm,
    decimal UnitVolumeM3,
    decimal TotalVolumeM3,
    string Status,
    string? Notes,
    string? ImageUrl,
    DateTime CreatedAt,
    DateTime? MovedInAt,
    DateTime? RemovedAt,
    DateTime? UpdatedAt);

public record ContractInventoryDto(
    int ContractId,
    string ContractNumber,
    string UnitCode,
    decimal UnitLengthCm,
    decimal UnitWidthCm,
    decimal UnitHeightCm,
    decimal UnitVolumeM3,
    decimal StoredVolumeM3,
    decimal PendingVolumeM3,
    decimal RemainingVolumeM3,
    decimal OccupancyPercent,
    IReadOnlyList<StoredItemDto> Items);

public record UpdateStoredItemRequest(
    [Required(ErrorMessage = "Vui lòng nhập tên món đồ")]
    [StringLength(100, ErrorMessage = "Tên món đồ tối đa 100 ký tự")]
    string ItemName,
    [StringLength(80, ErrorMessage = "Loại đồ tối đa 80 ký tự")]
    string? Category,
    [Range(1, 999, ErrorMessage = "Số lượng mỗi món phải từ 1 đến 999")]
    int Quantity,
    [Range(typeof(decimal), "0.1", "2000", ErrorMessage = "Chiều dài (cm) phải từ 0,1 đến 2000")]
    decimal LengthCm,
    [Range(typeof(decimal), "0.1", "2000", ErrorMessage = "Chiều rộng (cm) phải từ 0,1 đến 2000")]
    decimal WidthCm,
    [Range(typeof(decimal), "0.1", "2000", ErrorMessage = "Chiều cao (cm) phải từ 0,1 đến 2000")]
    decimal HeightCm,
    [StringLength(300, ErrorMessage = "Ghi chú tối đa 300 ký tự")]
    string? Notes = null,
    [StringLength(500, ErrorMessage = "Đường dẫn ảnh tối đa 500 ký tự")]
    string? ImageUrl = null);

public record RemoveStoredItemRequest(
    [Range(1, 999, ErrorMessage = "Số lượng lấy ra phải từ 1 đến 999")]
    int QuantityToRemove,
    [StringLength(300, ErrorMessage = "Ghi chú tối đa 300 ký tự")]
    string? Notes = null);

public record CreateVisitRegistrationRequest(
    [Required, CitizenId] string CitizenId,
    int? AuthorizedPersonId,
    [Required] DateTimeOffset ScheduledEntryAt,
    [Required] DateTimeOffset ScheduledExitAt,
    [Required, StringLength(255)] string Purpose,
    IReadOnlyList<MoveInItemRequest>? Items = null);

// Nullable so that a missing value is a 400 instead of silently binding to false (= reject).
public record ReviewVisitRegistrationRequest(
    [Required] bool? Approve,
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
    string? ReviewNotes,
    IReadOnlyList<StoredItemDto>? Items = null);

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
