using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/admin/invoices")]
[Authorize(Roles = AppRoles.Admin)]
public sealed class AdminInvoicesController(SelfStorageDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<List<AdminInvoiceDto>> List(
        [FromQuery] int? facilityId = null,
        [FromQuery] int? customerId = null,
        [FromQuery] int? contractId = null,
        [FromQuery] int? reservationId = null,
        [FromQuery] int? staffId = null,
        [FromQuery] string? status = null,
        [FromQuery] string? invoiceType = null,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        if (page < 1 || pageSize is < 1 or > 200)
            throw AppException.BadRequest("Trang phải từ 1 trở lên và pageSize từ 1 đến 200");
        if (!string.IsNullOrWhiteSpace(status)
            && status is not ("Unpaid" or "Paid" or "Overdue" or "Cancelled"))
            throw AppException.BadRequest("Trạng thái hóa đơn không hợp lệ");
        if (!string.IsNullOrWhiteSpace(invoiceType)
            && invoiceType is not ("DEPOSIT" or "MONTHLY_RENT" or "RENEWAL" or "OVERDUE_FINE" or "EXTRA_CHARGE"))
            throw AppException.BadRequest("Loại hóa đơn không hợp lệ");
        if (from is not null && to is not null && from > to)
            throw AppException.BadRequest("Ngày bắt đầu không được sau ngày kết thúc");

        var query = db.Invoices.AsQueryable();
        if (facilityId is not null)
        {
            query = query.Where(i =>
                (i.ContractId != null && db.Contracts.Any(c => c.ContractId == i.ContractId && c.Unit.FacilityId == facilityId))
                || (i.ReservationId != null && db.Reservations.Any(r => r.ReservationId == i.ReservationId && r.FacilityId == facilityId)));
        }
        if (customerId is not null) query = query.Where(i => i.CustomerId == customerId);
        if (contractId is not null) query = query.Where(i => i.ContractId == contractId);
        if (reservationId is not null) query = query.Where(i => i.ReservationId == reservationId);
        if (staffId is not null)
            query = query.Where(i => i.Payments.Any(p => p.ReceivedByStaffId == staffId));
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(i => i.Status == status);
        if (!string.IsNullOrWhiteSpace(invoiceType)) query = query.Where(i => i.InvoiceType == invoiceType);
        if (from is not null) query = query.Where(i => i.CreatedAt >= from);
        if (to is not null) query = query.Where(i => i.CreatedAt <= to);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(i => i.InvoiceNumber.Contains(term)
                || i.Customer.FullName.Contains(term)
                || i.Customer.Email.Contains(term)
                || i.Customer.PhoneNumber.Contains(term)
                || (i.ContractId != null && db.Contracts.Any(c => c.ContractId == i.ContractId
                    && (c.ContractNumber.Contains(term) || c.Unit.UnitCode.Contains(term))))
                || (i.ReservationId != null && db.Reservations.Any(r => r.ReservationId == i.ReservationId
                    && (r.ReservationCode.Contains(term)
                        || (r.AssignedUnit != null && r.AssignedUnit.UnitCode.Contains(term)))))
                || i.Payments.Any(p => p.TransactionCode != null && p.TransactionCode.Contains(term)));
        }

        Response.Headers["X-Total-Count"] = (await query.CountAsync(ct)).ToString();

        var invoices = await query
            .Include(i => i.Customer)
            .Include(i => i.Details)
            .Include(i => i.Payments)
            .OrderByDescending(i => i.CreatedAt)
            .ThenByDescending(i => i.InvoiceId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return await MapAsync(invoices, ct);
    }

    [HttpGet("{invoiceId:int}")]
    public async Task<AdminInvoiceDto> Detail(int invoiceId, CancellationToken ct)
    {
        var invoice = await db.Invoices
            .Include(i => i.Customer)
            .Include(i => i.Details)
            .Include(i => i.Payments)
            .FirstOrDefaultAsync(i => i.InvoiceId == invoiceId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn");

        return (await MapAsync([invoice], ct))[0];
    }

    private async Task<List<AdminInvoiceDto>> MapAsync(
        IReadOnlyCollection<Invoice> invoices, CancellationToken ct)
    {
        if (invoices.Count == 0)
            return [];

        var contractIds = invoices.Where(i => i.ContractId is not null)
            .Select(i => i.ContractId!.Value)
            .Distinct()
            .ToArray();
        var reservationIds = invoices.Where(i => i.ReservationId is not null)
            .Select(i => i.ReservationId!.Value)
            .Distinct()
            .ToArray();

        var contractRows = await db.Contracts
            .Where(c => contractIds.Contains(c.ContractId)
                || (c.ReservationId != null && reservationIds.Contains(c.ReservationId.Value)))
            .Select(c => new
            {
                c.ContractId,
                c.ContractNumber,
                c.ReservationId,
                FacilityId = c.Unit.FacilityId,
                FacilityName = c.Unit.Facility.FacilityName,
                UnitCode = c.Unit.UnitCode,
            })
            .ToListAsync(ct);

        var contractsById = contractRows.ToDictionary(c => c.ContractId);
        var contractsByReservationId = contractRows
            .Where(c => c.ReservationId is not null)
            .GroupBy(c => c.ReservationId!.Value)
            .ToDictionary(g => g.Key, g => g.First());

        var allReservationIds = reservationIds
            .Concat(contractRows.Where(c => c.ReservationId is not null).Select(c => c.ReservationId!.Value))
            .Distinct()
            .ToArray();

        var reservationsById = allReservationIds.Length == 0
            ? new Dictionary<int, ReservationRef>()
            : (await db.Reservations
                .Where(r => allReservationIds.Contains(r.ReservationId))
                .Select(r => new ReservationRef(
                    r.ReservationId,
                    r.ReservationCode,
                    r.FacilityId,
                    r.Facility.FacilityName,
                    r.AssignedUnit != null ? r.AssignedUnit.UnitCode : null))
                .ToListAsync(ct))
                .ToDictionary(r => r.ReservationId);

        var staffIds = invoices.SelectMany(i => i.Payments)
            .Where(p => p.ReceivedByStaffId is not null)
            .Select(p => p.ReceivedByStaffId!.Value)
            .Distinct()
            .ToArray();
        var staffNames = staffIds.Length == 0
            ? new Dictionary<int, string>()
            : await db.Users.Where(u => staffIds.Contains(u.UserId))
                .ToDictionaryAsync(u => u.UserId, u => u.FullName, ct);

        return invoices.Select(i =>
        {
            var contract = i.ContractId is int cid && contractsById.TryGetValue(cid, out var directContract)
                ? directContract
                : i.ReservationId is int rid && contractsByReservationId.TryGetValue(rid, out var rsvContract)
                    ? rsvContract
                    : null;
            var effectiveReservationId = i.ReservationId ?? contract?.ReservationId;
            var reservation = effectiveReservationId is int effRid
                ? reservationsById.GetValueOrDefault(effRid)
                : null;

            int? resolvedFacilityId = contract?.FacilityId ?? reservation?.FacilityId;
            var resolvedFacilityName = contract?.FacilityName ?? reservation?.FacilityName;
            var resolvedUnitCode = contract?.UnitCode ?? reservation?.UnitCode;

            var paidAmount = i.Payments.Where(p => p.Status == "Success").Sum(p => p.AmountPaid);
            var refundedAmount = i.Payments.Where(p => p.Status == "Refunded").Sum(p => p.AmountPaid);
            var collectedBy = i.Payments
                .Where(p => p.Status == "Success" && p.ReceivedByStaffId is not null)
                .OrderByDescending(p => p.PaymentDate)
                .ThenByDescending(p => p.PaymentId)
                .FirstOrDefault();

            var collectedById = collectedBy?.ReceivedByStaffId;
            var collectedByName = collectedById is int sid && staffNames.TryGetValue(sid, out var sname)
                ? sname
                : null;

            return new AdminInvoiceDto(
                i.InvoiceId,
                i.InvoiceNumber,
                i.InvoiceType,
                i.Status,
                i.CustomerId,
                i.Customer.FullName,
                i.Customer.Email,
                i.Customer.PhoneNumber,
                resolvedFacilityId,
                resolvedFacilityName,
                i.ContractId ?? contract?.ContractId,
                contract?.ContractNumber,
                effectiveReservationId,
                reservation?.ReservationCode,
                resolvedUnitCode,
                i.SubTotal,
                i.DiscountAmount,
                i.TotalAmount,
                paidAmount,
                refundedAmount,
                i.DueDate,
                i.CreatedAt,
                i.BillingPeriodStart,
                i.BillingPeriodEnd,
                collectedById,
                collectedByName,
                i.Details.OrderBy(d => d.DetailId)
                    .Select(d => new InvoiceDetailDto(d.DetailId, d.Description, d.Quantity, d.UnitPrice, d.LineTotal))
                    .ToList(),
                i.Payments.OrderBy(p => p.PaymentDate).ThenBy(p => p.PaymentId)
                    .Select(p => new AdminInvoicePaymentDto(
                        p.PaymentId,
                        p.PaymentMethod,
                        p.TransactionCode,
                        p.AmountPaid,
                        p.PaymentDate,
                        p.Status,
                        p.PaymentNotes,
                        p.ReceivedByStaffId,
                        p.ReceivedByStaffId is int pid && staffNames.TryGetValue(pid, out var pname) ? pname : null))
                    .ToList());
        }).ToList();
    }

    private sealed record ReservationRef(
        int ReservationId,
        string ReservationCode,
        int FacilityId,
        string FacilityName,
        string? UnitCode);
}
