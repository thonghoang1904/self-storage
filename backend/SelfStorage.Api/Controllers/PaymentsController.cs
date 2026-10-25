using System.Data;
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
[Route("api/payments")]
[Authorize(Roles = AppRoles.Customer)]
public sealed class PaymentsController(SelfStorageDbContext db, TimeProvider clock) : ControllerBase
{
    /// <summary>Payment history of the signed-in customer, newest first.</summary>
    [HttpGet("my")]
    public async Task<List<PaymentStatusDto>> Mine(
        [FromQuery] string? status, [FromQuery] int page = 1, [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        if (page < 1 || pageSize is < 1 or > 100)
            throw AppException.BadRequest("page phải từ 1 và pageSize phải từ 1 đến 100");
        if (status is not null && status is not ("Pending" or "Success" or "Failed" or "Refunded"))
            throw AppException.BadRequest("Trạng thái giao dịch không hợp lệ");

        var me = User.GetUserId();
        var query = db.Payments.Where(p => db.Invoices.Any(i => i.InvoiceId == p.InvoiceId && i.CustomerId == me));
        if (status is not null) query = query.Where(p => p.Status == status);
        Response.Headers["X-Total-Count"] = (await query.CountAsync(ct)).ToString();
        return await Project(query.OrderByDescending(p => p.PaymentDate).ThenByDescending(p => p.PaymentId)
            .Skip((page - 1) * pageSize).Take(pageSize)).ToListAsync(ct);
    }

    /// <summary>Status of one payment; the frontend polls this after returning from VNPay/MoMo.</summary>
    [HttpGet("{id:int}/status")]
    public async Task<PaymentStatusDto> Status(int id, CancellationToken ct)
    {
        var me = User.GetUserId();
        return await Project(db.Payments.Where(p => p.PaymentId == id
                && db.Invoices.Any(i => i.InvoiceId == p.InvoiceId && i.CustomerId == me)))
            .FirstOrDefaultAsync(ct)
            ?? throw AppException.NotFound("Không tìm thấy giao dịch");
    }

    /// <summary>
    /// Cancels an online checkout that is still pending so the invoice can be paid another way.
    /// Allowed only after the gateway link has expired, to avoid cancelling a payment that is being completed.
    /// </summary>
    [HttpPost("{id:int}/cancel")]
    public async Task<PaymentStatusDto> Cancel(int id, CancellationToken ct)
    {
        var me = User.GetUserId();
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var payment = await db.Payments.FirstOrDefaultAsync(p => p.PaymentId == id
                && db.Invoices.Any(i => i.InvoiceId == p.InvoiceId && i.CustomerId == me), ct)
            ?? throw AppException.NotFound("Không tìm thấy giao dịch");
        if (payment.Status != "Pending")
            throw AppException.Conflict("Chỉ hủy được giao dịch đang chờ thanh toán");
        var now = clock.GetLocalNow().DateTime;
        if (payment.PaymentDate > now - BillingService.PendingPaymentCancelAfter)
            throw AppException.Conflict("Giao dịch vừa được tạo; vui lòng đợi liên kết thanh toán hết hạn rồi hủy");

        payment.Status = "Failed";
        payment.PaymentNotes = "Khách hủy giao dịch chờ thanh toán.";
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await Project(db.Payments.Where(p => p.PaymentId == id)).SingleAsync(ct);
    }

    private IQueryable<PaymentStatusDto> Project(IQueryable<Payment> query) =>
        query.Select(p => new PaymentStatusDto(p.PaymentId, p.InvoiceId,
            db.Invoices.Where(i => i.InvoiceId == p.InvoiceId).Select(i => i.InvoiceNumber).First(),
            p.PaymentMethod, p.Status, p.AmountPaid, p.PaymentDate, p.TransactionCode,
            db.Invoices.Where(i => i.InvoiceId == p.InvoiceId).Select(i => i.Status).First(),
            p.PaymentNotes));
}
