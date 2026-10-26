using System.Data;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Services;

public enum OnlinePaymentOutcome
{
    /// <summary>The invoice is now paid.</summary>
    Applied,
    /// <summary>The gateway reported a failed payment.</summary>
    Failed,
    /// <summary>The callback repeats one that was already handled.</summary>
    AlreadyProcessed,
    /// <summary>Money was taken but the invoice could no longer accept it; staff must refund it.</summary>
    RefundDue,
}

public sealed class BillingService(SelfStorageDbContext db, AccessService access, TimeProvider clock)
{
    /// <summary>
    /// A VNPay/MoMo checkout not confirmed within this time is marked Failed so the invoice can be paid
    /// another way. VNPay links expire after 15 minutes; a confirmation arriving later is still recorded.
    /// </summary>
    public static readonly TimeSpan PendingOnlinePaymentTimeout = TimeSpan.FromMinutes(20);

    public Invoice CreateInvoice(
        int customerId,
        string invoiceType,
        DateOnly dueDate,
        string description,
        decimal unitPrice,
        int quantity = 1,
        int? contractId = null,
        int? reservationId = null,
        DateOnly? billingPeriodStart = null,
        DateOnly? billingPeriodEnd = null)
    {
        if (unitPrice <= 0 || quantity <= 0)
            throw new InvalidOperationException("Billing invoices must have a positive quantity and price.");

        return new Invoice
        {
            InvoiceNumber = $"INV-{clock.GetLocalNow():yyyyMMddHHmmss}-{RandomNumberGenerator.GetInt32(100000, 1000000)}",
            ContractId = contractId,
            ReservationId = reservationId,
            CustomerId = customerId,
            InvoiceType = invoiceType,
            SubTotal = unitPrice * quantity,
            DiscountAmount = 0,
            DueDate = dueDate,
            BillingPeriodStart = billingPeriodStart,
            BillingPeriodEnd = billingPeriodEnd,
            Status = "Unpaid",
            Details =
            [
                new InvoiceDetail
                {
                    Description = description,
                    Quantity = quantity,
                    UnitPrice = unitPrice,
                },
            ],
        };
    }

