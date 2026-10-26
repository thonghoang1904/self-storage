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

public record GoogleLoginRequest([Required, StringLength(10000, MinimumLength = 100)] string IdToken);

public record ForgotPasswordRequest([Required, EmailAddress, StringLength(100)] string Email);

public record ResetPasswordRequest(
    [Required, StringLength(100)] string Token,
    [Required, StringLength(100, MinimumLength = 8)] string NewPassword);

public record UserDto(int UserId, string Username, string FullName, string Role);

public record LoginResponse(string Token, DateTime ExpiresAt, UserDto User);
public record AdminUserDto(int UserId, string Username, string FullName, string Email,
    string PhoneNumber, string? CitizenId, string Status, int RoleId, string RoleName);
public record CreateUserByAdminRequest(
    [Required, StringLength(50, MinimumLength = 3)] string Username,
    [Required, StringLength(100, MinimumLength = 8)] string Password,
    [Required, StringLength(100)] string FullName,
    [Required, EmailAddress, StringLength(100)] string Email,
    [Required, StringLength(20)] string PhoneNumber,
    [StringLength(25)] string? CitizenId,
    [Required] int RoleId,
    [MinLength(1)] IReadOnlyList<int>? FacilityIds = null);
public record ChangeUserRoleRequest([Required] int RoleId);
public record ChangeUserStatusRequest([Required] string Status);
public record UpdateAdminUserProfileRequest(
    [Required, StringLength(100)] string FullName,
    [Required, EmailAddress, StringLength(100)] string Email,
    [Required, StringLength(20)] string PhoneNumber,
    [StringLength(25)] string? CitizenId);
public record RoleDto(int RoleId, string RoleName, string? Description);
public record ActivityLogDto(long LogId, string Action, string? Details, string? IpAddress, DateTime CreatedAt);
public record EmailOutboxDto(
    long EmailOutboxMessageId,
    string EventKey,
    string RecipientEmail,
    string Subject,
    string Status,
    int AttemptCount,
    DateTime CreatedAt,
    DateTime NextAttemptAt,
    DateTime? SentAt,
    string? LastError);

// ---- Catalog ----

public record FacilityDto(int FacilityId, string FacilityName, string Address, string City, string District,
    string Hotline, string OperatingHours, string Status);
public record CreateFacilityRequest(
    [Required, StringLength(150)] string FacilityName,
    [Required, StringLength(255)] string Address,
    [Required, StringLength(100)] string City,
    [Required, StringLength(100)] string District,
    [Required, StringLength(20)] string Hotline,
    [Required, StringLength(100)] string OperatingHours = "24/7 Access");
public record UpdateFacilityRequest(
    [Required, StringLength(150)] string FacilityName,
    [Required, StringLength(255)] string Address,
    [Required, StringLength(100)] string City,
    [Required, StringLength(100)] string District,
    [Required, StringLength(20)] string Hotline,
    [Required, StringLength(100)] string OperatingHours,
    [Required] string Status);
public record RentalPolicyDto(int PolicyId, string PolicyName, int? FacilityId, decimal DepositPercent,
    int CancellationGraceHours, decimal CancellationFeePercent, int RenewalNoticeDays,
    int MaxOverdueDaysBeforeLock, bool IsActive, DateOnly EffectiveDate);
public record SaveRentalPolicyRequest(
    [Required, StringLength(100)] string PolicyName,
    int? FacilityId,
    [Range(typeof(decimal), "0.01", "100")] decimal DepositPercent,
    [Range(0, 8760)] int CancellationGraceHours,
    [Range(typeof(decimal), "0", "100")] decimal CancellationFeePercent,
    [Range(0, 365)] int RenewalNoticeDays,
    [Range(0, 365)] int MaxOverdueDaysBeforeLock,
    bool IsActive,
    [Required] DateOnly EffectiveDate);
public record FeeConfigurationDto(int FeeTypeId, string FeeCode, string FeeName, decimal DefaultAmount,
    string CalculationMethod, string? Description);
public record SaveFeeConfigurationRequest(
    [Required, StringLength(50)] string FeeCode,
    [Required, StringLength(100)] string FeeName,
    [Range(typeof(decimal), "0", "9999999999999999")] decimal DefaultAmount,
    [Required] string CalculationMethod,
    [StringLength(255)] string? Description);
