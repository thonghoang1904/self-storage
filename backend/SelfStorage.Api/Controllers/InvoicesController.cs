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
    TimeProvider clock,
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

    /// <summary>Printable HTML invoice/receipt (use the browser's "Save as PDF").</summary>
    [HttpGet("{id:int}/receipt")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<ContentResult> Receipt(int id, CancellationToken ct)
    {
        var invoice = await db.Invoices
            .Include(i => i.Details)
            .Include(i => i.Payments)
            .Include(i => i.Customer)
            .FirstOrDefaultAsync(i => i.InvoiceId == id && i.CustomerId == User.GetUserId(), ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn");

        static string H(string? value) => System.Net.WebUtility.HtmlEncode(value ?? "");
        static string Money(decimal value) => $"{value:N0} đ";
        var rows = string.Concat(invoice.Details.OrderBy(d => d.DetailId).Select(d =>
            $"<tr><td>{H(d.Description)}</td><td class=\"n\">{d.Quantity}</td><td class=\"n\">{Money(d.UnitPrice)}</td><td class=\"n\">{Money(d.LineTotal)}</td></tr>"));
        var paid = string.Concat(invoice.Payments.Where(p => p.Status == "Success").OrderBy(p => p.PaymentDate).Select(p =>
            $"<tr><td>{p.PaymentDate:dd/MM/yyyy HH:mm}</td><td>{H(p.PaymentMethod)}</td><td>{H(p.TransactionCode)}</td><td class=\"n\">{Money(p.AmountPaid)}</td></tr>"));
        var html = $$"""
            <!DOCTYPE html>
            <html lang="vi"><head><meta charset="utf-8"><title>Hóa đơn {{H(invoice.InvoiceNumber)}}</title>
            <style>body{font-family:Arial,sans-serif;max-width:720px;margin:24px auto;color:#222}
            table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}
            .n{text-align:right}h1{margin-bottom:4px}</style></head><body>
            <h1>Hóa đơn {{H(invoice.InvoiceNumber)}}</h1>
            <p>Khách hàng: {{H(invoice.Customer.FullName)}}<br>Loại: {{H(invoice.InvoiceType)}} · Hạn thanh toán: {{invoice.DueDate:dd/MM/yyyy}} · Trạng thái: {{H(invoice.Status)}}</p>
            <table><tr><th>Nội dung</th><th class="n">SL</th><th class="n">Đơn giá</th><th class="n">Thành tiền</th></tr>{{rows}}
            <tr><td colspan="3" class="n">Giảm giá</td><td class="n">{{Money(invoice.DiscountAmount)}}</td></tr>
            <tr><th colspan="3" class="n">Tổng cộng</th><th class="n">{{Money(invoice.TotalAmount)}}</th></tr></table>
            <h3>Thanh toán đã ghi nhận</h3>
            <table><tr><th>Thời gian</th><th>Phương thức</th><th>Mã giao dịch</th><th class="n">Số tiền</th></tr>{{paid}}</table>
            </body></html>
            """;
        return Content(html, "text/html; charset=utf-8");
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

    /// <summary>Staff cancels an unpaid extra-charge invoice that was entered by mistake.</summary>
    [HttpPost("{id:int}/cancel")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<InvoiceDto> Cancel(int id, CancelInvoiceRequest req, CancellationToken ct)
    {
        var staffId = User.GetUserId();
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var invoice = await db.Invoices.Include(i => i.Details).Include(i => i.Payments)
            .FirstOrDefaultAsync(i => i.InvoiceId == id, ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn");
        await billing.EnsureStaffOwnsInvoiceAsync(invoice, staffId, ct);
        if (invoice.InvoiceType != "EXTRA_CHARGE")
            throw AppException.Conflict("Chỉ được hủy hóa đơn phụ thu do nhân viên lập");
        if (invoice.Status is not ("Unpaid" or "Overdue"))
            throw AppException.Conflict("Chỉ hủy được hóa đơn chưa thanh toán");
        if (invoice.Payments.Any(p => p.Status is "Pending" or "Success"))
            throw AppException.Conflict("Hóa đơn đã có giao dịch thanh toán nên không thể hủy");

        invoice.Status = "Cancelled";
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = staffId,
            Action = "InvoiceCancelled",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = $"Invoice {invoice.InvoiceNumber} cancelled: {req.Reason.Trim()}",
            CreatedAt = clock.GetLocalNow().DateTime,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return (await MapAsync([invoice], ct))[0];
    }

    /// <summary>
    /// Starts or resumes a VNPay/MoMo checkout. MoMo returns its QR URL, app deep links,
    /// and a payment URL; invoice status is confirmed only by the provider's signed result (IPN, or VNPay's return).
    /// </summary>
    [HttpPost("{id:int}/checkout/{provider}")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<CheckoutResponse> StartCheckout(int id, string provider, CancellationToken ct) =>
        paymentGateways.StartCheckoutAsync(id, User.GetUserId(), provider,
            HttpContext.Connection.RemoteIpAddress?.ToString(), ct);

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