    public async Task<Payment> RecordStaffPaymentAsync(
        int invoiceId,
        int staffId,
        RecordPaymentRequest request,
        CancellationToken ct)
    {
        if (request.PaymentMethod is not ("Cash" or "BankTransfer"))
            throw AppException.BadRequest("Nhân viên chỉ được ghi nhận tiền mặt hoặc chuyển khoản đã nhận thực tế");
        var transactionCode = string.IsNullOrWhiteSpace(request.TransactionCode)
            ? null
            : request.TransactionCode.Trim();
        if (request.PaymentMethod == "BankTransfer" && transactionCode is null)
            throw AppException.BadRequest("Chuyển khoản phải có mã giao dịch để đối soát");
        if (request.AmountPaid <= 0)
            throw AppException.BadRequest("Số tiền thanh toán phải lớn hơn 0");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var invoice = await db.Invoices.Include(i => i.Details)
            .FirstOrDefaultAsync(i => i.InvoiceId == invoiceId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn");
        await EnsureStaffOwnsInvoiceAsync(invoice, staffId, ct);

        if (invoice.Status is not ("Unpaid" or "Overdue"))
            throw AppException.Conflict("Hóa đơn không còn ở trạng thái chờ thanh toán");
        if (await db.Payments.AnyAsync(p => p.InvoiceId == invoiceId && p.Status == "Pending", ct))
            throw AppException.Conflict(
                "Hóa đơn đang có giao dịch trực tuyến chưa được xác nhận; khách có thể hủy giao dịch đó hoặc chờ tối đa "
                + $"{PendingOnlinePaymentTimeout.TotalMinutes:0} phút");
        if (request.AmountPaid != invoice.TotalAmount)
            throw AppException.BadRequest($"Số tiền cần thanh toán chính xác là {invoice.TotalAmount:N0}đ");
        if (transactionCode is not null
            && await db.Payments.AnyAsync(p => p.TransactionCode == transactionCode, ct))
            throw AppException.Conflict("Mã giao dịch đã được ghi nhận");

        var now = clock.GetLocalNow().DateTime;
        if (await TryApplyPaidInvoiceAsync(invoice, staffId, now, now, ct) is string problem)
            throw AppException.Conflict(problem);

        invoice.Status = "Paid";
        var payment = new Payment
        {
            InvoiceId = invoiceId,
            ReceivedByStaffId = staffId,
            PaymentMethod = request.PaymentMethod,
            TransactionCode = transactionCode,
            AmountPaid = request.AmountPaid,
            PaymentDate = now,
            Status = "Success",
            PaymentNotes = request.PaymentNotes,
        };
        db.Payments.Add(payment);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return payment;
    }

    /// <summary>
    /// Records the gateway's verified result. A success is never dropped: if the invoice can no longer accept the
    /// money (cancelled, expired, paid another way meanwhile), the payment is kept as RefundDue for staff to refund.
    /// A payment marked Failed locally (timed out or cancelled by the customer) that the gateway later reports as
    /// paid is handled the same way.
    /// </summary>
    public async Task<OnlinePaymentOutcome> CompleteOnlinePaymentAsync(
        string paymentMethod,
        string transactionReference,
        decimal amount,
        bool succeeded,
        string? providerTransactionId,
        CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var payment = await db.Payments.FirstOrDefaultAsync(p =>
            p.PaymentMethod == paymentMethod && p.TransactionCode == transactionReference, ct)
            ?? throw AppException.NotFound("Không tìm thấy giao dịch thanh toán");

        if (payment.Status is not ("Pending" or "Failed") || (payment.Status == "Failed" && !succeeded))
        {
            await transaction.CommitAsync(ct);
            return OnlinePaymentOutcome.AlreadyProcessed;
        }
        if (payment.AmountPaid != amount)
            throw AppException.Conflict("Số tiền từ cổng thanh toán không khớp giao dịch");

        var providerReference = string.IsNullOrWhiteSpace(providerTransactionId) ? "không có" : providerTransactionId;
        if (!succeeded)
        {
            payment.Status = "Failed";
            payment.PaymentNotes = $"Cổng thanh toán báo thất bại (mã giao dịch cổng: {providerReference}).";
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return OnlinePaymentOutcome.Failed;
        }

        var invoice = await db.Invoices.FirstOrDefaultAsync(i => i.InvoiceId == payment.InvoiceId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn của giao dịch");
        var now = clock.GetLocalNow().DateTime;
        // PaymentDate of a pending online payment is when the customer started the checkout.
        var problem = invoice.Status is not ("Unpaid" or "Overdue") || invoice.TotalAmount != amount
            ? "hóa đơn không còn chờ thanh toán hoặc đã đổi số tiền"
            : await TryApplyPaidInvoiceAsync(invoice, null, now, payment.PaymentDate, ct);

        payment.PaymentDate = now;
        if (problem is null)
        {
            invoice.Status = "Paid";
            payment.Status = "Success";
            payment.PaymentNotes = $"Thanh toán trực tuyến đã được xác nhận. Mã giao dịch cổng: {providerReference}";
        }
        else
        {
            payment.Status = "RefundDue";
            payment.PaymentNotes = Truncate(
                $"Đã nhận tiền nhưng không ghi nhận được vào hóa đơn ({problem}); cần hoàn tiền cho khách. Mã giao dịch cổng: {providerReference}",
                255);
            db.ActivityLogs.Add(new ActivityLog
            {
                UserId = invoice.CustomerId,
                Action = "OnlinePaymentRefundDue",
                Details = $"Invoice {invoice.InvoiceNumber}; payment {payment.PaymentId}; {amount:N0}đ; {problem}",
                CreatedAt = now,
            });
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return problem is null ? OnlinePaymentOutcome.Applied : OnlinePaymentOutcome.RefundDue;
    }

    /// <summary>Staff pays back an online payment kept as RefundDue; it becomes Reversed (no revenue either way).</summary>
    public async Task<Payment> RefundDuePaymentAsync(
        int paymentId, int staffId, RefundDuePaymentRequest request, CancellationToken ct)
    {
        if (request.PaymentMethod is not ("Cash" or "BankTransfer"))
            throw AppException.BadRequest("Phương thức hoàn tiền chỉ hỗ trợ tiền mặt hoặc chuyển khoản");
        var transactionCode = string.IsNullOrWhiteSpace(request.TransactionCode) ? null : request.TransactionCode.Trim();
        if (request.PaymentMethod == "BankTransfer" && transactionCode is null)
            throw AppException.BadRequest("Hoàn tiền qua chuyển khoản phải có mã giao dịch");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var payment = await db.Payments.FirstOrDefaultAsync(p => p.PaymentId == paymentId, ct)
            ?? throw AppException.NotFound("Không tìm thấy giao dịch");
        var invoice = await db.Invoices.FirstAsync(i => i.InvoiceId == payment.InvoiceId, ct);
        await EnsureStaffOwnsInvoiceAsync(invoice, staffId, ct);
        if (payment.Status != "RefundDue")
            throw AppException.Conflict("Giao dịch này không ở trạng thái chờ hoàn tiền");

        var now = clock.GetLocalNow().DateTime;
        payment.Status = "Reversed";
        payment.ReceivedByStaffId = staffId;
        payment.PaymentNotes = Truncate(
            $"Đã hoàn {payment.AmountPaid:N0}đ cho khách ({request.PaymentMethod}"
            + (transactionCode is null ? "" : $", mã {transactionCode}") + $") lúc {now:dd/MM/yyyy HH:mm}."
            + (string.IsNullOrWhiteSpace(request.Notes) ? "" : $" {request.Notes.Trim()}"), 255);
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = staffId,
            Action = "OnlinePaymentRefunded",
            Details = $"Payment {payment.PaymentId} of invoice {invoice.InvoiceNumber}; {payment.AmountPaid:N0}đ; "
                + $"{request.PaymentMethod} {transactionCode}".Trim(),
            CreatedAt = now,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return payment;
    }

    /// <summary>
    /// What a paid invoice unlocks; shared by staff payments and VNPay/MoMo callbacks. Returns why the invoice
    /// can no longer be paid, or null once applied. Nothing is changed when a reason is returned.
    /// DEPOSIT confirms the reservation (the deadline is checked against when the customer started paying).
    /// RENEWAL extends the contract (paid early at any time while it is active).
    /// OVERDUE_FINE settles the late fees left after the deposit was used up at return.
    /// </summary>
    private async Task<string?> TryApplyPaidInvoiceAsync(
        Invoice invoice, int? staffId, DateTime now, DateTime paymentStartedAt, CancellationToken ct)
    {
        if (invoice.InvoiceType == "DEPOSIT")
        {
            if (invoice.ReservationId is not int reservationId)
                return "Hóa đơn cọc không liên kết với đơn đặt kho";
            var reservation = await db.Reservations.FirstOrDefaultAsync(r => r.ReservationId == reservationId, ct);
            if (reservation is null
                || reservation.Status != ReservationStatus.PendingDeposit
                || reservation.DepositDeadline <= paymentStartedAt
                || invoice.TotalAmount != reservation.DepositAmount)
                return "Đơn đặt kho đã hết hạn, đã hủy hoặc số tiền cọc không còn hợp lệ";
            reservation.Status = ReservationStatus.Confirmed;
        }
        else if (invoice.InvoiceType == "RENEWAL")
        {
            var renewal = await db.ContractRenewals.FirstOrDefaultAsync(r => r.InvoiceId == invoice.InvoiceId, ct);
            if (renewal is null) return "Hóa đơn không liên kết với yêu cầu gia hạn";
            var contract = await db.Contracts.Include(c => c.Unit)
                .FirstOrDefaultAsync(c => c.ContractId == renewal.ContractId, ct);
            // Paying early is allowed; only a contract that got locked for overdue (or was returned) can no longer renew.
            if (contract is null || renewal.Status != "Pending" || contract.Status != ContractStatus.Active
                || contract.EndDate != renewal.OldEndDate
                || invoice.TotalAmount != renewal.RenewalFee)
                return "Yêu cầu gia hạn đã hết hạn hoặc không còn hợp lệ";

            renewal.Status = "Paid";
            renewal.ApprovedByStaffId = staffId;
            renewal.ProcessedAt = now;
            contract.EndDate = renewal.NewEndDate;
            // Only lift an overdue lock; a unit under maintenance stays under maintenance.
            if (contract.Unit.Status == UnitStatus.OverdueLocked) contract.Unit.Status = UnitStatus.Rented;
        }
        else if (invoice.InvoiceType == "OVERDUE_FINE" && invoice.ContractId is int contractId)
        {
            var overdue = await db.OverdueRecords
                .Where(o => o.ContractId == contractId && o.ResolvedDate == null)
                .OrderByDescending(o => o.OverdueId)
                .FirstOrDefaultAsync(ct);
            var returned = await db.Contracts.AnyAsync(c => c.ContractId == contractId
                && c.Status == ContractStatus.Terminated, ct);
            if (overdue is not null && returned)
            {
                overdue.ActionTaken = "Resolved";
                overdue.ResolvedDate = now;
                overdue.HandledByStaffId = staffId ?? overdue.HandledByStaffId;
                overdue.Notes = $"{overdue.Notes} Đã thu đủ phí quá hạn còn lại ({invoice.TotalAmount:N0}đ, hóa đơn {invoice.InvoiceNumber}).".Trim();
            }
        }
        return null;
    }

    public async Task EnsureStaffOwnsInvoiceAsync(Invoice invoice, int staffId, CancellationToken ct)
    {
        int? facilityId = null;
        if (invoice.ContractId is int contractId)
            facilityId = await db.Contracts.Where(c => c.ContractId == contractId)
                .Select(c => (int?)c.Unit.FacilityId).SingleOrDefaultAsync(ct);
        else if (invoice.ReservationId is int reservationId)
            facilityId = await db.Reservations.Where(r => r.ReservationId == reservationId)
                .Select(r => (int?)r.FacilityId).SingleOrDefaultAsync(ct);

        if (facilityId is null)
            throw AppException.Conflict("Hóa đơn chưa được gắn với cơ sở để nhân viên xử lý");
        await access.EnsureAssignedAsync(staffId, facilityId.Value, ct);
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];
}
