# API frontend đang chờ backend

Frontend (nhánh `frontend-figma-review`) đã có màn hình cho các chức năng dưới đây, theo Figma. Bản demo (`VITE_MOCK=true`, `frontend/src/mock/server.ts`) đã giả lập đúng các API này để chạy thử.
Khi chạy với backend thật mà API chưa có (404/405), màn hình báo "đang chờ backend" và không bị lỗi trang.

Quy ước chung giống các API hiện có:
- Ngày dạng `yyyy-MM-dd` (`DateOnly`). Thời điểm dạng ISO-8601.
- Tiền là số nguyên VND.
- Lỗi trả `{ "message": "..." }` bằng tiếng Việt, với mã 400 (dữ liệu sai), 403, 404 hoặc 409 (xung đột trạng thái).

---

## 1. Tạm ngưng hợp đồng giữa kỳ — Figma 96:10415, màn `/my-units/:id/suspend`

Quy tắc frontend đang áp dụng (đề xuất, backend chốt lại):

| Quy tắc | Giá trị |
|---|---|
| Số ngày tạm ngưng | 30 – 90 ngày (tính cả ngày đầu và ngày cuối) |
| Ngày bắt đầu | sớm nhất là hôm nay + 3 ngày |
| Ngày kết thúc | trước `Contract.EndDate` |
| Phí giữ kho | `round(MonthlyRentFee / 30 × số ngày × 30% / 1000) × 1000` |
| Ngày hết hạn mới (khi được duyệt) | `EndDate + số ngày` |
| Điều kiện | hợp đồng `Active`; không có yêu cầu tạm ngưng `Pending/Approved/Active`; không có gia hạn `Pending` |
| Trong thời gian tạm ngưng | cổng từ chối vào kho; không phát hành hóa đơn `MONTHLY_RENT`; thay bằng 1 hóa đơn phí giữ kho |

### Bảng gợi ý `ContractSuspensions`
`SuspensionID, ContractID, StartDate, EndDate, Days, Reason NVARCHAR(100), Notes NVARCHAR(500) NULL, Status VARCHAR(20) ('Pending','Approved','Rejected','Cancelled','Active','Completed'), HoldingFee, NewEndDate, RequestedAt, ReviewedByStaffID NULL, ReviewedAt NULL, ReviewNotes NVARCHAR(500) NULL, InvoiceID NULL`

### API phía khách (Customer, chỉ hợp đồng của mình)
- `GET /api/contracts/{id}/suspensions` → `ContractSuspensionDto[]`, mới nhất trước.
- `POST /api/contracts/{id}/suspensions`
  - Body: `{ startDate, endDate, reason: string (bắt buộc, ≤100), notes?: string (≤500) }`.
  - Trả về `ContractSuspensionDto` với `status = "Pending"`.
  - Lỗi 400 khi sai quy tắc ngày. Lỗi 409 khi đã có yêu cầu đang xử lý hoặc đang có gia hạn chờ thanh toán.
- `DELETE /api/contracts/{id}/suspensions/{suspensionId}` → 204. Chỉ hủy được khi đang `Pending` (lỗi 409 nếu không).

`ContractSuspensionDto`:
```json
{ "suspensionId": 1, "contractId": 1, "startDate": "2026-10-29", "endDate": "2026-12-12", "days": 45,
  "reason": "Đi công tác / học tập xa", "notes": null, "status": "Pending", "holdingFee": 540000,
  "newEndDate": "2027-06-10", "requestedAt": "2026-10-26T17:08:00", "reviewNotes": null }
```

### Phía nhân viên (chưa có màn, làm sau)
- `GET /api/facilities/{facilityId}/suspensions?status=Pending`
- `POST /api/facilities/{facilityId}/suspensions/{id}/review`
  - Body: `{ approve: bool, notes?: string }`. Khi từ chối thì `notes` bắt buộc.
  - Khi duyệt: lập hóa đơn phí giữ kho; tới ngày bắt đầu thì chuyển `Active` (khóa ra vào); hết thời gian thì `Completed` và cộng ngày vào `EndDate`.

---

## 2. Bảo mật tài khoản — Figma 96:10597, màn `/account/security` (đã bỏ phần OTP)

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

## 3. Gia hạn hợp đồng giữa kỳ — Figma 96:10226, màn `/my-units/:id/renew`
Dùng API có sẵn (`GET/POST /api/contracts/{id}/renewals`), không cần làm thêm.
`RenewalDto.InvoiceId` đã được dùng để mở thẳng hóa đơn gia hạn.

## 4. Xác nhận policy hợp đồng — Figma 96:11044 / 110:362, màn `/my-units/:id/policy`
Hiện lưu xác nhận trên trình duyệt. Nếu muốn lưu vào database:
- `POST /api/contracts/{id}/policy-acknowledgements`, body `{ termsVersion }`.
- `GET` cùng đường dẫn, trả `{ acknowledgedAt, termsVersion } | null`.
