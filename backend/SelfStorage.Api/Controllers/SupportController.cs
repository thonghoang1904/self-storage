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
[Route("api/support-requests")]
[Authorize]
public class SupportController(SelfStorageDbContext db, AccessService access, TimeProvider clock) : ControllerBase
{
    private static readonly IReadOnlyDictionary<string, string[]> ChecklistTemplates =
        new Dictionary<string, string[]>
        {
            ["LockIssue"] =
            [
                "Xác minh khách hàng và mã kho",
                "Kiểm tra tình trạng khóa tại chỗ",
                "Thử khóa và mở kho cùng khách",
            ],
            ["AccessCodeIssue"] =
            [
                "Xác minh khách hàng hoặc người được ủy quyền",
                "Kiểm tra quyền truy cập còn hiệu lực",
                "Hướng dẫn hoặc cấp lại mã truy cập",
                "Xác nhận khách truy cập được",
            ],
            ["DamagedUnit"] =
            [
                "Ghi nhận vị trí và tình trạng hư hỏng",
                "Đánh giá nguy cơ an toàn và tài sản",
                "Ghi nhận bằng chứng và báo quản lý/bảo trì",
                "Thông báo phương án xử lý cho khách",
            ],
            ["PaymentIssue"] =
            [
                "Đối chiếu hóa đơn và mã giao dịch",
                "Kiểm tra trạng thái giao dịch với bộ phận phụ trách",
                "Thông báo kết quả và bước tiếp theo cho khách",
            ],
            ["StoredItemsIssue"] =
            [
                "Xác minh khách hàng và mã kho",
                "Ghi nhận tình trạng và vị trí hàng hóa",
                "Kiểm tra lịch sử ra vào liên quan",
                "Thống nhất phương án hỗ trợ với khách",
            ],
            ["Other"] =
            [
                "Liên hệ và xác nhận vấn đề với khách",
                "Ghi nhận kết quả kiểm tra",
                "Thống nhất và thông báo hướng xử lý cho khách",
            ],
        };

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
            ChecklistItems = ChecklistTemplates[req.Category]
                .Select((description, index) => new SupportChecklistItem
                {
                    SortOrder = index + 1,
                    Description = description,
                })
                .ToList(),
        };
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        db.SupportRequests.Add(request);
        db.SupportUpdates.Add(new SupportUpdate
        {
            Request = request,
            UpdatedByUserId = contract.CustomerId,
            ActionMessage = "Khách hàng đã gửi yêu cầu hỗ trợ",
            NewStatus = "Open",
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
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

    [HttpGet("{requestId:int}")]
    [Authorize(Roles = AppRoles.Customer + "," + AppRoles.GateRoles)]
    public async Task<SupportRequestDto> Detail(int requestId, CancellationToken ct)
    {
        var request = await db.SupportRequests.FirstOrDefaultAsync(r => r.RequestId == requestId, ct)
                      ?? throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
        await EnsureCanReadRequestAsync(request, ct);
        return await Project(db.SupportRequests.Where(r => r.RequestId == requestId)).SingleAsync(ct);
    }

    /// <summary>Customer or assigned facility staff adds a message to the ticket's timeline.</summary>
    [HttpPost("{requestId:int}/messages")]
    [Authorize(Roles = AppRoles.Customer + "," + AppRoles.GateRoles)]
    public async Task<SupportUpdateDto> AddMessage(int requestId, AddSupportMessageRequest req, CancellationToken ct)
    {
        var request = await db.SupportRequests.FirstOrDefaultAsync(r => r.RequestId == requestId, ct)
                      ?? throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
        await EnsureCanReadRequestAsync(request, ct);
        if (request.Status == "Closed")
            throw AppException.Conflict("Yêu cầu đã đóng, không thể thêm phản hồi");

        var userId = User.GetUserId();
        var update = new SupportUpdate
        {
            RequestId = requestId,
            UpdatedByUserId = userId,
            ActionMessage = req.Message.Trim(),
        };
        db.SupportUpdates.Add(update);
        await db.SaveChangesAsync(ct);
        var author = await db.Users.Where(u => u.UserId == userId).Select(u => u.FullName).SingleAsync(ct);
        return new SupportUpdateDto(update.UpdateId, author, update.ActionMessage, null, null, update.CreatedAt);
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

    [HttpGet("{requestId:int}/checklist")]
    [Authorize(Roles = AppRoles.Customer + "," + AppRoles.GateRoles)]
    public async Task<List<SupportChecklistItemDto>> Checklist(int requestId, CancellationToken ct)
    {
        var request = await db.SupportRequests.FirstOrDefaultAsync(r => r.RequestId == requestId, ct)
                ?? throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
        await EnsureCanReadRequestAsync(request, ct);
        return await ProjectChecklist(db.SupportChecklistItems.Where(i => i.RequestId == requestId)
            .OrderBy(i => i.SortOrder)).ToListAsync(ct);
    }

    [HttpPut("{requestId:int}/checklist/{checklistItemId:int}")]
    [Authorize(Roles = AppRoles.GateRoles)]
    public async Task<SupportChecklistItemDto> UpdateChecklistItem(
        int requestId,
        int checklistItemId,
        UpdateSupportChecklistItemRequest req,
        CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var item = await db.SupportChecklistItems.Include(i => i.Request)
            .FirstOrDefaultAsync(i => i.ChecklistItemId == checklistItemId && i.RequestId == requestId, ct)
            ?? throw AppException.NotFound("Không tìm thấy mục checklist");
        var staffId = User.GetUserId();
        await access.EnsureAssignedAsync(staffId, item.Request.FacilityId, ct);
        if (item.Request.Status != "InProgress")
            throw AppException.Conflict("Chỉ được cập nhật checklist khi ticket đang được xử lý");
        if (item.Request.AssignedStaffId is not null && item.Request.AssignedStaffId != staffId)
            throw AppException.Conflict("Yêu cầu đã được nhân viên khác tiếp nhận");

        item.Request.AssignedStaffId = staffId;
        item.IsCompleted = req.IsCompleted;
        item.CompletedByStaffId = req.IsCompleted ? staffId : null;
        item.CompletedAt = req.IsCompleted ? clock.GetLocalNow().DateTime : null;
        item.Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();
        db.SupportUpdates.Add(new SupportUpdate
        {
            RequestId = requestId,
            UpdatedByUserId = staffId,
            ActionMessage = $"Checklist {(req.IsCompleted ? "hoàn tất" : "bỏ hoàn tất")}: {item.Description}"
                + (item.Notes is null ? "" : $". Ghi chú: {item.Notes}"),
            PreviousStatus = item.Request.Status,
            NewStatus = item.Request.Status,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await ProjectChecklist(db.SupportChecklistItems.Where(i => i.ChecklistItemId == checklistItemId))
            .SingleAsync(ct);
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
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var request = await db.SupportRequests.FirstOrDefaultAsync(r => r.RequestId == requestId, ct)
                      ?? throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
        var staffId = User.GetUserId();
        await access.EnsureAssignedAsync(staffId, request.FacilityId, ct);
        if (request.AssignedStaffId is not null && request.AssignedStaffId != staffId)
            throw AppException.Conflict("Yêu cầu đã được nhân viên khác tiếp nhận");
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
        await transaction.CommitAsync(ct);
        return await Project(db.SupportRequests.Where(r => r.RequestId == requestId)).SingleAsync(ct);
    }

    private static IQueryable<SupportRequestDto> Project(IQueryable<SupportRequest> query) =>
        query.Select(r => new SupportRequestDto(r.RequestId, r.RequestCode, r.ContractId ?? 0,
            r.Unit != null ? r.Unit.UnitCode : "", r.Category, r.Priority, r.Title, r.Description, r.Status,
            r.CreatedAt, r.AssignedStaff != null ? r.AssignedStaff.FullName : null));

    private IQueryable<SupportChecklistItemDto> ProjectChecklist(IQueryable<SupportChecklistItem> query) =>
        query.Select(i => new SupportChecklistItemDto(i.ChecklistItemId, i.SortOrder, i.Description,
            i.IsCompleted, i.CompletedAt, i.CompletedByStaff != null ? i.CompletedByStaff.FullName : null,
            i.Notes));

    private async Task EnsureCanReadRequestAsync(SupportRequest request, CancellationToken ct)
    {
        if (User.IsInRole(AppRoles.Customer))
        {
            if (request.CustomerId != User.GetUserId())
                throw AppException.NotFound("Không tìm thấy yêu cầu hỗ trợ");
            return;
        }

        await access.EnsureAssignedAsync(User.GetUserId(), request.FacilityId, ct);
    }
}
