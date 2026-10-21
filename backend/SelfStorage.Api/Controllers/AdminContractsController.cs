using System.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/admin/contracts")]
[Authorize(Roles = AppRoles.Admin)]
public sealed class AdminContractsController(
    SelfStorageDbContext db,
    TimeProvider clock,
    ILogger<AdminContractsController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<List<AdminContractDto>> List(
        [FromQuery] int? facilityId,
        [FromQuery] int? customerId,
        [FromQuery] string? status,
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        ValidatePaging(page, pageSize);
        if (!string.IsNullOrWhiteSpace(status)
            && status is not (ContractStatus.Active or ContractStatus.Renewed
                or ContractStatus.Terminated or ContractStatus.Overdue or ContractStatus.Liquidated))
            throw AppException.BadRequest("Trạng thái hợp đồng không hợp lệ");

        var query = db.Contracts.AsQueryable();
        if (facilityId is not null)
            query = query.Where(c => c.Unit.FacilityId == facilityId);
        if (customerId is not null)
            query = query.Where(c => c.CustomerId == customerId);
        if (status is not null)
            query = query.Where(c => c.Status == status);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(c => c.ContractNumber.Contains(term)
                || c.Customer.FullName.Contains(term)
                || c.Customer.Email.Contains(term)
                || c.Unit.UnitCode.Contains(term));
        }

        return await Project(query.OrderByDescending(c => c.SignedDate)
                .ThenByDescending(c => c.ContractId)
                .Skip((page - 1) * pageSize)
                .Take(pageSize))
            .ToListAsync(ct);
    }

    [HttpGet("{contractId:int}")]
    public async Task<AdminContractDto> Detail(int contractId, CancellationToken ct) =>
        await Project(db.Contracts.Where(c => c.ContractId == contractId)).SingleOrDefaultAsync(ct)
        ?? throw AppException.NotFound("Không tìm thấy hợp đồng");

    [HttpPut("{contractId:int}")]
    public async Task<AdminContractDto> Update(
        int contractId, UpdateAdminContractRequest req, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var contract = await db.Contracts
            .FirstOrDefaultAsync(c => c.ContractId == contractId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        if (contract.Status != ContractStatus.Active)
            throw AppException.Conflict("Chỉ được chỉnh sửa hợp đồng đang hoạt động; hợp đồng quá hạn cần xử lý theo luồng quá hạn");

        var today = DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        if (req.EndDate <= contract.StartDate || req.EndDate < today)
            throw AppException.BadRequest("Ngày kết thúc mới phải sau ngày bắt đầu và không ở quá khứ");

        if (req.EndDate != contract.EndDate)
        {
            if (await db.ContractRenewals.AnyAsync(r => r.ContractId == contractId
                && (r.Status == "Pending" || r.Status == "Paid"), ct))
                throw AppException.Conflict("Không thể sửa ngày kết thúc khi hợp đồng có yêu cầu gia hạn đang chờ hoặc đã thanh toán");

            if (await db.Invoices.AnyAsync(i => i.ContractId == contractId
                && i.InvoiceType == "MONTHLY_RENT"
                && i.BillingPeriodEnd > req.EndDate
                && i.Status != "Cancelled", ct))
                throw AppException.Conflict(
                    "Ngày kết thúc mới xung đột với hóa đơn tiền thuê đã tạo; hãy xử lý các hóa đơn kỳ sau trước khi đổi ngày");
        }

        var previousEndDate = contract.EndDate;
        var previousTerms = contract.TermsConditions;
        contract.EndDate = req.EndDate;
        contract.TermsConditions = string.IsNullOrWhiteSpace(req.TermsConditions)
            ? null
            : req.TermsConditions.Trim();
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = User.GetUserId(),
            Action = "AdminContractUpdated",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = $"Contract {contract.ContractNumber}; EndDate {previousEndDate:yyyy-MM-dd} -> {contract.EndDate:yyyy-MM-dd}; TermsConditions changed: {previousTerms != contract.TermsConditions}",
            CreatedAt = clock.GetLocalNow().DateTime,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        logger.LogInformation("Administrator {AdminId} updated contract {ContractId}",
            User.GetUserId(), contractId);
        return await Detail(contractId, ct);
    }

    private static IQueryable<AdminContractDto> Project(IQueryable<Contract> query) =>
        query.Select(c => new AdminContractDto(
            c.ContractId,
            c.ContractNumber,
            c.CustomerId,
            c.Customer.FullName,
            c.Customer.Email,
            c.Customer.PhoneNumber,
            c.Unit.FacilityId,
            c.Unit.Facility.FacilityName,
            c.UnitId,
            c.Unit.UnitCode,
            c.StartDate,
            c.EndDate,
            c.Status,
            c.MonthlyRentFee,
            c.DepositPaid,
            c.SignedDate,
            c.TermsConditions));

    private static void ValidatePaging(int page, int pageSize)
    {
        if (page < 1 || pageSize is < 1 or > 100)
            throw AppException.BadRequest("page phải từ 1 và pageSize phải từ 1 đến 100");
    }
}