public record PromotionDto(int PromotionId, string PromoCode, string Title, decimal DiscountPercent,
    decimal? MaxDiscountAmount, int MinRentalMonths, DateOnly StartDate, DateOnly EndDate, bool IsActive);
public record SavePromotionRequest(
    [Required, StringLength(30)] string PromoCode,
    [Required, StringLength(150)] string Title,
    [Range(typeof(decimal), "0", "100")] decimal DiscountPercent,
    [Range(typeof(decimal), "0", "9999999999999999")] decimal? MaxDiscountAmount,
    [Range(1, 60)] int MinRentalMonths,
    [Required] DateOnly StartDate,
    [Required] DateOnly EndDate,
    bool IsActive);

public record UnitTypeDto(int UnitTypeId, string TypeName, decimal LengthMeters, decimal WidthMeters, decimal HeightMeters,
    decimal VolumeCubicMeters, bool HasClimateControl, decimal BaseDailyRate, decimal BaseMonthlyRate, string? Description);
public record UpdateUnitTypePricingRequest(
    [Range(typeof(decimal), "0", "9999999999999999")] decimal BaseDailyRate,
    [Range(typeof(decimal), "0.01", "9999999999999999")] decimal BaseMonthlyRate);

public record StorageUnitDto(int UnitId, string UnitCode, int FloorNumber, string? ZoneArea, decimal MonthlyPrice,
    string Status, int UnitTypeId, string UnitTypeName);

public record CreateStorageUnitRequest(
    [Required] int UnitTypeId,
    [Required, StringLength(30)] string UnitCode,
    [Range(1, 100)] int FloorNumber,
    [StringLength(30)] string? ZoneArea,
    [Range(typeof(decimal), "0", "9999999999999999")] decimal MonthlyPrice);
public record UpdateStorageUnitRequest(
    [Required] int UnitTypeId,
    [Required, StringLength(30)] string UnitCode,
    [Range(1, 100)] int FloorNumber,
    [StringLength(30)] string? ZoneArea,
    [Range(typeof(decimal), "0", "9999999999999999")] decimal MonthlyPrice);
public record UpdateStorageUnitStatusRequest([Required] string Status);
public record FacilityStaffDto(int UserId, string Username, string FullName, string Email, string Status,
    DateOnly AssignedDate);
public record AssignFacilityStaffRequest([Required] int StaffUserId);

public record AvailabilityDto(int UnitTypeId, string TypeName, decimal BaseMonthlyRate, int AvailableUnits);

// ---- Reservations ----

public record CreateReservationRequest(
    [Required] int FacilityId,
    [Required] int UnitTypeId,
    [Required] DateOnly ExpectedStartDate,
    [Range(1, 60)] int DurationMonths,
    [StringLength(30)] string? PromoCode = null);

public record ReservationDto(int ReservationId, string ReservationCode, string FacilityName, string UnitTypeName,
    string? AssignedUnitCode, string? PromoCode, decimal PromotionDiscountAmount,
    DateOnly ExpectedStartDate, DateTimeOffset? CheckInAppointmentAt,
    int DurationMonths, decimal DepositAmount,
    decimal EstimatedTotalFee, string Status, DateTime DepositDeadline, string CustomerName, int? DepositInvoiceId);

public record SetCheckInAppointmentRequest([Required] DateTimeOffset AppointmentAt);
public record CreateCancellationRequest([Required, StringLength(1000)] string Reason);
public record ResolveCancellationRequest([Required] bool Approve, [StringLength(1000)] string? Notes);
public record CancellationRequestDto(int CancellationRequestId, int ReservationId, string ReservationCode,
    string CustomerName, string Reason, string Status, DateTime RequestedAt, DateTime? ResolvedAt,
    string? ResolutionNotes, decimal? ApprovedRefundAmount);
public record RecordCancellationRefundRequest(
    [Range(typeof(decimal), "0.01", "9999999999999999")] decimal Amount,
    [Required] string PaymentMethod,
    [StringLength(100)] string? TransactionCode,
    [StringLength(500)] string? Notes);
public record CancellationRefundDto(int ReservationId, decimal RefundedAmount, decimal RemainingRefund,
    string PaymentMethod, string? TransactionCode, DateTime RefundedAt);

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

