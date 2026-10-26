using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/invoices")]
[Authorize]
public class InvoicesController(
    SelfStorageDbContext db,
    BillingService billing,
    PaymentGatewayService paymentGateways) : ControllerBase
{
    [HttpGet("my")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<List<InvoiceDto>> Mine(CancellationToken ct)
    {
        var invoices = await db.Invoices
            .Include(i => i.Details)
            .Include(i => i.Payments)
            .Where(i => i.CustomerId == User.GetUserId())
            .OrderByDescending(i => i.CreatedAt)
            .Take(100)
            .ToListAsync(ct);
        return await MapAsync(invoices, ct);
    }

    [HttpGet("{id:int}")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<InvoiceDto> Detail(int id, CancellationToken ct)
    {
        var invoice = await db.Invoices
            .Include(i => i.Details)
            .Include(i => i.Payments)
            .FirstOrDefaultAsync(i => i.InvoiceId == id && i.CustomerId == User.GetUserId(), ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn");
        return (await MapAsync([invoice], ct))[0];
    }

    [HttpGet("facilities/{facilityId:int}")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<InvoiceDto>> ForFacility(int facilityId, CancellationToken ct)
    {
        await EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        var invoices = await db.Invoices
            .Include(i => i.Details)
            .Include(i => i.Payments)
            .Where(i =>
                (i.ContractId != null && db.Contracts.Any(c => c.ContractId == i.ContractId
                    && c.Unit.FacilityId == facilityId))
                || (i.ReservationId != null && db.Reservations.Any(r => r.ReservationId == i.ReservationId
                    && r.FacilityId == facilityId)))
            .OrderByDescending(i => i.CreatedAt)
            .Take(200)
            .ToListAsync(ct);
        return await MapAsync(invoices, ct);
    }

    /// <summary>Staff confirms a full cash or bank-transfer amount that has actually been received.</summary>
    [HttpPost("{id:int}/payments")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<PaymentDto> RecordPayment(int id, RecordPaymentRequest req, CancellationToken ct)
    {
        var staffId = User.GetUserId();
        var invoice = await db.Invoices.FirstOrDefaultAsync(i => i.InvoiceId == id, ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn");
        await billing.EnsureStaffOwnsInvoiceAsync(invoice, staffId, ct);
        var payment = await billing.RecordStaffPaymentAsync(id, staffId, req, ct);
        var staffName = await db.Users.Where(u => u.UserId == staffId).Select(u => u.FullName).SingleAsync(ct);
        return new PaymentDto(payment.PaymentId, payment.PaymentMethod, payment.TransactionCode,
            payment.AmountPaid, payment.PaymentDate, payment.Status, payment.PaymentNotes, staffName);
    }

    /// <summary>Starts a VNPay or MoMo checkout for an unpaid customer invoice.</summary>
    [HttpPost("{id:int}/checkout/{provider}")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<CheckoutResponse> StartCheckout(int id, string provider, CancellationToken ct) =>
        paymentGateways.StartCheckoutAsync(id, User.GetUserId(), provider,
            HttpContext.Connection.RemoteIpAddress?.ToString(), ct);

    /// <summary>The customer abandons an unfinished VNPay/MoMo checkout so the invoice can be paid again.</summary>
    [HttpPost("{id:int}/checkout/cancel")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<IActionResult> CancelCheckout(int id, CancellationToken ct)
    {
        await paymentGateways.CancelPendingCheckoutAsync(id, User.GetUserId(), ct);
        return NoContent();
    }

    /// <summary>Online payments received for invoices that could no longer accept them; staff must refund these.</summary>
    [HttpGet("facilities/{facilityId:int}/refund-due")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<RefundDuePaymentDto>> RefundDue(int facilityId, CancellationToken ct)
    {
        await EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        return await (from payment in db.Payments
                      join invoice in db.Invoices on payment.InvoiceId equals invoice.InvoiceId
                      join customer in db.Users on invoice.CustomerId equals customer.UserId
                      where payment.Status == "RefundDue"
                          && ((invoice.ContractId != null && db.Contracts.Any(c => c.ContractId == invoice.ContractId
                                  && c.Unit.FacilityId == facilityId))
                              || (invoice.ReservationId != null && db.Reservations.Any(r =>
                                  r.ReservationId == invoice.ReservationId && r.FacilityId == facilityId)))
                      orderby payment.PaymentDate
                      select new RefundDuePaymentDto(payment.PaymentId, invoice.InvoiceId, invoice.InvoiceNumber,
                          invoice.InvoiceType, customer.FullName, payment.PaymentMethod, payment.TransactionCode,
                          payment.AmountPaid, payment.PaymentDate, payment.PaymentNotes))
            .ToListAsync(ct);
    }

    /// <summary>Staff has paid back a RefundDue online payment (cash or bank transfer).</summary>
    [HttpPost("payments/{paymentId:int}/refund")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<PaymentDto> RefundPayment(int paymentId, RefundDuePaymentRequest req, CancellationToken ct)
    {
        var staffId = User.GetUserId();
        var payment = await billing.RefundDuePaymentAsync(paymentId, staffId, req, ct);
        var staffName = await db.Users.Where(u => u.UserId == staffId).Select(u => u.FullName).SingleAsync(ct);
        return new PaymentDto(payment.PaymentId, payment.PaymentMethod, payment.TransactionCode,
            payment.AmountPaid, payment.PaymentDate, payment.Status, payment.PaymentNotes, staffName);
    }

    private async Task EnsureAssignedAsync(int staffId, int facilityId, CancellationToken ct)
    {
        if (!await db.FacilityStaffAssignments.AnyAsync(a => a.StaffId == staffId
            && a.FacilityId == facilityId && a.Status == "Active", ct))
            throw AppException.Forbidden("Bạn không được phân công tại cơ sở này");
    }

    private async Task<List<InvoiceDto>> MapAsync(IReadOnlyCollection<Invoice> invoices, CancellationToken ct)
    {
        var staffIds = invoices.SelectMany(i => i.Payments)
            .Where(p => p.ReceivedByStaffId is not null)
            .Select(p => p.ReceivedByStaffId!.Value)
            .Distinct()
            .ToArray();
        var staffNames = await db.Users.Where(u => staffIds.Contains(u.UserId))
            .ToDictionaryAsync(u => u.UserId, u => u.FullName, ct);

        return invoices.Select(i => new InvoiceDto(
            i.InvoiceId,
            i.InvoiceNumber,
            i.ContractId,
            i.ReservationId,
            i.InvoiceType,
            i.SubTotal,
            i.DiscountAmount,
            i.TotalAmount,
            i.DueDate,
            i.Status,
            i.CreatedAt,
            i.Details.OrderBy(d => d.DetailId)
                .Select(d => new InvoiceDetailDto(d.DetailId, d.Description, d.Quantity, d.UnitPrice, d.LineTotal))
                .ToList(),
            i.Payments.OrderBy(p => p.PaymentDate)
                .Select(p => new PaymentDto(p.PaymentId, p.PaymentMethod, p.TransactionCode, p.AmountPaid,
                    p.PaymentDate, p.Status, p.PaymentNotes,
                    p.ReceivedByStaffId is int receivedBy && staffNames.TryGetValue(receivedBy, out var name) ? name : null))
                .ToList(),
            i.BillingPeriodStart,
            i.BillingPeriodEnd))
            .ToList();
    }
}
