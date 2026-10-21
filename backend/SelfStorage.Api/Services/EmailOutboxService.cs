using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Services;

public sealed class EmailOutboxService(SelfStorageDbContext db, TimeProvider clock)
{
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

        await EnqueueAsync($"invoice-issued:{invoiceId}", customer.Email, customer.FullName, content, ct);
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
        await EnqueueAsync($"payment-received:{paymentId}", invoice.CustomerEmail,
            invoice.CustomerName, content, ct);
    }

    private async Task EnqueueAsync(
        string eventKey, string email, string fullName, EmailContent content, CancellationToken ct)
    {
        if (db.EmailOutboxMessages.Local.Any(m => m.EventKey == eventKey)
            || await db.EmailOutboxMessages.AnyAsync(m => m.EventKey == eventKey, ct))
            return;

        var now = clock.GetLocalNow().DateTime;
        db.EmailOutboxMessages.Add(new EmailOutboxMessage
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
        });
    }
}