/// <summary>CitizenId identifies the person at the gate, so it cannot be changed; revoke and add again instead.</summary>
public record UpdateAuthorizedPersonRequest(
    [Required, StringLength(100)] string FullName,
    [Required, StringLength(20)] string PhoneNumber,
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

/// <summary>One contract as staff see it in the facility contract list.</summary>
public record StaffContractDto(int ContractId, string ContractNumber, string CustomerName, string CustomerPhone,
    int UnitId, string UnitCode, string UnitStatus, DateOnly StartDate, DateOnly EndDate, decimal MonthlyRentFee,
    decimal DepositPaid, string Status, bool HasPendingRenewal, DateTime ReturnAppointment);

public record AdminContractDto(
    int ContractId,
    string ContractNumber,
    int CustomerId,
    string CustomerName,
    string CustomerEmail,
    string CustomerPhoneNumber,
    int FacilityId,
    string FacilityName,
    int UnitId,
    string UnitCode,
    DateOnly StartDate,
    DateOnly EndDate,
    string Status,
    decimal MonthlyRentFee,
    decimal DepositPaid,
    DateTime SignedDate,
    string? TermsConditions);

public record UpdateAdminContractRequest(
    [Required] DateOnly EndDate,
    [StringLength(4000)] string? TermsConditions);

public record RequestRenewalRequest([Range(1, 60)] int ExtensionMonths);
public record RenewalDto(int RenewalId, int ContractId, DateOnly OldEndDate, DateOnly NewEndDate,
    int ExtensionMonths, decimal RenewalFee, string Status, DateTime RequestedAt, int? InvoiceId);
public record ReturnUnitRequest([Required, StringLength(1000)] string UnitConditionNotes,
    bool AllItemsRemoved,
    [StringLength(500)] string? StaffNotes,
    bool EarlyReturn = false,
    [StringLength(500)] string? EarlyReturnReason = null);
/// <summary>EarlyReturnFee is set for early returns; it is already included in LateFeesDeducted / LateFeesStillOwed.</summary>
public record ReturnUnitDto(int ContractId, string Status, string UnitStatus, decimal DepositPaid,
    decimal LateFeesDeducted, decimal DepositRefundDue, decimal LateFeesStillOwed, DateTime ReturnedAt,
    decimal? EarlyReturnFee = null);
public record EarlyReturnQuoteDto(int ContractId, DateOnly EndDate, int DaysEarly, decimal EarlyReturnFee,
    decimal LateFees, decimal DepositPaid, decimal DepositDeducted, decimal DepositRefundDue,
    decimal AmountStillOwed, int InvoicesCancelled);
public record CreateEarlyReturnRequest([Required] DateOnly ReturnDate, [Required, StringLength(500)] string Reason);
public record EarlyReturnRequestDto(int RequestId, int ContractId, string ContractNumber, string UnitCode,
    string CustomerName, DateOnly ReturnDate, string Reason, decimal EarlyReturnFee, string Status,
    DateTime RequestedAt);
public record OverdueSummaryDto(int OverdueId, int ContractId, string ContractNumber, string CustomerName,
    string UnitCode, DateOnly EndDate, string ContractStatus, string UnitStatus, int DaysOverdue,
    decimal AccumulatedLateFee, decimal DepositBalance, decimal OutstandingLateFee, DateTime? LockAppliedAt);
public record FacilityWorkQueueDto(DateOnly Date, IReadOnlyList<ReservationDto> CheckIns,
    IReadOnlyList<FacilityTaskContractDto> Returns, IReadOnlyList<SupportRequestDto> SupportRequests);
public record FacilityTaskContractDto(int ContractId, string ContractNumber, string CustomerName, string UnitCode,
    DateOnly EndDate, string Status, decimal DepositPaid, decimal AccumulatedLateFee);
public record FacilityDashboardDto(int FacilityId, string FacilityName, DateOnly FromDate, DateOnly ToDate,
    int TotalUnits, int AvailableUnits, int RentedUnits, int MaintenanceUnits, int OverdueLockedUnits,
    int ActiveContracts, int OverdueContracts, int OpenSupportRequests, decimal NetRevenue);
public record OperationsDashboardDto(DateOnly FromDate, DateOnly ToDate, int FacilityCount,
    int TotalUnits, int AvailableUnits, int RentedUnits, int MaintenanceUnits, int OverdueLockedUnits,
    int ActiveContracts, int OverdueContracts, int OpenSupportRequests, decimal NetRevenue,
    IReadOnlyList<FacilityDashboardDto> Facilities);
public record OperationsReportRowDto(
    DateOnly FromDate,
    DateOnly ToDate,
    int FacilityId,
    string FacilityName,
    int UnitTypeId,
    string UnitTypeName,
    int TotalUnits,
    int AvailableUnits,
    int ReservedUnits,
    int RentedUnits,
    int MaintenanceUnits,
    int OverdueLockedUnits,
    decimal OccupancyRatePercent,
    int ActiveContracts,
    int OverdueContracts,
    int TerminatedContracts,
    int RenewedContracts,
    int LiquidatedContracts,
    decimal NetRevenue);

public record CreateSupportRequest(
    [Required] int ContractId,
    [Required] string Category,
    [Required, StringLength(200)] string Title,
    [Required, StringLength(4000)] string Description,
    [StringLength(20)] string Priority = "Medium");
public record SupportRequestDto(int RequestId, string RequestCode, int ContractId, string UnitCode,
    string Category, string Priority, string Title, string Description, string Status, DateTime CreatedAt,
    string? AssignedStaffName);
public record AdminSupportRequestDto(int RequestId, string RequestCode, int ContractId, string UnitCode,
    string Category, string Priority, string Title, string Description, string Status, DateTime CreatedAt,
    string? AssignedStaffName, int FacilityId, string FacilityName, int CustomerId, string CustomerName);
public record SupportUpdateDto(int UpdateId, string UpdatedBy, string ActionMessage,
    string? PreviousStatus, string? NewStatus, DateTime CreatedAt);
public record AddSupportMessageRequest([Required, StringLength(1000)] string Message);

public record RecordPaymentRequest(
    [Required] string PaymentMethod,
    [Required, Range(typeof(decimal), "0.01", "9999999999999999")] decimal AmountPaid,
    [StringLength(100)] string? TransactionCode,
    [StringLength(255)] string? PaymentNotes);
public record CheckoutResponse(string Provider, int PaymentId, string TransactionReference,
    decimal Amount, string PaymentUrl, string? QrCodeUrl = null, string? Deeplink = null,
    string? DeeplinkWebInApp = null);
public record RecordDepositRefundRequest(
    [Required] string PaymentMethod,
    [Required, Range(typeof(decimal), "0.01", "9999999999999999")] decimal Amount,
    [StringLength(100)] string? TransactionCode,
    [StringLength(255)] string? Notes);
public record InvoiceDetailDto(int DetailId, string Description, int Quantity, decimal UnitPrice, decimal LineTotal);
public record PaymentDto(int PaymentId, string PaymentMethod, string? TransactionCode, decimal AmountPaid,
    DateTime PaymentDate, string Status, string? PaymentNotes, string? ReceivedByStaff);
public record InvoiceDto(int InvoiceId, string InvoiceNumber, int? ContractId, int? ReservationId,
    string InvoiceType, decimal SubTotal, decimal DiscountAmount, decimal TotalAmount, DateOnly DueDate,
    string Status, DateTime CreatedAt, IReadOnlyList<InvoiceDetailDto> Details, IReadOnlyList<PaymentDto> Payments,
    DateOnly? BillingPeriodStart = null, DateOnly? BillingPeriodEnd = null);
public record CreateExtraChargeRequest([Required] int FeeTypeId, [Range(1, 365)] int Quantity,
    [StringLength(255)] string? Notes, DateOnly? DueDate);
public record ExtraChargeInvoiceDto(int InvoiceId, string InvoiceNumber, string InvoiceType,
    decimal TotalAmount, DateOnly DueDate, string Status, int ContractId);
public record DepositRefundDto(int ContractId, decimal RefundedAmount, decimal RemainingRefund,
    string PaymentMethod, string? TransactionCode, DateTime RefundedAt);
public record UpdateSupportRequest([Required] string Status, [Required, StringLength(4000)] string ActionMessage);
public record UpdateSupportChecklistItemRequest(bool IsCompleted, [StringLength(1000)] string? Notes);
public record SupportChecklistItemDto(int ChecklistItemId, int SortOrder, string Description, bool IsCompleted,
    DateTime? CompletedAt, string? CompletedByStaff, string? Notes);
