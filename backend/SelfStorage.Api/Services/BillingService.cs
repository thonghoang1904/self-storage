using System.Data;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Services;

public sealed class BillingService(SelfStorageDbContext db, AccessService access, TimeProvider clock)
{
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
            throw AppException.Conflict("Hóa đơn đang có giao dịch trực tuyến chưa được xác nhận");
        if (request.AmountPaid != invoice.TotalAmount)
            throw AppException.BadRequest($"Số tiền cần thanh toán chính xác là {invoice.TotalAmount:N0}đ");
        if (transactionCode is not null
            && await db.Payments.AnyAsync(p => p.TransactionCode == transactionCode, ct))
            throw AppException.Conflict("Mã giao dịch đã được ghi nhận");

        var now = clock.GetLocalNow().DateTime;
        if (invoice.InvoiceType == "DEPOSIT")
        {
            if (invoice.ReservationId is not int reservationId)
                throw AppException.Conflict("Hóa đơn cọc không liên kết với đơn đặt kho");
            var reservation = await db.Reservations.FirstOrDefaultAsync(r => r.ReservationId == reservationId, ct)
                ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
            if (reservation.Status != ReservationStatus.PendingDeposit || reservation.DepositDeadline <= now
                || invoice.TotalAmount != reservation.DepositAmount)
                throw AppException.Conflict("Đơn đặt kho đã hết hạn hoặc số tiền cọc không còn hợp lệ");
            reservation.Status = ReservationStatus.Confirmed;
        }
        else if (invoice.InvoiceType == "RENEWAL")
        {
            var renewal = await db.ContractRenewals.FirstOrDefaultAsync(r => r.InvoiceId == invoiceId, ct)
                ?? throw AppException.Conflict("Hóa đơn không liên kết với yêu cầu gia hạn");
            var contract = await db.Contracts.Include(c => c.Unit)
                .FirstOrDefaultAsync(c => c.ContractId == renewal.ContractId, ct)
                ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
            if (renewal.Status != "Pending" || contract.Status != ContractStatus.Active
                || contract.EndDate != renewal.OldEndDate
                || now >= renewal.OldEndDate.ToDateTime(new TimeOnly(20, 0))
                || invoice.TotalAmount != renewal.RenewalFee)
                throw AppException.Conflict("Yêu cầu gia hạn đã hết hạn hoặc không còn hợp lệ");

            renewal.Status = "Paid";
            renewal.ApprovedByStaffId = staffId;
            renewal.ProcessedAt = now;
            contract.EndDate = renewal.NewEndDate;
            contract.Unit.Status = UnitStatus.Rented;
        }

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

    public async Task<bool> CompleteOnlinePaymentAsync(
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

        if (payment.Status == "Success")
        {
            await transaction.CommitAsync(ct);
            return true;
        }
        if (payment.Status == "Failed" && !succeeded)
        {
            await transaction.CommitAsync(ct);
            return false;
        }
        if (payment.Status != "Pending")
            throw AppException.Conflict("Giao dịch không còn ở trạng thái chờ xử lý");
        if (payment.AmountPaid != amount)
            throw AppException.Conflict("Số tiền từ cổng thanh toán không khớp hóa đơn");

        if (!succeeded)
        {
            payment.Status = "Failed";
            payment.PaymentNotes = $"Cổng thanh toán báo thất bại ({providerTransactionId ?? "không có mã giao dịch"}).";
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return false;
        }

        var invoice = await db.Invoices.FirstOrDefaultAsync(i => i.InvoiceId == payment.InvoiceId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn của giao dịch");
        if (invoice.Status is not ("Unpaid" or "Overdue") || invoice.TotalAmount != amount)
            throw AppException.Conflict("Hóa đơn không còn chờ thanh toán hoặc số tiền không khớp");

        var now = clock.GetLocalNow().DateTime;
        if (invoice.InvoiceType == "DEPOSIT")
        {
            if (invoice.ReservationId is not int reservationId)
                throw AppException.Conflict("Hóa đơn cọc không liên kết với đơn đặt kho");
            var reservation = await db.Reservations.FirstOrDefaultAsync(r => r.ReservationId == reservationId, ct)
                ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
            if (reservation.Status != ReservationStatus.PendingDeposit
                || reservation.DepositDeadline <= now
                || invoice.TotalAmount != reservation.DepositAmount)
                throw AppException.Conflict("Đơn đặt kho đã hết hạn hoặc số tiền cọc không còn hợp lệ");
            reservation.Status = ReservationStatus.Confirmed;
        }
        else if (invoice.InvoiceType == "RENEWAL")
        {
            var renewal = await db.ContractRenewals.FirstOrDefaultAsync(r => r.InvoiceId == invoice.InvoiceId, ct)
                ?? throw AppException.Conflict("Hóa đơn không liên kết với yêu cầu gia hạn");
            var contract = await db.Contracts.Include(c => c.Unit)
                .FirstOrDefaultAsync(c => c.ContractId == renewal.ContractId, ct)
                ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
            if (renewal.Status != "Pending" || contract.Status != ContractStatus.Active
                || contract.EndDate != renewal.OldEndDate
                || now >= renewal.OldEndDate.ToDateTime(new TimeOnly(20, 0))
                || invoice.TotalAmount != renewal.RenewalFee)
                throw AppException.Conflict("Yêu cầu gia hạn đã hết hạn hoặc không còn hợp lệ");

            renewal.Status = "Paid";
            renewal.ProcessedAt = now;
            contract.EndDate = renewal.NewEndDate;
            contract.Unit.Status = UnitStatus.Rented;
        }

        invoice.Status = "Paid";
        payment.Status = "Success";
        payment.PaymentDate = now;
        payment.PaymentNotes = string.IsNullOrWhiteSpace(providerTransactionId)
            ? "Thanh toán trực tuyến đã được xác nhận."
            : $"Thanh toán trực tuyến đã được xác nhận. Mã giao dịch cổng: {providerTransactionId}";
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return true;
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
}
