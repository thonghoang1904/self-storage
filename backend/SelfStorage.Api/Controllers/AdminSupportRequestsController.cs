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
[Route("api/admin/support-requests")]
[Authorize(Roles = AppRoles.Admin + "," + AppRoles.OpsManager)]
public sealed class AdminSupportRequestsController(SelfStorageDbContext db, TimeProvider clock) : ControllerBase
{
    private static readonly string[] Statuses = ["Open", "InProgress", "Resolved", "Closed"];

    [HttpGet]
    public async Task<List<AdminSupportRequestDto>> List(
        [FromQuery] int? facilityId,
        [FromQuery] string? status,
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        ValidatePaging(page, pageSize);
        if (facilityId is <= 0)
            throw AppException.BadRequest("facilityId phải lớn hơn 0");
        if (!string.IsNullOrWhiteSpace(status) && !Statuses.Contains(status))
            throw AppException.BadRequest("Trạng thái yêu cầu không hợp lệ");

        var query = db.SupportRequests.AsQueryable();
        if (facilityId is not null)
            query = query.Where(r => r.FacilityId == facilityId);
        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(r => r.Status == status);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(r => r.RequestCode.Contains(term)
                || r.Title.Contains(term)
                || r.Description.Contains(term)
                || r.Customer.FullName.Contains(term)
                || (r.Unit != null && r.Unit.UnitCode.Contains(term)));
        }

