using System.ComponentModel.DataAnnotations;

namespace SelfStorage.Api.Dtos;

public record PaymentStatusDto(int PaymentId, int InvoiceId, string InvoiceNumber, string PaymentMethod,
    string Status, decimal AmountPaid, DateTime PaymentDate, string? TransactionCode, string InvoiceStatus,
    string? PaymentNotes);

public record CancelInvoiceRequest([Required, StringLength(200)] string Reason);

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
