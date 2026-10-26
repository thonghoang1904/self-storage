using System.ComponentModel.DataAnnotations;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Dtos;

// ---- Auth ----

public record RegisterRequest(
    [Required(ErrorMessage = "Vui lòng nhập tên đăng nhập")]
    [StringLength(50, MinimumLength = 3, ErrorMessage = "Tên đăng nhập dài từ 3 đến 50 ký tự")]
    [RegularExpression(@"^[A-Za-z0-9._\-]+$", ErrorMessage = "Tên đăng nhập chỉ gồm chữ không dấu, số và . _ -")]
    string Username,
    [Required(ErrorMessage = "Vui lòng nhập mật khẩu")]
    [StringLength(100, MinimumLength = 8, ErrorMessage = "Mật khẩu dài từ 8 đến 100 ký tự")]
    string Password,
    [Required(ErrorMessage = "Vui lòng nhập họ tên")]
    [StringLength(100, ErrorMessage = "Họ tên tối đa 100 ký tự")]
    string FullName,
    [Required(ErrorMessage = "Vui lòng nhập email")]
    [StrictEmail]
    string Email,
    [Required(ErrorMessage = "Vui lòng nhập số điện thoại")]
    [VnPhone]
    string PhoneNumber,
    // Needed so staff can check the customer's ID card at the gate.
    [Required(ErrorMessage = "Vui lòng nhập số CCCD")]
    [CitizenId]
    string CitizenId);

/// <summary>A CCCD already on file cannot be changed here (staff must re-verify the card); an empty one can be filled in.</summary>
public record UpdateProfileRequest(
    [Required(ErrorMessage = "Vui lòng nhập họ tên")]
    [StringLength(100, ErrorMessage = "Họ tên tối đa 100 ký tự")]
    string FullName,
    [Required(ErrorMessage = "Vui lòng nhập email")]
    [StrictEmail]
    string Email,
    [Required(ErrorMessage = "Vui lòng nhập số điện thoại")]
    [VnPhone]
    string PhoneNumber,
    [CitizenId] string? CitizenId,
    [StringLength(255, ErrorMessage = "Địa chỉ tối đa 255 ký tự")] string? Address);

public record ProfileDto(int UserId, string Username, string FullName, string Role, string Email,
    string PhoneNumber, string? CitizenId, string? Address);

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
    [Required, StrictEmail] string Email,
    [Required, VnPhone] string PhoneNumber,
    [CitizenId] string? CitizenId,
    [Required] int RoleId,
    [MinLength(1)] IReadOnlyList<int>? FacilityIds = null);
public record SetUserFacilitiesRequest([Required] IReadOnlyList<int> FacilityIds);
public record AdminResetPasswordRequest([Required, StringLength(100, MinimumLength = 8)] string NewPassword);
public record ChangeUserRoleRequest([Required] int RoleId);
public record ChangeUserStatusRequest([Required] string Status);
public record RoleDto(int RoleId, string RoleName, string? Description);
public record ActivityLogDto(long LogId, string Action, string? Details, string? IpAddress, DateTime CreatedAt);

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
    int MaxOverdueDaysBeforeLock, bool IsActive, DateOnly EffectiveDate, int DepositPaymentHours);
public record SaveRentalPolicyRequest(
    [Required, StringLength(100)] string PolicyName,
    int? FacilityId,
    [Range(typeof(decimal), "0.01", "100")] decimal DepositPercent,
    [Range(0, 8760)] int CancellationGraceHours,
    [Range(typeof(decimal), "0", "100")] decimal CancellationFeePercent,
    [Range(0, 365)] int RenewalNoticeDays,
    [Range(0, 365)] int MaxOverdueDaysBeforeLock,
    bool IsActive,
    [Required] DateOnly EffectiveDate,
    // Deposit payment window for new reservations (separate from the free-cancellation window).
    [Range(1, 720)] int DepositPaymentHours = 24);
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
    [Required(ErrorMessage = "Vui lòng nhập họ tên")]
    [StringLength(100, ErrorMessage = "Họ tên tối đa 100 ký tự")]
    string FullName,
    [Required(ErrorMessage = "Vui lòng nhập số điện thoại")]
    [VnPhone]
    string PhoneNumber,
    [Required(ErrorMessage = "Vui lòng nhập số CCCD")]
    [CitizenId]
    string CitizenId,
    [StringLength(50, ErrorMessage = "Quan hệ tối đa 50 ký tự")] string? Relationship);

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
    // Renewal can be requested (and paid) any time while the contract is active; this is the reminder date.
    DateTime RenewalAvailableFrom,
    string CustomerName,
    DateTime ExpiresAt,
    bool HasPendingRenewal);

