using System.Data;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Services;

/// <summary>
/// Manages items stored inside rented storage units, enforces cumulative 3D dimension and volume bounds,
/// and lets facility staff confirm partial or full item removals.
/// </summary>
public class StoredItemService(
    SelfStorageDbContext db,
    CloudinaryImageService cloudinary,
    TimeProvider clock)
{
    private static readonly CultureInfo ViCulture = CultureInfo.GetCultureInfo("vi-VN");
    private DateTime Now => clock.GetLocalNow().DateTime;

    public readonly record struct ItemDimensionSpec(
        string Name,
        int Quantity,
        decimal LengthCm,
        decimal WidthCm,
        decimal HeightCm);

    public Task<ContractInventoryDto> GetCustomerInventoryAsync(
        int customerId, int contractId, string? status, bool includeHistory, CancellationToken ct) =>
        GetInventoryInternalAsync(
            db.Contracts
                .Include(c => c.Unit).ThenInclude(u => u.UnitType)
                .Where(c => c.ContractId == contractId && c.CustomerId == customerId),
            status, includeHistory, ct);

    public async Task<ContractInventoryDto> GetFacilityInventoryAsync(
        int staffId, int facilityId, int contractId, string? status, bool includeHistory, CancellationToken ct)
    {
        var assigned = await db.FacilityStaffAssignments
            .AnyAsync(a => a.StaffId == staffId && a.FacilityId == facilityId && a.Status == "Active", ct);
        if (!assigned)
            throw AppException.Forbidden("Bạn không được phân công tại cơ sở này");

        return await GetInventoryInternalAsync(
            db.Contracts
                .Include(c => c.Unit).ThenInclude(u => u.UnitType)
                .Where(c => c.ContractId == contractId && c.Unit.FacilityId == facilityId),
            status, includeHistory, ct);
    }

    public Task<ContractInventoryDto> GetAdminInventoryAsync(
        int contractId, string? status, bool includeHistory, CancellationToken ct) =>
        GetInventoryInternalAsync(
            db.Contracts
                .Include(c => c.Unit).ThenInclude(u => u.UnitType)
                .Where(c => c.ContractId == contractId),
            status, includeHistory, ct);

    public async Task<StoredItemDto> UpdateCustomerItemAsync(
        int customerId, int contractId, long itemId, UpdateStoredItemRequest req, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var item = await db.StoredItems
            .Include(i => i.VisitRegistration)
            .Include(i => i.Contract).ThenInclude(c => c.Unit).ThenInclude(u => u.UnitType)
            .FirstOrDefaultAsync(i => i.StoredItemId == itemId && i.ContractId == contractId
                && i.Contract.CustomerId == customerId, ct)
            ?? throw AppException.NotFound("Không tìm thấy món đồ trong kho");

        if (item.Status is not (StoredItemStatus.PendingMoveIn or StoredItemStatus.Stored))
            throw AppException.Conflict("Chỉ có thể chỉnh sửa món đồ đang chờ đưa vào hoặc đang lưu trong kho");
        if (item.Contract.Status is not (ContractStatus.Active or ContractStatus.Overdue))
            throw AppException.Conflict("Hợp đồng đã kết thúc, không thể chỉnh sửa đồ vật");

        var itemName = (req.ItemName ?? string.Empty).Trim();
        if (itemName.Length == 0)
            throw AppException.BadRequest("Vui lòng nhập tên món đồ");
        var imageUrl = NormalizeAndValidateImageUrl(req.ImageUrl);

        var dimsOrQtyChanged = item.Quantity != req.Quantity
            || item.LengthCm != req.LengthCm
            || item.WidthCm != req.WidthCm
            || item.HeightCm != req.HeightCm;

        if (dimsOrQtyChanged)
        {
            if (item.Status != StoredItemStatus.PendingMoveIn)
                throw AppException.Conflict(
                    "Món đồ đã xác nhận đưa vào kho; không thể tự đổi số lượng hoặc kích thước. Vui lòng liên hệ nhân viên cơ sở khi lấy/thêm đồ");
            if (item.VisitRegistration is not null && item.VisitRegistration.Status != "Pending")
                throw AppException.Conflict(
                    "Lịch chuyển đồ đã được xử lý nên không thể thay đổi kích thước hoặc số lượng");

            var otherSpecs = await db.StoredItems
                .Where(i => i.ContractId == contractId
                    && i.StoredItemId != itemId
                    && (i.Status == StoredItemStatus.Stored || i.Status == StoredItemStatus.PendingMoveIn))
                .Select(i => new ItemDimensionSpec(i.ItemName, i.Quantity, i.LengthCm, i.WidthCm, i.HeightCm))
                .ToListAsync(ct);

            ValidateItemsAgainstUnit(
                item.Contract.Unit.UnitType,
                [new ItemDimensionSpec(itemName, req.Quantity, req.LengthCm, req.WidthCm, req.HeightCm)],
                otherSpecs);
        }

        item.ItemName = itemName;
        item.Category = NormalizeOptional(req.Category, 80);
        item.Notes = NormalizeOptional(req.Notes, 300);
        item.ImageUrl = imageUrl;
        if (dimsOrQtyChanged)
        {
            item.Quantity = req.Quantity;
            item.LengthCm = req.LengthCm;
            item.WidthCm = req.WidthCm;
            item.HeightCm = req.HeightCm;
        }
        item.UpdatedAt = Now;

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToDto(item);
    }

    public async Task DeleteCustomerPendingItemAsync(
        int customerId, int contractId, long itemId, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var item = await db.StoredItems
            .Include(i => i.VisitRegistration)
            .Include(i => i.Contract)
            .FirstOrDefaultAsync(i => i.StoredItemId == itemId && i.ContractId == contractId
                && i.Contract.CustomerId == customerId, ct)
            ?? throw AppException.NotFound("Không tìm thấy món đồ trong kho");

        if (item.Status != StoredItemStatus.PendingMoveIn)
            throw AppException.Conflict("Chỉ có thể xóa món đồ đang chờ đưa vào kho");
        if (item.VisitRegistration is not null && item.VisitRegistration.Status != "Pending")
            throw AppException.Conflict("Chỉ có thể xóa món đồ khi lịch chuyển đồ đang ở trạng thái chờ duyệt");

        if (item.VisitRegistrationId is long regId)
        {
            var otherCount = await db.StoredItems.CountAsync(i => i.VisitRegistrationId == regId
                && i.StoredItemId != itemId
                && i.Status == StoredItemStatus.PendingMoveIn, ct);
            if (otherCount == 0)
                throw AppException.Conflict(
                    "Đây là món đồ cuối cùng của lịch chuyển đồ; vui lòng hủy cả lịch chuyển đồ nếu không gửi nữa");
        }

        item.Status = StoredItemStatus.Cancelled;
        item.UpdatedAt = Now;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<StoredItemDto> UploadCustomerItemImageAsync(
        int customerId, int contractId, long itemId, IFormFile? file, CancellationToken ct)
    {
        var existing = await db.StoredItems.AsNoTracking()
            .Where(i => i.StoredItemId == itemId && i.ContractId == contractId
                && i.Contract.CustomerId == customerId)
            .Select(i => new
            {
                i.StoredItemId,
                i.Status,
                ContractStatus = i.Contract.Status,
            })
            .FirstOrDefaultAsync(ct)
            ?? throw AppException.NotFound("Không tìm thấy món đồ trong kho");

        if (existing.Status is not (StoredItemStatus.PendingMoveIn or StoredItemStatus.Stored))
            throw AppException.Conflict("Chỉ có thể tải ảnh cho món đồ đang chờ đưa vào hoặc đang lưu trong kho");
        if (existing.ContractStatus is not (ContractStatus.Active or ContractStatus.Overdue))
            throw AppException.Conflict("Hợp đồng đã kết thúc, không thể cập nhật ảnh đồ vật");

        // Upload outside the serializable transaction so external HTTP I/O never holds DB locks.
        var imageUrl = await cloudinary.UploadImageAsync(file, "stored-items", $"item-{itemId}", ct);

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var item = await db.StoredItems
            .Include(i => i.Contract)
            .FirstOrDefaultAsync(i => i.StoredItemId == itemId && i.ContractId == contractId
                && i.Contract.CustomerId == customerId, ct)
            ?? throw AppException.NotFound("Không tìm thấy món đồ trong kho");

        if (item.Status is not (StoredItemStatus.PendingMoveIn or StoredItemStatus.Stored))
            throw AppException.Conflict("Chỉ có thể tải ảnh cho món đồ đang chờ đưa vào hoặc đang lưu trong kho");
        if (item.Contract.Status is not (ContractStatus.Active or ContractStatus.Overdue))
            throw AppException.Conflict("Hợp đồng đã kết thúc, không thể cập nhật ảnh đồ vật");

        item.ImageUrl = imageUrl;
        item.UpdatedAt = Now;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToDto(item);
    }

    public async Task<StoredItemDto> AddFacilityItemAsync(
        int staffId, int facilityId, int contractId, MoveInItemRequest req, CancellationToken ct)
    {
        var assigned = await db.FacilityStaffAssignments
            .AnyAsync(a => a.StaffId == staffId && a.FacilityId == facilityId && a.Status == "Active", ct);
        if (!assigned)
            throw AppException.Forbidden("Bạn không được phân công tại cơ sở này");

        var itemName = (req.Name ?? string.Empty).Trim();
        if (itemName.Length == 0)
            throw AppException.BadRequest("Vui lòng nhập tên món đồ");
        var imageUrl = NormalizeAndValidateImageUrl(req.ImageUrl);

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var contract = await db.Contracts
            .Include(c => c.Unit).ThenInclude(u => u.UnitType)
            .FirstOrDefaultAsync(c => c.ContractId == contractId && c.Unit.FacilityId == facilityId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng tại cơ sở này");

        if (contract.Status != ContractStatus.Active)
            throw AppException.Conflict("Chỉ có thể ghi nhận thêm đồ cho hợp đồng đang hoạt động");
        if (contract.Unit.Status is UnitStatus.OverdueLocked or UnitStatus.UnderMaintenance)
            throw AppException.Conflict("Kho đang bị khóa hoặc bảo trì nên không thể đưa thêm đồ vào");

        var existingActive = await db.StoredItems
            .Where(i => i.ContractId == contractId
                && (i.Status == StoredItemStatus.Stored || i.Status == StoredItemStatus.PendingMoveIn))
            .Select(i => new ItemDimensionSpec(i.ItemName, i.Quantity, i.LengthCm, i.WidthCm, i.HeightCm))
            .ToListAsync(ct);

        ValidateItemsAgainstUnit(
            contract.Unit.UnitType,
            [new ItemDimensionSpec(itemName, req.Quantity, req.LengthCm, req.WidthCm, req.HeightCm)],
            existingActive);

        var now = Now;
        var item = new StoredItem
        {
            ContractId = contractId,
            ItemName = itemName,
            Category = NormalizeOptional(req.Category, 80),
            Quantity = req.Quantity,
            LengthCm = req.LengthCm,
            WidthCm = req.WidthCm,
            HeightCm = req.HeightCm,
            Status = StoredItemStatus.Stored,
            Notes = NormalizeOptional(req.Notes, 300),
            ImageUrl = imageUrl,
            CreatedByUserId = staffId,
            CreatedAt = now,
            MovedInAt = now,
        };
        db.StoredItems.Add(item);
        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = staffId,
            Action = "StoredItemAddedByStaff",
            Details = $"Contract {contract.ContractNumber}: added {item.Quantity}x {item.ItemName} ({item.LengthCm:0.##}x{item.WidthCm:0.##}x{item.HeightCm:0.##} cm)",
            CreatedAt = now,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToDto(item);
    }

    public async Task<StoredItemDto> RemoveFacilityItemAsync(
        int staffId, int facilityId, int contractId, long itemId, RemoveStoredItemRequest req, CancellationToken ct)
    {
        var assigned = await db.FacilityStaffAssignments
            .AnyAsync(a => a.StaffId == staffId && a.FacilityId == facilityId && a.Status == "Active", ct);
        if (!assigned)
            throw AppException.Forbidden("Bạn không được phân công tại cơ sở này");

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var item = await db.StoredItems
            .Include(i => i.Contract).ThenInclude(c => c.Unit)
            .FirstOrDefaultAsync(i => i.StoredItemId == itemId && i.ContractId == contractId
                && i.Contract.Unit.FacilityId == facilityId, ct)
            ?? throw AppException.NotFound("Không tìm thấy món đồ trong kho tại cơ sở này");

        if (item.Status != StoredItemStatus.Stored)
            throw AppException.Conflict("Chỉ có thể xác nhận lấy ra đối với đồ đang lưu trong kho");
        if (req.QuantityToRemove < 1 || req.QuantityToRemove > item.Quantity)
            throw AppException.BadRequest($"Số lượng lấy ra phải từ 1 đến {item.Quantity}");

        var now = Now;
        var extraNote = NormalizeOptional(req.Notes, 300);
        StoredItem resultItem;
        if (req.QuantityToRemove == item.Quantity)
        {
            item.Status = StoredItemStatus.Removed;
            item.RemovedAt = now;
            item.UpdatedAt = now;
            if (extraNote is not null)
                item.Notes = CombineNotes(item.Notes, extraNote);
            db.ActivityLogs.Add(new ActivityLog
            {
                UserId = staffId,
                Action = "StoredItemRemoved",
                Details = $"Contract {item.Contract.ContractNumber}: removed {item.Quantity}x {item.ItemName} (item #{item.StoredItemId})",
                CreatedAt = now,
            });
            resultItem = item;
        }
        else
        {
            item.Quantity -= req.QuantityToRemove;
            item.UpdatedAt = now;
            var removedSplit = new StoredItem
            {
                ContractId = item.ContractId,
                VisitRegistrationId = item.VisitRegistrationId,
                ItemName = item.ItemName,
                Category = item.Category,
                Quantity = req.QuantityToRemove,
                LengthCm = item.LengthCm,
                WidthCm = item.WidthCm,
                HeightCm = item.HeightCm,
                Status = StoredItemStatus.Removed,
                Notes = extraNote ?? item.Notes,
                ImageUrl = item.ImageUrl,
                CreatedByUserId = staffId,
                CreatedAt = now,
                MovedInAt = item.MovedInAt,
                RemovedAt = now,
                UpdatedAt = now,
            };
            db.StoredItems.Add(removedSplit);
            db.ActivityLogs.Add(new ActivityLog
            {
                UserId = staffId,
                Action = "StoredItemPartiallyRemoved",
                Details = $"Contract {item.Contract.ContractNumber}: removed {req.QuantityToRemove}x {item.ItemName} (remaining {item.Quantity})",
                CreatedAt = now,
            });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return ToDto(removedSplit);
        }

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToDto(resultItem);
    }

    public static void ValidateItemsAgainstUnit(
        UnitType unitType,
        IReadOnlyList<ItemDimensionSpec> newItems,
        IReadOnlyList<ItemDimensionSpec> existingActiveItems)
    {
        var unitLengthCm = unitType.LengthMeters * 100m;
        var unitWidthCm = unitType.WidthMeters * 100m;
        var unitHeightCm = unitType.HeightMeters * 100m;
        var shortFloorCm = Math.Min(unitLengthCm, unitWidthCm);
        var longFloorCm = Math.Max(unitLengthCm, unitWidthCm);
        var unitFloorAreaCm2 = unitLengthCm * unitWidthCm;
        var unitVolumeM3 = unitType.VolumeCubicMeters > 0m
            ? unitType.VolumeCubicMeters
            : unitType.LengthMeters * unitType.WidthMeters * unitType.HeightMeters;
        var unitSizeLabel = string.Format(
            ViCulture,
            "{0:0.##}×{1:0.##}×{2:0.##} cm",
            unitLengthCm,
            unitWidthCm,
            unitHeightCm);

        decimal totalVolumeM3 = 0m;
        long centerBlockers = 0;
        decimal tallFootprintCm2 = 0m;

        foreach (var existing in existingActiveItems)
        {
            var minExistingCm = Math.Min(existing.LengthCm, existing.WidthCm);
            if (minExistingCm > unitLengthCm / 2m && minExistingCm > unitWidthCm / 2m
                && existing.HeightCm > unitHeightCm / 2m)
                centerBlockers += existing.Quantity;
            if (existing.HeightCm > unitHeightCm / 2m)
                tallFootprintCm2 += existing.LengthCm * existing.WidthCm * existing.Quantity;
            totalVolumeM3 += (existing.LengthCm * existing.WidthCm * existing.HeightCm / 1_000_000m) * existing.Quantity;
        }

        foreach (var item in newItems)
        {
            var name = (item.Name ?? string.Empty).Trim();
            if (name.Length == 0)
                throw AppException.BadRequest("Vui lòng nhập tên cho tất cả món đồ khai báo");
            if (item.Quantity is < 1 or > 999)
                throw AppException.BadRequest($"Số lượng của \"{name}\" phải từ 1 đến 999");
            if (item.LengthCm is < 0.1m or > 2000m
                || item.WidthCm is < 0.1m or > 2000m
                || item.HeightCm is < 0.1m or > 2000m)
                throw AppException.BadRequest(
                    $"Kích thước \"{name}\" không hợp lệ (mỗi chiều từ 0,1 đến 2000 cm)");
            if (decimal.Round(item.LengthCm, 2) != item.LengthCm
                || decimal.Round(item.WidthCm, 2) != item.WidthCm
                || decimal.Round(item.HeightCm, 2) != item.HeightCm)
                throw AppException.BadRequest(
                    $"Kích thước \"{name}\" chỉ hỗ trợ tối đa 2 chữ số thập phân (cm)");

            if (item.HeightCm > unitHeightCm)
            {
                throw AppException.BadRequest(string.Format(
                    ViCulture,
                    "Món \"{0}\" cao {1:0.##} cm vượt quá chiều cao kho ({2:0.##} cm)",
                    name,
                    item.HeightCm,
                    unitHeightCm));
            }

            var minItemCm = Math.Min(item.LengthCm, item.WidthCm);
            var maxItemCm = Math.Max(item.LengthCm, item.WidthCm);
            if (minItemCm > shortFloorCm || maxItemCm > longFloorCm)
            {
                throw AppException.BadRequest(string.Format(
                    ViCulture,
                    "Món \"{0}\" (đáy {1:0.##}×{2:0.##} cm) tràn quá chiều dài/rộng mặt sàn kho ({3:0.##}×{4:0.##} cm)",
                    name,
                    item.LengthCm,
                    item.WidthCm,
                    unitLengthCm,
                    unitWidthCm));
            }

            var maxQty = MaxItemQuantity(
                unitLengthCm, unitWidthCm, unitHeightCm,
                item.LengthCm, item.WidthCm, item.HeightCm);
            if (item.Quantity > maxQty)
            {
                var itemSize = string.Format(
                    ViCulture,
                    "{0:0.##}×{1:0.##}×{2:0.##} cm",
                    item.LengthCm,
                    item.WidthCm,
                    item.HeightCm);
                throw AppException.BadRequest(
                    $"Kho ({unitSizeLabel}) chỉ xếp được tối đa {maxQty} món \"{name}\" ({itemSize})");
            }

            if (minItemCm > unitLengthCm / 2m && minItemCm > unitWidthCm / 2m && item.HeightCm > unitHeightCm / 2m)
                centerBlockers += item.Quantity;
            if (item.HeightCm > unitHeightCm / 2m)
                tallFootprintCm2 += item.LengthCm * item.WidthCm * item.Quantity;

            totalVolumeM3 += (item.LengthCm * item.WidthCm * item.HeightCm / 1_000_000m) * item.Quantity;
        }

        if (centerBlockers > 1)
        {
            throw AppException.BadRequest(
                $"Các món đồ (bao gồm đồ đang lưu/chờ đưa vào) có kích thước lớn hơn một nửa chiều kho ({unitSizeLabel}) không thể xếp cùng lúc quá 1 món");
        }

        if (tallFootprintCm2 > unitFloorAreaCm2)
        {
            throw AppException.BadRequest(string.Format(
                ViCulture,
                "Tổng diện tích đáy các món cao quá nửa kho ({0:0.###} m²) vượt quá diện tích sàn kho ({1:0.###} m²)",
                tallFootprintCm2 / 10_000m,
                unitFloorAreaCm2 / 10_000m));
        }

        if (totalVolumeM3 > unitVolumeM3)
        {
            throw AppException.BadRequest(string.Format(
                ViCulture,
                "Tổng thể tích đồ trong kho và đồ mới khai báo ({0:0.###} m³) vượt quá sức chứa của kho ({1:0.###} m³)",
                totalVolumeM3,
                unitVolumeM3));
        }
    }

    public static string? NormalizeAndValidateImageUrl(string? imageUrl)
    {
        if (string.IsNullOrWhiteSpace(imageUrl))
            return null;

        var trimmed = imageUrl.Trim();
        if (trimmed.Length > 500)
            throw AppException.BadRequest("Đường dẫn ảnh tối đa 500 ký tự");
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw AppException.BadRequest("Đường dẫn ảnh phải là URL http:// hoặc https:// hợp lệ");
        return trimmed;
    }

    public static StoredItemDto ToDto(StoredItem item) =>
        new(
            item.StoredItemId,
            item.ContractId,
            item.VisitRegistrationId,
            item.ItemName,
            item.Category,
            item.Quantity,
            item.LengthCm,
            item.WidthCm,
            item.HeightCm,
            item.UnitVolumeM3,
            item.TotalVolumeM3,
            item.Status,
            item.Notes,
            item.ImageUrl,
            item.CreatedAt,
            item.MovedInAt,
            item.RemovedAt,
            item.UpdatedAt);

    private async Task<ContractInventoryDto> GetInventoryInternalAsync(
        IQueryable<Contract> contractQuery,
        string? status,
        bool includeHistory,
        CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(status)
            && status is not (StoredItemStatus.PendingMoveIn or StoredItemStatus.Stored
                or StoredItemStatus.Removed or StoredItemStatus.Cancelled))
            throw AppException.BadRequest("Trạng thái đồ vật không hợp lệ");

        var contract = await contractQuery.FirstOrDefaultAsync(ct)
            ?? throw AppException.NotFound("Không tìm thấy hợp đồng");

        var unitType = contract.Unit.UnitType;
        var unitLengthCm = unitType.LengthMeters * 100m;
        var unitWidthCm = unitType.WidthMeters * 100m;
        var unitHeightCm = unitType.HeightMeters * 100m;
        var unitVolumeM3 = unitType.VolumeCubicMeters > 0m
            ? unitType.VolumeCubicMeters
            : unitType.LengthMeters * unitType.WidthMeters * unitType.HeightMeters;

        var allItems = await db.StoredItems
            .Where(i => i.ContractId == contract.ContractId)
            .OrderByDescending(i => i.StoredItemId)
            .ToListAsync(ct);

        var storedVolumeM3 = allItems
            .Where(i => i.Status == StoredItemStatus.Stored)
            .Sum(i => i.TotalVolumeM3);
        var pendingVolumeM3 = allItems
            .Where(i => i.Status == StoredItemStatus.PendingMoveIn)
            .Sum(i => i.TotalVolumeM3);
        var activeVolumeM3 = storedVolumeM3 + pendingVolumeM3;
        var remainingVolumeM3 = Math.Max(0m, unitVolumeM3 - activeVolumeM3);
        var occupancyPercent = unitVolumeM3 > 0m
            ? decimal.Round(activeVolumeM3 / unitVolumeM3 * 100m, 2, MidpointRounding.AwayFromZero)
            : 0m;

        IEnumerable<StoredItem> filtered = allItems;
        if (!string.IsNullOrWhiteSpace(status))
            filtered = filtered.Where(i => i.Status == status);
        else if (!includeHistory)
            filtered = filtered.Where(i => i.Status is StoredItemStatus.Stored or StoredItemStatus.PendingMoveIn);

        return new ContractInventoryDto(
            contract.ContractId,
            contract.ContractNumber,
            contract.Unit.UnitCode,
            unitLengthCm,
            unitWidthCm,
            unitHeightCm,
            unitVolumeM3,
            storedVolumeM3,
            pendingVolumeM3,
            remainingVolumeM3,
            occupancyPercent,
            filtered.Select(ToDto).ToList());
    }

    private static long MaxItemQuantity(
        decimal unitL, decimal unitW, decimal unitH,
        decimal itemL, decimal itemW, decimal itemH)
    {
        var maxLayers = (long)decimal.Floor(unitH / itemH);
        var shortFloor = Math.Min(unitL, unitW);
        var longFloor = Math.Max(unitL, unitW);
        var minItem = Math.Min(itemL, itemW);
        var maxItem = Math.Max(itemL, itemW);

        long maxPerLayer;
        if (maxItem > shortFloor)
        {
            maxPerLayer = (long)decimal.Floor(longFloor / maxItem) * (long)decimal.Floor(shortFloor / minItem);
        }
        else if (itemL == itemW)
        {
            maxPerLayer = (long)decimal.Floor(unitL / itemL) * (long)decimal.Floor(unitW / itemL);
        }
        else if (itemL + itemW > longFloor)
        {
            var orient1 = (long)decimal.Floor(unitL / itemL) * (long)decimal.Floor(unitW / itemW);
            var orient2 = (long)decimal.Floor(unitL / itemW) * (long)decimal.Floor(unitW / itemL);
            maxPerLayer = Math.Max(orient1, orient2);
        }
        else
        {
            var areaBound = (long)decimal.Floor((unitL * unitW) / (itemL * itemW));
            var gridBound = (long)decimal.Floor(unitL / minItem) * (long)decimal.Floor(unitW / minItem);
            maxPerLayer = Math.Min(areaBound, gridBound);
        }

        return maxLayers * maxPerLayer;
    }

    private static string? NormalizeOptional(string? value, int maxLen)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length > maxLen ? trimmed[..maxLen] : trimmed;
    }

    private static string CombineNotes(string? existing, string extra) =>
        string.IsNullOrWhiteSpace(existing)
            ? extra
            : existing.Length + 3 + extra.Length <= 300
                ? $"{existing} | {extra}"
                : $"{existing} | {extra}"[..300];
}
