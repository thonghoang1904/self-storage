using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Services;

public sealed class EmailOutboxService(SelfStorageDbContext db, TimeProvider clock)
{
    public const string InvoiceIssuedPrefix = "invoice-issued:";
    public const string PaymentReceivedPrefix = "payment-received:";
    public const string DepositRefundedPrefix = "deposit-refunded:";

    public static string FormatDepositRefundReceiptNumber(int paymentId) => $"HC-{paymentId:D6}";

    public async Task QueueInvoiceIssuedAsync(int invoiceId, CancellationToken ct)
    {
        var invoice = await db.Invoices.FirstOrDefaultAsync(i => i.InvoiceId == invoiceId, ct)
            ?? throw new InvalidOperationException($"Invoice {invoiceId} must exist before its email is queued.");
        var customer = await db.Users.Where(u => u.UserId == invoice.CustomerId)
            .Select(u => new { u.Email, u.FullName }).SingleAsync(ct);
        var contractNumber = invoice.ContractId is int contractId
            ? await db.Contracts.Where(c => c.ContractId == contractId)
                .Select(c => c.ContractNumber).SingleOrDefaultAsync(ct)
            : null;
        var reservationCode = invoice.ReservationId is int reservationId
            ? await db.Reservations.Where(r => r.ReservationId == reservationId)
                .Select(r => r.ReservationCode).SingleOrDefaultAsync(ct)
            : null;
        var details = await db.InvoiceDetails.Where(d => d.InvoiceId == invoiceId)
            .OrderBy(d => d.DetailId)
            .Select(d => d.Description)
            .ToListAsync(ct);
        var content = EmailTemplate.InvoiceIssued(customer.FullName, invoice.InvoiceNumber,
            invoice.InvoiceType, invoice.TotalAmount, invoice.DueDate, invoice.Status,
            invoice.BillingPeriodStart, invoice.BillingPeriodEnd, contractNumber, reservationCode, details);

        await EnqueueAsync($"{InvoiceIssuedPrefix}{invoiceId}", customer.Email, customer.FullName, content, ct);
    }

    public async Task QueuePaymentReceivedAsync(int paymentId, CancellationToken ct)
    {
        var payment = await db.Payments.Where(p => p.PaymentId == paymentId)
            .Select(p => new
            {
                p.InvoiceId,
                p.AmountPaid,
                p.PaymentDate,
                p.PaymentMethod,
                p.TransactionCode,
                p.Status,
            })
            .SingleAsync(ct);
        if (payment.Status != "Success")
            throw new InvalidOperationException($"Payment {paymentId} must be successful before its receipt email is queued.");

        var invoice = await db.Invoices.Where(i => i.InvoiceId == payment.InvoiceId)
            .Select(i => new
            {
                i.InvoiceNumber,
                i.InvoiceType,
                CustomerEmail = i.Customer.Email,
                CustomerName = i.Customer.FullName,
            })
            .SingleAsync(ct);
        var content = EmailTemplate.PaymentReceived(invoice.CustomerName, invoice.InvoiceNumber,
            invoice.InvoiceType, payment.AmountPaid, payment.PaymentDate,
            payment.PaymentMethod, payment.TransactionCode);
        await EnqueueAsync($"{PaymentReceivedPrefix}{paymentId}", invoice.CustomerEmail,
            invoice.CustomerName, content, ct);
    }