/// <summary>Contracts staff should follow up: expiring soon, expired or overdue, not returned yet.</summary>
public record DueContractDto(int ContractId, string ContractNumber, string CustomerName, string CustomerPhone,
    string UnitCode, DateOnly EndDate, DateTime ExpiresAt, string Status, string UnitStatus, bool HasPendingRenewal);

public record RequestRenewalRequest([Range(1, 60)] int ExtensionMonths);
public record RenewalDto(int RenewalId, int ContractId, DateOnly OldEndDate, DateOnly NewEndDate,
    int ExtensionMonths, decimal RenewalFee, string Status, DateTime RequestedAt, int? InvoiceId);
public record ReturnUnitRequest([Required, StringLength(1000)] string UnitConditionNotes,
    bool AllItemsRemoved,
    [StringLength(500)] string? StaffNotes);
// UnpaidInvoicesOffset: unpaid rent/extra charges settled from the deposit; UnpaidInvoicesRemaining: still owed
// (the deposit is held back until they are paid); CancelledFutureInvoices: rent invoices for periods after the return.
// PrepaidRentCredit: rent/renewal paid ahead for periods starting on or after the return date, paid back with the
// deposit (DepositRefundDue already includes it).
public record ReturnUnitDto(int ContractId, string Status, string UnitStatus, decimal DepositPaid,
    decimal LateFeesDeducted, decimal DepositRefundDue, decimal LateFeesStillOwed, DateTime ReturnedAt,
    decimal UnpaidInvoicesOffset = 0, decimal UnpaidInvoicesRemaining = 0, int CancelledFutureInvoices = 0,
    decimal PrepaidRentCredit = 0);
public record PrepayRentRequest([Range(1, 24)] int Months);
public record PrepaidRentInvoiceDto(int InvoiceId, string InvoiceNumber, DateOnly PeriodStart, DateOnly PeriodEnd,
    decimal Amount);
public record PrepayRentDto(int ContractId, IReadOnlyList<PrepaidRentInvoiceDto> Invoices, decimal TotalAmount);
public record OverdueSummaryDto(int OverdueId, int ContractId, string ContractNumber, string CustomerName,
    string UnitCode, DateOnly EndDate, string ContractStatus, string UnitStatus, int DaysOverdue,
    decimal AccumulatedLateFee, decimal DepositBalance, decimal OutstandingLateFee, DateTime? LockAppliedAt,
    // Unit already returned; late fees above the deposit are still to be collected (OVERDUE_FINE invoice).
    bool ReturnedWithDebt);
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

public record RecordPaymentRequest(
    [Required] string PaymentMethod,
    [Required, Range(typeof(decimal), "0.01", "9999999999999999")] decimal AmountPaid,
    [StringLength(100)] string? TransactionCode,
    [StringLength(255)] string? PaymentNotes);
public record CheckoutResponse(string Provider, int PaymentId, string TransactionReference,
    decimal Amount, string PaymentUrl);
/// <summary>Staff confirms a deposit or renewal they received; without a body it is cash.</summary>
public record ConfirmPaymentRequest(
    string PaymentMethod = "Cash",
    [StringLength(100)] string? TransactionCode = null,
    [StringLength(255)] string? PaymentNotes = null);
public record RefundDuePaymentRequest(
    [Required] string PaymentMethod,
    [StringLength(100)] string? TransactionCode,
    [StringLength(150)] string? Notes);
public record RefundDuePaymentDto(int PaymentId, int InvoiceId, string InvoiceNumber, string InvoiceType,
    string CustomerName, string PaymentMethod, string? GatewayReference, decimal Amount, DateTime PaymentDate,
    string? Notes);
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
// AssignToStaffId: facility manager hands the request to another staff member of the facility.
public record UpdateSupportRequest([Required] string Status, [Required, StringLength(4000)] string ActionMessage,
    int? AssignToStaffId = null);
public record UpdateSupportChecklistItemRequest(bool IsCompleted, [StringLength(1000)] string? Notes);
public record SupportChecklistItemDto(int ChecklistItemId, int SortOrder, string Description, bool IsCompleted,
    DateTime? CompletedAt, string? CompletedByStaff, string? Notes);
