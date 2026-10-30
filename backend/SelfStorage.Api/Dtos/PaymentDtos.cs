using System.ComponentModel.DataAnnotations;

namespace SelfStorage.Api.Dtos;

public record PaymentStatusDto(int PaymentId, int InvoiceId, string InvoiceNumber, string PaymentMethod,
    string Status, decimal AmountPaid, DateTime PaymentDate, string? TransactionCode, string InvoiceStatus,
    string? PaymentNotes);

public record CancelInvoiceRequest([Required, StringLength(200)] string Reason);

/// <summary>Staff confirms a deposit or renewal they received; without a body it is cash.</summary>
public record ConfirmPaymentRequest(
    string PaymentMethod = "Cash",
    [StringLength(100)] string? TransactionCode = null,
    [StringLength(255)] string? PaymentNotes = null);

public record RefundDuePaymentRequest(
    [Required] string PaymentMethod,
    [StringLength(100)] string? TransactionCode,
    [StringLength(150)] string? Notes);

/// <summary>An online payment received for an invoice that could no longer accept it; staff must refund it.</summary>
public record RefundDuePaymentDto(int PaymentId, int InvoiceId, string InvoiceNumber, string InvoiceType,
    string CustomerName, string PaymentMethod, string? GatewayReference, decimal Amount, DateTime PaymentDate,
    string? Notes);

public record AdminPaymentDto(int PaymentId, int InvoiceId, string InvoiceNumber, int CustomerId,
    string CustomerName, string PaymentMethod, string Status, decimal AmountPaid, DateTime PaymentDate,
    string? TransactionCode);

public record AdminActivityLogDto(long LogId, int? UserId, string? Username, string Action, string? Details,
    string? IpAddress, DateTime CreatedAt);

public record SystemDashboardDto(
    DateTime GeneratedAt,
    int TotalUsers,
    int ActiveUsers,
    int Facilities,
    int TotalUnits,
    int AvailableUnits,
    int RentedUnits,
    int ActiveContracts,
    int OverdueContracts,
    int OpenSupportRequests,
    int PendingPayments,
    int PendingEmails,
    int FailedEmails,
    decimal RevenueThisMonth);
