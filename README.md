# Self-Storage: Hệ thống cho thuê và quản lý kho tự phục vụ

Khung dự án gồm:

| Thư mục | Nội dung |
|---|---|
| `database/` | `01_schema.sql` (file `sqlquery.txt` của bạn, giữ nguyên) và `02_pin_access.sql` (bổ sung PIN và trạng thái chờ xác nhận) |
| `backend/` | ASP.NET Core Web API (.NET 10), EF Core cho SQL Server, Swagger, JWT |
| `frontend/` | React + TypeScript (Vite): trang khách hàng, màn hình nhân viên tại cổng, màn hình kiosk nhập PIN |

## 1. Luồng ra vào kho (PIN + nhân viên xác nhận danh tính)

```
Khách đến cổng                 Hệ thống                         Nhân viên trực cổng
──────────────                 ────────                         ───────────────────
Nhập mã kho + PIN ───────────► Kiểm tra PIN với hợp đồng
  (tablet kiosk)               • sai 5 lần → khóa PIN 15 phút
                               • hợp đồng quá hạn/bảo trì → báo gặp nhân viên
                               • đúng → tạo lượt ra vào "Pending"
Màn hình: "Xuất trình CCCD" ◄─┘                                  │
                                                                 ▼
                               Hiện yêu cầu chờ: tên chủ HĐ,   Xem CCCD thật của khách,
                               CCCD trong hồ sơ, danh sách      chọn người (chủ HĐ hoặc
                               người được ủy quyền              người được ủy quyền),
                                                                gõ số CCCD trên thẻ
                               So khớp số CCCD ◄──────────────── Bấm "Cho vào" / "Từ chối"
Màn hình: "Mời vào" ◄───────── Granted (lưu nhân viên duyệt, giờ vào)
  hoặc "Không được vào"        Denied (lưu lý do)
...
Khách ra về ─────────────────────────────────────────────────► Bấm "Xác nhận ra" (lưu giờ ra)
```

Quy tắc chính:

- PIN 6 số, gắn với **hợp đồng** (mỗi kho đang thuê một PIN), chỉ lưu dạng băm. Không chấp nhận PIN kiểu `111111`, `123456`.
- Khách tự đặt/đổi PIN trong trang "Kho của tôi". Quên PIN: nhân viên kiểm tra CCCD tại quầy rồi xóa PIN (`reset-pin`), khách đặt PIN mới.
- Người được ủy quyền dùng PIN của chủ hợp đồng nhưng phải xuất trình **CCCD của chính họ**; nhân viên chọn đúng người trên màn hình.
- Với CCCD, nhân viên phải gõ số trên thẻ và hệ thống so khớp với hồ sơ, tránh việc bấm "Cho vào" mà không kiểm tra.
- Yêu cầu chờ quá 15 phút tự hết hạn (`Denied / Expired`), khách nhập lại PIN.
- Kiosk xác thực bằng khóa thiết bị (`X-Kiosk-Key`), mỗi khóa gắn với một cơ sở, nên kiosk ở cơ sở A không mở được kho ở cơ sở B. Có giới hạn 20 lần/phút/kiosk.
- Nhân viên chỉ thấy và duyệt yêu cầu ở cơ sở mình được phân công (`FacilityStaffAssignments`).

### Thay đổi so với `sqlquery.txt`

Bảng `AccessRecords` gốc bắt buộc `VerifiedByStaffID` và chỉ có `Granted/Denied`, nên không lưu được bước "đã nhập PIN, đang chờ nhân viên". `02_pin_access.sql`:

- Thêm vào `Contracts`: `AccessPinHash`, `PinFailedAttempts`, `PinLockedUntil`, `PinUpdatedAt`.
- `AccessRecords`: thêm trạng thái `Pending`, cột `PinEnteredAt`, `VerifiedAt`; `VerifiedByStaffID` cho phép NULL khi đang chờ; thêm lý do `Expired`; mỗi hợp đồng chỉ có tối đa một yêu cầu đang chờ.

## 2. API (xem đầy đủ trên Swagger)

