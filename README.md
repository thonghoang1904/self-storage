# Self-Storage: Hệ thống cho thuê và quản lý kho tự phục vụ

Khung dự án gồm:

| Thư mục | Nội dung |
|---|---|
| `database/` | `01_schema.sql`: đúng file `sqlquery.txt` của bạn, **không sửa gì**. Backend dùng nguyên database này. |
| `backend/` | ASP.NET Core Web API (.NET 10), EF Core cho SQL Server, Swagger, JWT |
| `frontend/` | React + TypeScript (Vite): trang khách hàng và màn hình nhân viên trực cổng |

## 1. Luồng ra vào kho (chỉ nhân viên xác thực, không dùng PIN)

Theo sơ đồ trạng thái "Unit Access Visit": `PendingVerification → InsideFacility → Exited`, hoặc `PendingVerification → Denied`.

```
Khách / người được ủy quyền          Nhân viên trực cổng (màn hình "Cổng ra vào")
───────────────────────────          ────────────────────────────────────────────
Đến cổng, đưa CCCD ────────────────► Tìm theo mã kho, số CCCD, SĐT hoặc số hợp đồng
  (PendingVerification:               Hệ thống hiện: hợp đồng, kho, chủ HĐ + CCCD trong hồ sơ,
   chỉ là bước trên màn hình,         người được ủy quyền, ai đang ở trong, và cảnh báo
   chưa ghi vào database)             (HĐ đã kết thúc, quá hạn/kho bị khóa, kho bảo trì)
                                     Chọn đúng người, gõ số CCCD trên thẻ
                                       ├─ khớp và không có cảnh báo → "Cho vào"
                                       │    → AccessRecords: Granted, EntryTime, VerifiedByStaffID
                                       └─ không khớp / có cảnh báo → "Ghi nhận từ chối"
                                            → AccessRecords: Denied + DenyReason
Khách ra về ───────────────────────► Bấm "Xác nhận ra" → ExitTime, ExitConfirmedByStaffID
```

Quy tắc chính:

- Không có PIN hay thiết bị kiosk. Mọi lượt vào đều do nhân viên xác nhận và ghi tên nhân viên vào `VerifiedByStaffID`.
- Người được ủy quyền (bảng `AuthorizedPersons`) vào thay chủ hợp đồng bằng **CCCD của chính họ**. Khách tự thêm/thu hồi người được ủy quyền trong trang "Kho của tôi".
- Với CCCD, nhân viên phải gõ số trên thẻ và hệ thống so khớp với hồ sơ, tránh việc bấm "Cho vào" mà không kiểm tra. Hộ chiếu/bằng lái thì nhân viên tự đối chiếu.
- Hệ thống không cho bấm "Cho vào" khi hợp đồng đã kết thúc/chưa bắt đầu, quá hạn thanh toán, kho bị khóa hoặc đang bảo trì; mã cảnh báo trùng với `DenyReason` để nhân viên ghi nhận từ chối luôn.
- Một người đang ở trong kho thì không thể được cho vào lần nữa trước khi xác nhận ra.
- Nhân viên chỉ thao tác ở cơ sở mình được phân công (`FacilityStaffAssignments`).
- Lượt bị từ chối được lưu với `EntryTime` là thời điểm khách đến, `ExitTime` để trống, đúng ràng buộc `CK_AccessRec_DenyReason` của database.

## 2. API (xem đầy đủ trên Swagger)

| Nhóm | Endpoint | Ai dùng |
|---|---|---|
| Đăng nhập | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Mọi người |
| Danh mục | `GET /api/facilities`, `GET /api/unit-types`, `GET /api/facilities/{id}/availability`, `GET /api/facilities/{id}/units` | Công khai |
| Đặt kho | `POST /api/reservations`, `GET /api/reservations/my` | Khách |
| Nhận kho | `GET /api/facilities/{id}/reservations`, `POST /api/reservations/{id}/confirm-deposit`, `POST /api/reservations/{id}/check-in` | Nhân viên, quản lý cơ sở |
| Kho của tôi | `GET /api/contracts/my`, `GET/POST/DELETE /api/contracts/{id}/authorized-persons`, `GET /api/contracts/{id}/access-history` | Khách |
| Cổng | `GET /api/gate/my-facilities`, `GET /api/gate/facilities/{id}/lookup?q=`, `POST /api/gate/facilities/{id}/entries`, `POST /api/gate/facilities/{id}/denials`, `GET /api/gate/facilities/{id}/inside`, `GET /api/gate/facilities/{id}/today`, `POST /api/gate/access-records/{id}/exit` | Nhân viên, quản lý cơ sở |