        return await Project(query.OrderByDescending(r => r.CreatedAt)
                .ThenByDescending(r => r.RequestId))
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);
    }

    [HttpGet("{requestId:int}")]
    public async Task<AdminSupportRequestDto> Detail(int requestId, CancellationToken ct) =>
        await Project(db.SupportRequests.Where(r => r.RequestId == requestId)).SingleOrDefaultAsync(ct)
        ?? throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");

    [HttpGet("{requestId:int}/updates")]
    public async Task<List<SupportUpdateDto>> Updates(int requestId, CancellationToken ct)
    {
        await EnsureRequestExistsAsync(requestId, ct);
        return await db.SupportUpdates.Where(u => u.RequestId == requestId)
            .OrderBy(u => u.CreatedAt)
            .Select(u => new SupportUpdateDto(u.UpdateId,
                db.Users.Where(user => user.UserId == u.UpdatedByUserId)
                    .Select(user => user.FullName).First(),
                u.ActionMessage, u.PreviousStatus, u.NewStatus, u.CreatedAt))
            .ToListAsync(ct);
    }

    [HttpGet("{requestId:int}/checklist")]
    public async Task<List<SupportChecklistItemDto>> Checklist(int requestId, CancellationToken ct)
    {
        await EnsureRequestExistsAsync(requestId, ct);
        return await db.SupportChecklistItems.Where(i => i.RequestId == requestId)
            .OrderBy(i => i.SortOrder)
            .Select(i => new SupportChecklistItemDto(i.ChecklistItemId, i.SortOrder, i.Description,
                i.IsCompleted, i.CompletedAt,
                db.Users.Where(user => user.UserId == i.CompletedByStaffId)
                    .Select(user => user.FullName).FirstOrDefault(),
                i.Notes))
            .ToListAsync(ct);
    }

    [HttpPost("{requestId:int}/messages")]
    [Authorize(Roles = AppRoles.Admin)]
    public async Task<SupportUpdateDto> AddMessage(
        int requestId, AddSupportMessageRequest req, CancellationToken ct)
    {
        var request = await db.SupportRequests.FirstOrDefaultAsync(r => r.RequestId == requestId, ct)
            ?? throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
        if (request.Status == "Closed")
            throw AppException.Conflict("Yêu cầu đã đóng, không thể thêm phản hồi");
        if (string.IsNullOrWhiteSpace(req.Message))
            throw AppException.BadRequest("Nội dung phản hồi không được để trống");

        var userId = User.GetUserId();
        var update = new SupportUpdate
        {
            RequestId = requestId,
            UpdatedByUserId = userId,
            ActionMessage = req.Message.Trim(),
        };
        db.SupportUpdates.Add(update);
        await db.SaveChangesAsync(ct);
        var author = await db.Users.Where(user => user.UserId == userId)
            .Select(user => user.FullName).SingleAsync(ct);
        return new SupportUpdateDto(update.UpdateId, author, update.ActionMessage,
            null, null, update.CreatedAt);
    }

    [HttpPut("{requestId:int}")]
    [Authorize(Roles = AppRoles.Admin)]
    public async Task<AdminSupportRequestDto> Update(
        int requestId, UpdateSupportRequest req, CancellationToken ct)
    {
        if (!Statuses.Contains(req.Status))
            throw AppException.BadRequest("Trạng thái yêu cầu không hợp lệ");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var request = await db.SupportRequests.FirstOrDefaultAsync(r => r.RequestId == requestId, ct)
            ?? throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
        if (request.Status == "Closed" || (request.Status == "Resolved" && req.Status != "Closed"))
            throw AppException.Conflict("Yêu cầu đã kết thúc xử lý");

        var validTransition = request.Status switch
        {
            "Open" => req.Status == "InProgress",
            "InProgress" => req.Status is "InProgress" or "Resolved",
            "Resolved" => req.Status == "Closed",
            _ => false,
        };
        if (!validTransition)
            throw AppException.Conflict($"Không thể chuyển yêu cầu từ {request.Status} sang {req.Status}");
        if (req.Status == "Resolved" && await db.SupportChecklistItems.AnyAsync(
                i => i.RequestId == requestId && !i.IsCompleted, ct))
            throw AppException.Conflict("Cần hoàn tất toàn bộ checklist trước khi đánh dấu ticket đã xử lý");

        var previousStatus = request.Status;
        request.Status = req.Status;
        request.ResolvedAt = req.Status is "Resolved" or "Closed"
            ? clock.GetLocalNow().DateTime
            : null;
        db.SupportUpdates.Add(new SupportUpdate
        {
            RequestId = requestId,
            UpdatedByUserId = User.GetUserId(),
            ActionMessage = req.ActionMessage,
            PreviousStatus = previousStatus,
            NewStatus = req.Status,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await Project(db.SupportRequests.Where(r => r.RequestId == requestId)).SingleAsync(ct);
    }

    [HttpPut("{requestId:int}/checklist/{checklistItemId:int}")]
    [Authorize(Roles = AppRoles.Admin)]
    public async Task<SupportChecklistItemDto> UpdateChecklistItem(
        int requestId, int checklistItemId, UpdateSupportChecklistItemRequest req, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var item = await db.SupportChecklistItems.Include(i => i.Request)
            .FirstOrDefaultAsync(i => i.ChecklistItemId == checklistItemId && i.RequestId == requestId, ct)
            ?? throw AppException.NotFound("Không tìm thấy mục checklist");
        if (item.Request.Status != "InProgress")
            throw AppException.Conflict("Chỉ được cập nhật checklist khi ticket đang được xử lý");

        var adminId = User.GetUserId();
        item.IsCompleted = req.IsCompleted;
        item.CompletedByStaffId = req.IsCompleted ? adminId : null;
        item.CompletedAt = req.IsCompleted ? clock.GetLocalNow().DateTime : null;
        item.Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();
        db.SupportUpdates.Add(new SupportUpdate
        {
            RequestId = requestId,
            UpdatedByUserId = adminId,
            ActionMessage = $"Checklist {(req.IsCompleted ? "hoàn tất" : "bỏ hoàn tất")}: {item.Description}"
                + (item.Notes is null ? "" : $". Ghi chú: {item.Notes}"),
            PreviousStatus = item.Request.Status,
            NewStatus = item.Request.Status,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await db.SupportChecklistItems.Where(i => i.ChecklistItemId == checklistItemId)
            .Select(i => new SupportChecklistItemDto(i.ChecklistItemId, i.SortOrder, i.Description,
                i.IsCompleted, i.CompletedAt,
                db.Users.Where(user => user.UserId == i.CompletedByStaffId)
                    .Select(user => user.FullName).FirstOrDefault(),
                i.Notes))
            .SingleAsync(ct);
    }

    private IQueryable<AdminSupportRequestDto> Project(IQueryable<SupportRequest> query) =>
        query.Select(r => new AdminSupportRequestDto(
            r.RequestId,
            r.RequestCode,
            r.ContractId ?? 0,
            r.Unit != null ? r.Unit.UnitCode : "",
            r.Category,
            r.Priority,
            r.Title,
            r.Description,
            r.Status,
            r.CreatedAt,
            r.AssignedStaff != null ? r.AssignedStaff.FullName : null,
            r.FacilityId,
            db.Facilities.Where(f => f.FacilityId == r.FacilityId)
                .Select(f => f.FacilityName).First(),
            r.CustomerId,
            r.Customer.FullName));

    private async Task EnsureRequestExistsAsync(int requestId, CancellationToken ct)
    {
        if (!await db.SupportRequests.AnyAsync(r => r.RequestId == requestId, ct))
            throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
    }

    private static void ValidatePaging(int page, int pageSize)
    {
        if (page < 1 || pageSize is < 1 or > 100)
            throw AppException.BadRequest("page phải từ 1 và pageSize phải từ 1 đến 100");
    }
}