    public async Task<EmailOutboxMessage> QueueDepositRefundReceiptAsync(
        int paymentId, int? contractId, int? reservationId, bool manualResend, CancellationToken ct)
    {
        var payment = await db.Payments.Where(p => p.PaymentId == paymentId)
            .Select(p => new
            {
                p.PaymentId,
                p.InvoiceId,
                p.ReceivedByStaffId,
                p.AmountPaid,
                p.PaymentDate,
                p.PaymentMethod,
                p.TransactionCode,
                p.PaymentNotes,
                p.Status,
            })
            .SingleAsync(ct);
        if (payment.Status != "Refunded")
            throw new InvalidOperationException($"Payment {paymentId} must be Refunded before its deposit refund email is queued.");

        var invoice = await db.Invoices.Where(i => i.InvoiceId == payment.InvoiceId)
            .Select(i => new
            {
                i.InvoiceId,
                i.InvoiceNumber,
                i.ContractId,
                i.ReservationId,
                i.TotalAmount,
                CustomerEmail = i.Customer.Email,
                CustomerName = i.Customer.FullName,
            })
            .SingleAsync(ct);

        var staffName = payment.ReceivedByStaffId is int staffId
            ? await db.Users.Where(u => u.UserId == staffId).Select(u => u.FullName).SingleOrDefaultAsync(ct)
            : null;

        var effectiveContractId = contractId ?? invoice.ContractId;
        if (effectiveContractId is null && invoice.ReservationId is int invRid)
        {
            effectiveContractId = await db.Contracts
                .Where(c => c.ReservationId == invRid)
                .Select(c => (int?)c.ContractId)
                .FirstOrDefaultAsync(ct);
        }
        var effectiveReservationId = reservationId ?? invoice.ReservationId;

        var totalRefunded = await db.Payments
            .Where(p => p.InvoiceId == invoice.InvoiceId && p.Status == "Refunded")
            .SumAsync(p => (decimal?)p.AmountPaid, ct) ?? 0m;

        string refundReasonLabel;
        string? contractNumber = null;
        string? reservationCode = null;
        string? facilityName = null;
        string? unitCode = null;
        decimal depositPaid;
        decimal deductedAmount;
        decimal settledInvoicesAmount;
        decimal refundableTotal;
        decimal remainingRefund;

        if (effectiveContractId is int cid)
        {
            var contract = await db.Contracts.Where(c => c.ContractId == cid)
                .Select(c => new
                {
                    c.ContractNumber,
                    c.DepositPaid,
                    c.ReservationId,
                    FacilityName = c.Unit.Facility.FacilityName,
                    UnitCode = c.Unit.UnitCode,
                })
                .SingleAsync(ct);
            effectiveReservationId ??= contract.ReservationId;
            if (effectiveReservationId is int crid)
            {
                reservationCode = await db.Reservations.Where(r => r.ReservationId == crid)
                    .Select(r => r.ReservationCode).SingleOrDefaultAsync(ct);
            }

            var latestOverdueFee = await db.OverdueRecords.Where(o => o.ContractId == cid)
                .OrderByDescending(o => o.OverdueId)
                .Select(o => (decimal?)o.AccumulatedLateFee)
                .FirstOrDefaultAsync(ct) ?? 0m;
            var earlyReturnFees = await db.EarlyReturnRequests
                .Where(r => r.ContractId == cid && r.Status == EarlyReturnStatus.Completed)
                .SumAsync(r => (decimal?)r.EarlyReturnFee, ct) ?? 0m;
            depositPaid = contract.DepositPaid;
            deductedAmount = Math.Min(depositPaid, latestOverdueFee + earlyReturnFees);
            settledInvoicesAmount = await db.Payments
                .Where(p => p.PaymentMethod == "DepositOffset" && p.Status == "Success"
                    && db.Invoices.Any(i => i.InvoiceId == p.InvoiceId && i.ContractId == cid))
                .SumAsync(p => (decimal?)p.AmountPaid, ct) ?? 0m;
            var stillOwed = await db.Invoices
                .Where(i => i.ContractId == cid && (i.Status == "Unpaid" || i.Status == "Overdue"))
                .SumAsync(i => (decimal?)i.TotalAmount, ct) ?? 0m;

            refundableTotal = Math.Max(0m, depositPaid - deductedAmount - settledInvoicesAmount - stillOwed);
            remainingRefund = Math.Max(0m, refundableTotal - totalRefunded);
            refundReasonLabel = "Hoàn tiền đặt cọc khi trả kho";
            contractNumber = contract.ContractNumber;
            facilityName = contract.FacilityName;
            unitCode = contract.UnitCode;
        }
        else if (effectiveReservationId is int rid)
        {
            var reservation = await db.Reservations.Where(r => r.ReservationId == rid)
                .Select(r => new
                {
                    r.ReservationCode,
                    r.DepositAmount,
                    FacilityName = r.Facility.FacilityName,
                    AssignedUnitCode = r.AssignedUnit != null ? r.AssignedUnit.UnitCode : null,
                })
                .SingleAsync(ct);
            var cancellation = await db.ReservationCancellationRequests
                .Where(r => r.ReservationId == rid && r.Status == "Approved")
                .OrderByDescending(r => r.ResolvedAt)
                .Select(r => new { r.ApprovedRefundAmount })
                .FirstOrDefaultAsync(ct);

            depositPaid = invoice.TotalAmount > 0 ? invoice.TotalAmount : reservation.DepositAmount;
            refundableTotal = cancellation?.ApprovedRefundAmount ?? depositPaid;
            deductedAmount = Math.Max(0m, depositPaid - refundableTotal);
            settledInvoicesAmount = 0m;
            remainingRefund = Math.Max(0m, refundableTotal - totalRefunded);
            refundReasonLabel = "Hoàn tiền đặt cọc khi hủy đơn đặt kho";
            reservationCode = reservation.ReservationCode;
            facilityName = reservation.FacilityName;
            unitCode = reservation.AssignedUnitCode;
        }
        else
        {
            depositPaid = invoice.TotalAmount;
            refundableTotal = depositPaid;
            deductedAmount = 0m;
            settledInvoicesAmount = 0m;
            remainingRefund = Math.Max(0m, refundableTotal - totalRefunded);
            refundReasonLabel = "Hoàn tiền đặt cọc";
        }

        var receiptNumber = FormatDepositRefundReceiptNumber(paymentId);
        var content = EmailTemplate.DepositRefundReceipt(
            invoice.CustomerName,
            receiptNumber,
            invoice.InvoiceNumber,
            refundReasonLabel,
            contractNumber,
            reservationCode,
            facilityName,
            unitCode,
            depositPaid,
            deductedAmount,
            settledInvoicesAmount,
            refundableTotal,
            payment.AmountPaid,
            totalRefunded,
            remainingRefund,
            payment.PaymentDate,
            payment.PaymentMethod,
            payment.TransactionCode,
            staffName,
            payment.PaymentNotes);

        var eventKey = manualResend
            ? $"{DepositRefundedPrefix}{paymentId}:manual:{clock.GetLocalNow().DateTime:yyyyMMddHHmmss}-{Guid.NewGuid().ToString("N")[..6]}"
            : $"{DepositRefundedPrefix}{paymentId}";
        return await EnqueueAsync(eventKey, invoice.CustomerEmail, invoice.CustomerName, content, ct);
    }

    private async Task<EmailOutboxMessage> EnqueueAsync(
        string eventKey, string email, string fullName, EmailContent content, CancellationToken ct)
    {
        var existing = db.EmailOutboxMessages.Local.FirstOrDefault(m => m.EventKey == eventKey)
            ?? await db.EmailOutboxMessages.FirstOrDefaultAsync(m => m.EventKey == eventKey, ct);
        if (existing is not null)
            return existing;

        var now = clock.GetLocalNow().DateTime;
        var message = new EmailOutboxMessage
        {
            EventKey = eventKey,
            RecipientEmail = email,
            RecipientName = fullName,
            Subject = content.Subject,
            HtmlBody = content.HtmlBody,
            TextBody = content.TextBody,
            Status = "Pending",
            CreatedAt = now,
            NextAttemptAt = now,
        };
        db.EmailOutboxMessages.Add(message);
        return message;
    }
}