## 3. Chạy thử trên máy

Cần: .NET SDK 10, Node.js 20+, SQL Server (Express/Developer đều được).

**Database.** Mở SSMS, chạy `database/01_schema.sql`. Nếu dùng `sqlcmd` thì thêm `-I` (bật QUOTED_IDENTIFIER, cần cho filtered index):

```
sqlcmd -S localhost -E -C -I -i database/01_schema.sql
```

**Backend.** Sửa chuỗi kết nối `ConnectionStrings:SelfStorageDB` trong `backend/SelfStorage.Api/appsettings.json` nếu cần (mặc định: `localhost`, Windows Authentication).

```
cd backend/SelfStorage.Api
dotnet run
```

Mở Swagger tại http://localhost:5080/swagger. Ở môi trường Development, nếu database chưa có cơ sở nào, backend tự tạo dữ liệu mẫu:

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `customer1` | `Demo@12345` | Khách, đang thuê kho `B-01`, CCCD `079200000123` |
| `staff1` | `Demo@12345` | Nhân viên cơ sở Quận 7 |
| `manager1` | `Demo@12345` | Quản lý cơ sở Quận 7 |
| `admin` | `Demo@12345` | Quản trị hệ thống |

Người được ủy quyền mẫu của `B-01`: Nguyễn Thị Người Nhà, CCCD `079300000456`.

**Frontend.**

```
cd frontend
npm install
npm run dev
```

Mở http://localhost:5173. Khách đăng nhập/đăng ký; nhân viên đăng nhập sẽ vào thẳng "Cổng ra vào".

Thử nhanh: đăng nhập `staff1`, tìm `B-01` (hoặc `079300000456`), chọn người, gõ đúng số CCCD, bấm "Xác nhận đúng người, cho vào"; người đó hiện trong "Đang ở trong kho", bấm "Xác nhận ra" khi họ về.

**Cấu hình quan trọng khi triển khai thật** (`appsettings.json`): `Jwt:SigningKey` (chuỗi bí mật dài), `Cors:Origins` (địa chỉ frontend).

## 4. Đã có và chưa có

Đã có: đăng ký/đăng nhập theo vai trò, xem cơ sở và loại kho, đặt kho, nhân viên xác nhận cọc và bàn giao (tạo hợp đồng), người được ủy quyền, toàn bộ luồng ra vào do nhân viên xác thực và lịch sử.

Chưa làm (bảng đã có trong SQL, cần thêm entity vào `SelfStorageDbContext` và controller):

- Hóa đơn, thanh toán VNPay/MoMo (`Invoices`, `InvoiceDetails`, `Payments`). Hiện nhân viên bấm "Đã nhận cọc" thay cho thanh toán.
- Biên bản bàn giao/trả kho (`HandoverRecords`), gia hạn (`ContractRenewals`), xử lý quá hạn và tự khóa kho (`OverdueRecords`).
- Chính sách, phí, khuyến mãi (`RentalPolicies`, `FeeConfigurations`, `Promotions`). Hiện tiền cọc mặc định bằng 1 tháng.
- Bảo trì, yêu cầu hỗ trợ (`MaintenanceRecords`, `SupportRequests`, `SupportUpdates`), nhật ký hoạt động (`ActivityLogs`).
- Màn hình cho quản lý vận hành, quản trị hệ thống, báo cáo doanh thu.
- Giao diện chưa đối chiếu với file Figma (mình không mở được Figma từ môi trường này). Nếu bạn xuất ảnh các màn hình và gửi vào đây, mình sẽ chỉnh theo.
