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
    PaymentGatewayService paymentGateways,
    IWebHostEnvironment environment) : ControllerBase
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

    /// <summary>
    /// Starts or resumes a VNPay/MoMo checkout. MoMo returns its QR URL, app deep links,
    /// and a payment URL; invoice status is confirmed only by the verified provider IPN.
    /// </summary>
    [HttpPost("{id:int}/checkout/{provider}")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<CheckoutResponse> StartCheckout(int id, string provider, CancellationToken ct) =>
        paymentGateways.StartCheckoutAsync(id, User.GetUserId(), provider,
            HttpContext.Connection.RemoteIpAddress?.ToString(), ct);

    /// <summary>
    /// Development only (PaymentGateways:SandboxEnabled): marks the invoice paid as if the gateway had confirmed it,
    /// so a deposit moves the reservation to Confirmed without staff. Returns the updated invoice.
    /// </summary>
    [HttpPost("{id:int}/checkout/{provider}/sandbox-complete")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<InvoiceDto> CompleteSandboxCheckout(int id, string provider, CancellationToken ct)
    {
        if (!environment.IsDevelopment())
            throw AppException.NotFound("Không tìm thấy chức năng");
        await paymentGateways.CompleteSandboxPaymentAsync(id, User.GetUserId(), provider, ct);
        return await Detail(id, ct);
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