| Nhóm | Endpoint | Ai dùng |
|---|---|---|
| Đăng nhập | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Mọi người |
| Danh mục | `GET /api/facilities`, `GET /api/unit-types`, `GET /api/facilities/{id}/availability`, `GET /api/facilities/{id}/units` | Công khai |
| Đặt kho | `POST /api/reservations`, `GET /api/reservations/my` | Khách |
| Nhận kho | `GET /api/facilities/{id}/reservations`, `POST /api/reservations/{id}/confirm-deposit`, `POST /api/reservations/{id}/check-in` | Nhân viên, quản lý cơ sở |
| Kho của tôi | `GET /api/contracts/my`, `PUT /api/contracts/{id}/pin`, `GET/POST/DELETE /api/contracts/{id}/authorized-persons`, `GET /api/contracts/{id}/access-history` | Khách |
| Kiosk | `POST /api/kiosk/pin`, `GET /api/kiosk/requests/{id}` | Thiết bị kiosk (`X-Kiosk-Key`) |
| Cổng | `GET /api/gate/my-facilities`, `GET /api/gate/facilities/{id}/pending`, `GET /api/gate/facilities/{id}/inside`, `POST /api/gate/requests/{id}/approve`, `.../deny`, `.../exit`, `POST /api/gate/contracts/{id}/reset-pin` | Nhân viên, quản lý cơ sở |

## 3. Chạy thử trên máy

Cần: .NET SDK 10, Node.js 20+, SQL Server (Express/Developer đều được).

**Database.** Mở SSMS, chạy lần lượt `database/01_schema.sql` rồi `database/02_pin_access.sql`.
Nếu dùng `sqlcmd` thì thêm `-I` (bật QUOTED_IDENTIFIER, cần cho filtered index):

```
sqlcmd -S localhost -E -C -I -i database/01_schema.sql
sqlcmd -S localhost -E -C -I -i database/02_pin_access.sql
```

**Backend.** Sửa chuỗi kết nối `ConnectionStrings:SelfStorageDB` trong `backend/SelfStorage.Api/appsettings.json` nếu cần (mặc định: `localhost`, Windows Authentication).

```
cd backend/SelfStorage.Api
dotnet run
```

Mở Swagger tại http://localhost:5080/swagger. Ở môi trường Development, nếu database chưa có cơ sở nào, backend tự tạo dữ liệu mẫu:

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `customer1` | `Demo@12345` | Khách, đang thuê kho `B-01`, PIN `246810`, CCCD `079200000123` |
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

- http://localhost:5173 : khách đăng nhập/đăng ký, nhân viên đăng nhập để vào "Cổng ra vào".
- http://localhost:5173/kiosk : màn hình kiosk đặt ở cổng (mở trên tablet, toàn màn hình).

Thử nhanh: mở `/kiosk`, nhập `B-01` rồi `246810`; ở cửa sổ khác đăng nhập `staff1`, nhập CCCD `079200000123`, bấm cho vào; kiosk chuyển sang "Mời bạn vào kho".

**Cấu hình quan trọng khi triển khai thật** (`appsettings.json`): `Jwt:SigningKey` (chuỗi bí mật dài), `Kiosk:Devices` (mỗi kiosk một khóa riêng), `Cors:Origins` (địa chỉ frontend), `Access` (số lần nhập sai, thời gian khóa, thời gian chờ).

## 4. Đã có và chưa có

Đã có: đăng ký/đăng nhập theo vai trò, xem cơ sở và loại kho, đặt kho, nhân viên xác nhận cọc và bàn giao (tạo hợp đồng), PIN, người được ủy quyền, toàn bộ luồng ra vào và lịch sử.

Chưa làm (bảng đã có trong SQL, cần thêm entity vào `SelfStorageDbContext` và controller):

- Hóa đơn, thanh toán VNPay/MoMo (`Invoices`, `InvoiceDetails`, `Payments`). Hiện nhân viên bấm "Đã nhận cọc" thay cho thanh toán.
- Biên bản bàn giao/trả kho (`HandoverRecords`), gia hạn (`ContractRenewals`), xử lý quá hạn và tự khóa kho (`OverdueRecords`).
- Chính sách, phí, khuyến mãi (`RentalPolicies`, `FeeConfigurations`, `Promotions`). Hiện tiền cọc mặc định bằng 1 tháng.
- Bảo trì, yêu cầu hỗ trợ (`MaintenanceRecords`, `SupportRequests`, `SupportUpdates`), nhật ký hoạt động (`ActivityLogs`).
- Màn hình cho quản lý vận hành, quản trị hệ thống, báo cáo doanh thu.
- Giao diện chưa đối chiếu với file Figma (mình không mở được Figma từ môi trường này). Nếu bạn xuất ảnh các màn hình và gửi vào đây, mình sẽ chỉnh theo.
