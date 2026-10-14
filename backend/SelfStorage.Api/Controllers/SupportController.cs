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
[Route("api/support-requests")]
[Authorize]
public class SupportController(SelfStorageDbContext db, AccessService access, TimeProvider clock) : ControllerBase
{
    private static readonly string[] Categories =
        ["LockIssue", "AccessCodeIssue", "DamagedUnit", "PaymentIssue", "StoredItemsIssue", "Other"];
    private static readonly string[] Priorities = ["Low", "Medium", "High", "Urgent"];
    private static readonly string[] Statuses = ["Open", "InProgress", "Resolved", "Closed"];

    [HttpPost]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<SupportRequestDto> Create(CreateSupportRequest req, CancellationToken ct)
    {
        if (!Categories.Contains(req.Category))
            throw AppException.BadRequest("Loại yêu cầu hỗ trợ không hợp lệ");
        if (!Priorities.Contains(req.Priority))
            throw AppException.BadRequest("Mức độ ưu tiên không hợp lệ");

        var contract = await db.Contracts.Include(c => c.Unit)
            .FirstOrDefaultAsync(c => c.ContractId == req.ContractId && c.CustomerId == User.GetUserId(), ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        if (contract.Status is ContractStatus.Terminated or ContractStatus.Liquidated)
            throw AppException.Conflict("Không thể gửi yêu cầu cho hợp đồng đã kết thúc");

        var request = new SupportRequest
        {
            RequestCode = $"SUP-{clock.GetLocalNow():yyyyMMdd}-{Random.Shared.Next(100000, 999999)}",
            CustomerId = contract.CustomerId,
            ContractId = contract.ContractId,
            UnitId = contract.UnitId,
            FacilityId = contract.Unit.FacilityId,
            Category = req.Category,
            Priority = req.Priority,
            Title = req.Title,
            Description = req.Description,
        };
        db.SupportRequests.Add(request);
        db.SupportUpdates.Add(new SupportUpdate
        {
            Request = request,
            UpdatedByUserId = contract.CustomerId,
            ActionMessage = "Khách hàng đã gửi yêu cầu hỗ trợ",
            NewStatus = "Open",
        });
        await db.SaveChangesAsync(ct);
        return await Project(db.SupportRequests.Where(r => r.RequestId == request.RequestId)).SingleAsync(ct);
    }

    [HttpGet("my")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<List<SupportRequestDto>> Mine(CancellationToken ct)
    {
        var customerId = User.GetUserId();
        return Project(db.SupportRequests.Where(r => r.CustomerId == customerId)
            .OrderByDescending(r => r.CreatedAt)).ToListAsync(ct);
    }

    [HttpGet("{requestId:int}/updates")]
    [Authorize(Roles = AppRoles.Customer + "," + AppRoles.GateRoles)]
    public async Task<List<SupportUpdateDto>> Updates(int requestId, CancellationToken ct)
    {
        var request = await db.SupportRequests.FirstOrDefaultAsync(r => r.RequestId == requestId, ct)
                      ?? throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
        if (User.IsInRole(AppRoles.Customer))
        {
            if (request.CustomerId != User.GetUserId()) throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
        }
        else
        {
            await access.EnsureAssignedAsync(User.GetUserId(), request.FacilityId, ct);
        }
        return await db.SupportUpdates.Where(u => u.RequestId == requestId).OrderBy(u => u.CreatedAt)
            .Select(u => new SupportUpdateDto(u.UpdateId,
                db.Users.Where(user => user.UserId == u.UpdatedByUserId).Select(user => user.FullName).First(),
                u.ActionMessage, u.PreviousStatus, u.NewStatus, u.CreatedAt)).ToListAsync(ct);
    }

    [HttpGet("facilities/{facilityId:int}")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<List<SupportRequestDto>> ForFacility(int facilityId, [FromQuery] string? status, CancellationToken ct)
    {
        await access.EnsureAssignedAsync(User.GetUserId(), facilityId, ct);
        var query = db.SupportRequests.Where(r => r.FacilityId == facilityId);
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Statuses.Contains(status)) throw AppException.BadRequest("Trạng thái yêu cầu không hợp lệ");
            query = query.Where(r => r.Status == status);
        }
        return await Project(query.OrderBy(r => r.CreatedAt)).ToListAsync(ct);
    }

    [HttpPut("{requestId:int}")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<SupportRequestDto> Update(int requestId, UpdateSupportRequest req, CancellationToken ct)
    {
        if (!Statuses.Contains(req.Status)) throw AppException.BadRequest("Trạng thái yêu cầu không hợp lệ");
        var request = await db.SupportRequests.FirstOrDefaultAsync(r => r.RequestId == requestId, ct)
                      ?? throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
        var staffId = User.GetUserId();
        await access.EnsureAssignedAsync(staffId, request.FacilityId, ct);
        if (request.AssignedStaffId is not null && request.AssignedStaffId != staffId)
            throw AppException.Conflict("Yêu cầu đã được nhân viên khác tiếp nhận");
        if (request.Status == "Closed" || (request.Status == "Resolved" && req.Status != "Closed"))
            throw AppException.Conflict("Yêu cầu đã kết thúc xử lý");

        var previousStatus = request.Status;
        request.AssignedStaffId = staffId;
        request.Status = req.Status;
        request.ResolvedAt = req.Status is "Resolved" or "Closed" ? clock.GetLocalNow().DateTime : null;
        db.SupportUpdates.Add(new SupportUpdate
        {
            RequestId = requestId,
            UpdatedByUserId = staffId,
            ActionMessage = req.ActionMessage,
            PreviousStatus = previousStatus,
            NewStatus = req.Status,
        });
        await db.SaveChangesAsync(ct);
        return await Project(db.SupportRequests.Where(r => r.RequestId == requestId)).SingleAsync(ct);
    }

    private static IQueryable<SupportRequestDto> Project(IQueryable<SupportRequest> query) =>
        query.Select(r => new SupportRequestDto(r.RequestId, r.RequestCode, r.ContractId ?? 0,
            r.Unit != null ? r.Unit.UnitCode : "", r.Category, r.Priority, r.Title, r.Description, r.Status,
            r.CreatedAt, r.AssignedStaff != null ? r.AssignedStaff.FullName : null));
}
