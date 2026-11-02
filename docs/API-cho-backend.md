# API frontend đang chờ backend

Frontend (nhánh `frontend-figma-review`) đã có màn hình cho các chức năng dưới đây, theo Figma. Bản demo (`VITE_MOCK=true`, `frontend/src/mock/server.ts`) đã giả lập đúng các API này để chạy thử.
Khi chạy với backend thật mà API chưa có (404/405), màn hình báo "đang chờ backend" và không bị lỗi trang.

Quy ước chung giống các API hiện có:
- Ngày dạng `yyyy-MM-dd` (`DateOnly`). Thời điểm dạng ISO-8601.
- Tiền là số nguyên VND.
- Lỗi trả `{ "message": "..." }` bằng tiếng Việt, với mã 400 (dữ liệu sai), 403, 404 hoặc 409 (xung đột trạng thái).

---

## 1. Bảo mật tài khoản — Figma 96:10597, màn `/account/security` (đã bỏ phần OTP)

Đăng nhập là đủ (mọi vai trò), chỉ thao tác trên tài khoản của chính mình.

| API | Mô tả |
|---|---|
| `GET /api/auth/me/profile` | `{ userId, username, fullName, email, phoneNumber, citizenId, createdAt }` |
| `GET /api/auth/me/security-settings` | `{ accessAlerts: bool, newDeviceAlerts: bool, paymentEmails: bool }`; mặc định đều `true` |
| `PUT /api/auth/me/security-settings` | Body như trên, trả lại bản đã lưu. Ghi ActivityLog `SECURITY_SETTINGS` |
| `GET /api/auth/me/sessions` | `[{ sessionId: string, device: string, location: string?, lastActiveAt, current: bool }]` |
| `DELETE /api/auth/me/sessions/{sessionId}` | Đăng xuất 1 thiết bị; không cho xóa phiên hiện tại (400). Ghi `SESSION_REVOKED` |
| `POST /api/auth/me/sessions/revoke-others` | Đăng xuất mọi thiết bị trừ phiên hiện tại |
| `POST /api/auth/change-password` | Body `{ currentPassword, newPassword (8–100) }`. Sai mật khẩu hiện tại → 400 "Mật khẩu hiện tại không đúng" và ghi `PASSWORD_CHANGE_FAILED`. Thành công thì ghi `PASSWORD_CHANGED` và nên thu hồi các phiên khác |
| `GET /api/auth/me/activity` | 100 dòng ActivityLog mới nhất của chính mình: `[{ logId, category, action, details, ipAddress, createdAt, result }]` |

Giá trị dùng trong `GET /api/auth/me/activity`:
- `category`: `Login | Password | Settings | Session | Contract`.
- `result`: `Success | Warning | Failed`.
- `action` là chữ tiếng Việt để hiển thị luôn, vd "Đăng nhập", "Đăng nhập thất bại", "Đổi mật khẩu".
- Login hiện chưa ghi ActivityLog. Nên ghi `LOGIN` và `LOGIN_FAILED` để có dữ liệu cho bảng này.

**Phiên đăng nhập:** JWT hiện không lưu phiên. Gợi ý thêm bảng `UserSessions (SessionID GUID, UserID, Device từ User-Agent, IpAddress, CreatedAt, LastActiveAt, RevokedAt)`. Đưa `sid` vào JWT, middleware từ chối token có phiên đã bị thu hồi.

Nhật ký ra vào kho và thanh toán trên màn này lấy từ API có sẵn (`/api/contracts/{id}/access-history`, `/api/invoices/my`), không cần làm thêm.

---

## 2. Gia hạn hợp đồng giữa kỳ — Figma 96:10226, màn `/my-units/:id/renew`
Dùng API có sẵn (`GET/POST /api/contracts/{id}/renewals`), không cần làm thêm.
`RenewalDto.InvoiceId` đã được dùng để mở thẳng hóa đơn gia hạn.

## 3. Xác nhận policy hợp đồng — Figma 96:11044 / 110:362, màn `/my-units/:id/policy`
Hiện lưu xác nhận trên trình duyệt. Nếu muốn lưu vào database:
- `POST /api/contracts/{id}/policy-acknowledgements`, body `{ termsVersion }`.
- `GET` cùng đường dẫn, trả `{ acknowledgedAt, termsVersion } | null`.

---

## 4. Admin xem được toàn bộ — đã sửa backend trong commit này
- `OperationsManagementController`: quyền đổi từ `OpsManager` thành `OpsManager + Admin`. Admin vào được Quản lý cơ sở, Giá, Chính sách thuê, Phí và Khuyến mãi (mục "Cài Đặt" và "Kho Lưu Trữ" của Admin).
- API mới `GET /api/operations/facilities/{facilityId}/units` (OpsManager, Admin): trả mọi kho của cơ sở kèm trạng thái, dùng lại `StorageUnitDto`. API danh mục công khai chỉ trả kho còn trống.
