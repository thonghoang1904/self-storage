# commentcodefix – Rà soát code, lý do ít commit và kế hoạch khắc phục

Ngày rà soát: 2026-10-25 · Nhánh: `main` (đồng bộ với `origin/main`)

> Kết luận nhanh: **code build được, TypeScript không lỗi, phân quyền và thanh toán làm khá chặt**. Số commit ít **không phải do thiếu logic** mà do (1) commit quá to, (2) một phần commit bị tính sai danh tính/nhánh trên GitHub, (3) còn một số việc nhỏ thật sự chưa làm (liệt kê ở mục 3–5) – chính các việc này là nguồn commit hợp lệ.

---

## 1. Vì sao commit của anh trên GitHub rất ít

Số liệu lấy từ `git log` của repo:

| Chỉ số | Giá trị |
|---|---|
| Tổng commit trên `main` | 65 (gồm cả merge) |
| Commit của anh trên `main` (email `typeofbyte@gmail.com`) | **9** |
| Commit email khác (`tdkhanh123z@gmail.com`, tên `Duykhanhzzz`) | 2 |
| Dòng thêm của anh | ~7.400 (≈ 820 dòng/commit) |
| Các commit lớn nhất của anh | 2.283 / 1.958 / 1.202 / 1.186 dòng |

Nguyên nhân:

1. **Commit dồn cục.** Mỗi commit gom 20–36 file (vd. `7a18b62` 36 file/2.283 dòng, `aec5da4` 23 file/1.958 dòng). Cả một tuần làm việc chỉ ra 1–2 commit. Ngày 2026-10-14 → 10-20 gần như không có commit nào.
2. **Hai danh tính Git.** Có commit dưới tên `Duykhanhzzz <tdkhanh123z@gmail.com>`. Nếu email này không được thêm vào tài khoản GitHub thì GitHub **không** tính là của anh.
3. **Chỉ commit trên `main` / nhánh mặc định mới lên biểu đồ đóng góp.** Anh có các nhánh `Khanh`, `frontend-web`, `backend-testing`; commit nằm ở nhánh chưa merge thì không hiện trên contribution graph. Nhánh `backend-testing` còn 1 commit chưa vào `main` (bộ test).
4. **Commit của agent/Copilot** (`Agent host session ... turn N`) nằm ở ref khác, không nằm trên `main` nên không tính.
5. **Commit gần đây chỉ là tài liệu** (`d1cf1b0`: README + script VNPay) và merge commit – dòng ít, giá trị thấp.
6. **Không có test trong `main`.** Thư mục `backend/SelfStorage.Api.Tests` trên máy chỉ còn `bin/obj`, file `.csproj`/`.cs` chỉ có ở nhánh `backend-testing`; `SelfStorage.slnx` không chứa project test.

## 2. Cách khắc phục (làm đúng, không "đẻ" commit rỗng)

1. **Chuẩn hóa danh tính**
   ```powershell
   git config --global user.name "duykhanhz"
   git config --global user.email "typeofbyte@gmail.com"
   ```
   Rồi vào GitHub → Settings → Emails, thêm luôn `tdkhanh123z@gmail.com` để các commit cũ được tính.
2. **Commit nhỏ, một mục đích** (≤ 1–5 file, ≤ ~150 dòng). Mỗi mục trong phần 3–5 dưới đây = 1 commit. Dùng `git add -p` để tách thay đổi.
3. **Dùng message chuẩn:** `fix(auth): ...`, `feat(api): ...`, `test(billing): ...`, `docs: ...`, `chore: ...`.
4. **Làm theo nhánh ngắn rồi merge vào `main`** (PR nhỏ, đừng để nhánh `Khanh`/`frontend-web` treo lâu). Ưu tiên "Rebase and merge"/"Squash" tuỳ nhóm; không mất commit cá nhân nếu rebase-merge.
5. **Merge `backend-testing` vào `main`** và thêm project test vào `SelfStorage.slnx`.
6. **Commit mỗi lần xong 1 việc nhỏ**, không chờ cuối ngày/cuối tuần.
7. Không commit file build (`bin/`, `obj/`, `node_modules/`, `dist/` – đã có trong `.gitignore`, hiện không có file nào bị track nhầm).

## 3. Review code & logic – các điểm cần sửa (mỗi điểm ≈ 1 commit)

Mức độ: 🔴 cao · 🟠 trung bình · 🟡 thấp.

### Bảo mật / xác thực
| # | Mức | Vị trí | Vấn đề | Đề xuất commit |
|---|---|---|---|---|
| 1 | 🔴 | `Program.cs` (rate limiter), `AuthController.Login/Register` | Rate limit chỉ có policy `password-reset`. `login`, `register`, `google` **không giới hạn** → dò mật khẩu/brute-force, spam tạo tài khoản. | `fix(auth): rate limit login/register/google` (thêm policy theo IP + tài khoản; có thể thêm khóa tạm sau N lần sai). |
| 2 | 🟠 | `SelfStorage.Api.csproj` | Build báo `NU1902/NU1903`: `System.Security.Cryptography.Pkcs 9.0.11` có lỗ hổng đã biết (gói phụ thuộc gián tiếp – chạy `dotnet list package --vulnerable --include-transitive` để biết gói nào kéo vào). | `chore(deps): nâng System.Security.Cryptography.Pkcs lên bản đã vá`. |
| 3 | 🟠 | `Program.cs` (JWT) | Nếu `Jwt:SigningKey` rỗng (appsettings mặc định để `""`) ở môi trường khác Development thì app lỗi khó hiểu; không kiểm tra độ dài tối thiểu (≥32 ký tự). | `fix(config): validate Jwt options on startup` (`ValidateOnStart`). |
| 4 | 🟠 | `appsettings.Development.json` | Signing key dev được commit. Chỉ dùng local nên chấp nhận được, nhưng cần ghi chú rõ & chuyển sang user-secrets để tránh ai đó dùng nhầm trên server. | `chore(config): chuyển signing key dev sang user-secrets`. |
| 5 | 🟠 | `AuthController.GoogleLogin` | Tự động liên kết tài khoản theo email nếu `EmailVerified` – chấp nhận được nhưng nên ghi log/thông báo email khi liên kết lần đầu. | `feat(auth): ghi ActivityLog khi liên kết Google`. |
| 6 | 🟡 | `Program.cs` | Chưa có `UseHttpsRedirection`, HSTS, security headers cho môi trường production. | `chore(security): bật HTTPS redirection/HSTS ngoài Development`. |
| 7 | 🟡 | `frontend/src/api.ts` | JWT lưu `localStorage` (rủi ro XSS). Nếu giữ thì cần CSP; tốt hơn là cookie HttpOnly. | `docs`/`refactor` tuỳ quyết định. |
| 8 | 🟡 | `Register` | Không chuẩn hóa email về chữ thường; không xác thực email (đã ghi trong `testswagger.md`). | `fix(auth): normalize email lowercase` + (tuỳ chọn) xác thực email. |

### Thanh toán / tiền
| # | Mức | Vị trí | Vấn đề | Đề xuất |
|---|---|---|---|---|
| 9 | 🔴 | `PaymentCallbacksController.VnPayIpn` → `BillingService.CompleteOnlinePaymentAsync` | Khi giao dịch không còn `Pending` hoặc lệch tiền, service ném `AppException.Conflict` → IPN trả **HTTP 409 + ProblemDetails** thay vì JSON `RspCode` mà VNPay yêu cầu (`02` đã xác nhận, `04` sai số tiền, `99` lỗi khác). VNPay sẽ gọi lại IPN nhiều lần. | `fix(payments): map lỗi IPN VNPay sang RspCode 02/04/99`. |
| 10 | 🟠 | `PaymentGatewayService.ProcessVnPayIpnAsync` | Chưa trả `RspCode=02` cho đơn đã xử lý (hiện trả `00`); chưa bắt exception chung. | Gộp vào commit #9. |
| 11 | 🟠 | `PaymentGatewayService.StartCheckoutAsync` / `OverdueService` | Payment `Pending` chỉ được dọn khi **hóa đơn cọc** hết hạn. Hóa đơn **gia hạn/tiền thuê tháng** có payment `Pending` mà khách bỏ dở sẽ không bao giờ hết hạn → staff không ghi nhận tiền mặt được (`BillingService.RecordStaffPaymentAsync` báo "đang có giao dịch trực tuyến chưa xác nhận"), khách không đổi được cổng. | `fix(billing): tự động hết hạn payment Pending sau 15–30 phút` (thêm vào `OverdueService`) + API hủy checkout. |
| 12 | 🟠 | `PaymentGatewayService.ProcessMomoIpnAsync` | IPN MoMo lỗi trả `400`/`409`; MoMo mong đợi `204`/`200` nhanh. Nên bắt lỗi nghiệp vụ, log, vẫn trả 204 cho trường hợp đã xử lý. | `fix(payments): idempotent MoMo IPN`. |
| 13 | 🟡 | `ReservationsController.Create` | `ReservationCode` dùng `Random.Shared.Next(100000, 999999)` + ngày → có thể trùng, vi phạm `UQ_Reservations_Code` → 500. `InvoiceNumber` tương tự (theo giây). | `fix(reservations): sinh mã bằng cơ chế chống trùng (retry hoặc sequence)`. |

### Nghiệp vụ đặt kho
| # | Mức | Vị trí | Vấn đề | Đề xuất |
|---|---|---|---|---|
| 14 | 🟠 | `ReservationsController.Create` | Không giới hạn số đơn `PendingDeposit` mỗi khách → một khách có thể giữ hết kho trống trong 1 loại kho tới hạn cọc (DoS nghiệp vụ). | `fix(reservations): giới hạn tối đa N đơn chờ cọc/khách`. |
| 15 | 🟠 | `ReservationsController.Create` (mã khuyến mãi) | Kiểm tra "chỉ lần đầu" chỉ dựa vào `Contracts`; khách có thể dùng cùng mã cho nhiều đơn đang chờ. | `fix(promotions): chặn dùng mã khi đã có reservation dùng mã đó`. |
| 16 | 🟠 | Toàn backend | Trộn `GetLocalNow()` (51 chỗ) và `GetUtcNow()` (25 chỗ). Server chạy múi giờ khác Việt Nam sẽ sai hạn cọc/20:00. Nhánh `backend-testing` có commit "business timezone defaults" chưa vào `main`. | Merge/cherry-pick commit timezone, thống nhất 1 `IBusinessClock`. |
| 17 | 🟡 | `ReservationsController.SetCheckInAppointment` | Giờ 20:00 viết cứng nhiều nơi (`new TimeOnly(20, 0)`). | `refactor: đưa giờ đóng cửa vào cấu hình`. |

### Hiệu năng / API
| # | Mức | Vị trí | Vấn đề | Đề xuất |
|---|---|---|---|---|
| 18 | 🟠 | `InvoicesController` (`Take(100)`/`Take(200)`), `FacilityOperationsController` (`Take(500)`), `ContractsController.my`, `ReservationsController.my/facility`, `SupportController`, `OperationsReports` | Danh sách cắt cứng hoặc không phân trang → mất dữ liệu cũ / chậm. Chỉ `AdminContracts`, `AdminEmailOutbox`, `SystemAdmin.users` có `page/pageSize`. | `feat(api): thêm page/pageSize + header tổng cho các danh sách còn lại` (mỗi controller 1 commit). |
| 19 | 🟡 | `Program.cs` | Chưa có health check (`/health`), chưa có API versioning, CORS rỗng mặc định ngoài Development. | `feat(api): thêm /health`, `docs: cấu hình CORS production`. |
| 20 | 🟡 | `AuthController.Login` | Dùng `FirstOrDefault` theo username phân biệt chữ hoa/thường tùy collation; nên chuẩn hóa. | Gộp commit #8. |

### Frontend
| # | Mức | Vị trí | Vấn đề |
|---|---|---|---|
| 21 | 🟡 | `npx tsc -b` | **Sạch lỗi.** |
| 22 | 🟡 | `npx oxlint` | Cảnh báo: gọi `Date`/`Date.now()` trong render (`Gate.tsx`, `StaffReturn.tsx`, `ContractDetail.tsx`) và `setState` đồng bộ trong `useEffect` (`StaffReturn.tsx`, `OpsFacilities.tsx`, `OpsPolicies.tsx`, `ContractDetail.tsx`, `Gate.tsx`). Mỗi file 1 commit `fix(lint): ...`. |
| 23 | 🟡 | `frontend/src/mock/server.ts` | Mock backend có thể lệch với API thật khi thêm endpoint mới – cần cập nhật song song. |

## 4. API còn thiếu → trạng thái triển khai

**Đã thêm (build thành công, đã smoke-test trên DB local):**

| Endpoint | Quyền | Ghi chú |
|---|---|---|
| `GET /api/auth/profile` | Đã đăng nhập | Hồ sơ đầy đủ |
| `PUT /api/auth/me` | Đã đăng nhập | Sửa họ tên, email, SĐT, địa chỉ (không đổi CCCD) |
| `POST /api/auth/change-password` | Đã đăng nhập | Cần mật khẩu hiện tại, có rate limit `password-reset` |
| `GET /api/reservations/{id}` | Khách | Chi tiết đơn đặt kho |
| `POST /api/reservations/{id}/cancel` | Khách | Hủy trực tiếp đơn **chưa cọc**; hủy hóa đơn cọc + giao dịch chờ |
| `GET /api/payments/my` | Khách | Lịch sử thanh toán, `page/pageSize/status`, header `X-Total-Count` |
| `GET /api/payments/{id}/status` | Khách | Dùng để poll sau khi quay về từ VNPay/MoMo |
| `POST /api/payments/{id}/cancel` | Khách | Chỉ hủy giao dịch `Pending` quá 30 phút (tránh hủy nhầm khi cổng vẫn đang xử lý) |
| `GET /api/invoices/{id}/receipt` | Khách | Hóa đơn HTML để in/“Save as PDF” (chưa thêm thư viện PDF) |
| `POST /api/invoices/{id}/cancel` | Staff/Manager | Chỉ hủy hóa đơn phụ thu `EXTRA_CHARGE` chưa thanh toán, có lý do + ghi log |
| `GET /api/support-requests/{id}` | Khách/Staff | Chi tiết ticket |
| `POST /api/support-requests/{id}/messages` | Khách/Staff | Thêm phản hồi vào timeline (ticket đã đóng thì từ chối) |
| `PUT /api/contracts/{id}/authorized-persons/{personId}` | Khách | Sửa họ tên, SĐT, quan hệ (không đổi CCCD) |
| `DELETE /api/facility-management/facilities/{facilityId}/units/{unitId}` | Manager | Chỉ xóa kho chưa từng có hợp đồng/hỗ trợ |
| `DELETE /api/operations/fees/{id}` | Ops | Từ chối nếu phí đã dùng trong hóa đơn |
| `DELETE /api/operations/promotions/{id}` | Ops | Từ chối nếu đã áp dụng (hãy tắt `IsActive`) |
| `DELETE /api/operations/rental-policies/{id}` | Ops | |
| `GET /api/admin/activity-logs` | Admin | Lọc `userId/action/from/to`, phân trang |
| `GET /api/admin/payments` | Admin | Lọc `status/method/search`, phân trang |
| `GET /api/admin/dashboard` | Admin | Số liệu tổng hệ thống |
| `GET /health`, `GET /health/ready` | Ẩn danh | Ready kiểm tra kết nối DB |

CORS đã expose header `X-Total-Count` để frontend đọc tổng số bản ghi.

**Chưa làm (cần thay đổi schema DB hoặc thư viện ngoài, nên bàn trước):** `logout`/`refresh token`, xác thực email, `notifications/my`, đối soát `requery` VNPay/MoMo, PDF thật, xóa cơ sở (hiện dùng trạng thái `Closed`). Frontend và `mock/server.ts` chưa gọi các API mới.

### Danh sách đề xuất gốc (để đối chiếu)

Danh sách endpoint hiện có đã được đối chiếu với các controller. Các chức năng sau **chưa có** tại thời điểm rà soát:

**Tài khoản / Auth**
- `POST /api/auth/change-password` (đổi mật khẩu khi đã đăng nhập; hiện chỉ có quên mật khẩu qua email).
- `PUT /api/auth/me` (khách tự sửa họ tên, SĐT; hiện chỉ Admin sửa qua `PUT /api/admin/users/{id}/profile`).
- `POST /api/auth/logout` / thu hồi token (JWT 480 phút, không có refresh token / blacklist).
- `POST /api/auth/refresh` (refresh token).
- Xác thực email khi đăng ký (`POST /api/auth/verify-email`, `resend`).

**Khách hàng**
- `GET /api/reservations/{id}` (chi tiết 1 đơn) và `DELETE/POST .../cancel` trực tiếp khi chưa cọc.
- `GET /api/payments/my` hoặc `GET /api/invoices/{id}/payments` (lịch sử thanh toán/trạng thái giao dịch) và `GET /api/payments/{id}/status` để frontend poll sau khi quay lại từ VNPay/MoMo.
- `POST /api/payments/{id}/cancel` (hủy checkout đang chờ – liên quan lỗi #11).
- `GET /api/invoices/{id}/pdf` (xuất hóa đơn/biên nhận).
- `GET /api/notifications/my` (thông báo trong ứng dụng; hiện chỉ có email outbox).
- `PUT /api/contracts/{id}/authorized-persons/{personId}` (sửa người được ủy quyền; hiện chỉ GET/POST/DELETE).
- `GET /api/support-requests/{id}` và `POST /api/support-requests/{id}/messages` (khách phản hồi thêm).

**Nhân viên / Quản lý cơ sở**
- `DELETE /api/facility-management/facilities/{facilityId}/units/{unitId}` (xóa/ngừng kho) – hiện chỉ có tạo/sửa/đổi trạng thái.
- `GET/PUT` chi tiết hợp đồng cho staff (`GET /api/contracts/facilities/{facilityId}/{id}`), hủy phụ thu (`DELETE .../extra-charges/{invoiceId}`).
- `POST /api/invoices/{id}/cancel` (hủy hóa đơn do nhập sai).

**Vận hành / Admin**
- `DELETE`/vô hiệu hóa cho `fees`, `promotions`, `rental-policies`, `facilities` (hiện chỉ GET/POST/PUT).
- `GET /api/admin/activity-logs` (toàn hệ thống; hiện chỉ theo từng user).
- `GET /api/admin/dashboard` (số liệu tổng hệ thống).
- `GET /api/admin/payments` + đối soát VNPay/MoMo (`POST /api/admin/payments/{id}/requery`).
- `GET /health`.

## 5. Test còn thiếu

- `main` **không có project test**; nhánh `backend-testing` chỉ có `ReservationStatusTests.cs`.
- Nên viết (mỗi file test = 1 commit):
  - `AuthControllerTests` (đăng ký trùng, sai mật khẩu, tài khoản bị khóa, reset token dùng 1 lần).
  - `PaymentGatewayServiceTests` (chữ ký VNPay/MoMo sai, sai số tiền, IPN lặp – idempotent).
  - `BillingServiceTests` (ghi nhận tiền mặt, hóa đơn cọc hết hạn, gia hạn).
  - `OverdueServiceTests` (hết hạn cọc, no-show, phụ phí quá hạn).
  - `ReservationsControllerTests` (hết kho, mã khuyến mãi, giới hạn đơn chờ cọc).
  - `AccessServiceTests` (CCCD, lịch vào kho, ra/vào trùng).
- Thêm vào `SelfStorage.slnx` và (tuỳ chọn) workflow GitHub Actions `dotnet build && dotnet test`, `npm run lint && npx tsc -b`.

## 6. Kế hoạch commit đề xuất (thứ tự ưu tiên)

1. `chore(git): chuẩn hóa user.email, thêm email phụ vào GitHub`
2. `merge: backend-testing vào main` + thêm test project vào slnx
3. `fix(payments): IPN VNPay trả RspCode đúng` (#9, #10)
4. `fix(payments): IPN MoMo idempotent` (#12)
5. `fix(billing): hết hạn payment Pending` (#11)
6. `feat(payments): GET /api/payments/{id}/status` + `POST .../cancel`
7. `fix(auth): rate limit login/register/google` (#1)
8. `chore(deps): vá System.Security.Cryptography.Pkcs` (#2)
9. `fix(config): validate Jwt options khi khởi động` (#3)
10. `fix(reservations): mã đơn chống trùng` (#13)
11. `fix(reservations): giới hạn đơn chờ cọc/khách` (#14)
12. `fix(promotions): chặn dùng lại mã khuyến mãi` (#15)
13. `refactor(time): thống nhất business timezone` (#16)
14. `feat(auth): change-password`, `PUT /auth/me`
15. `feat(api): phân trang` – tách theo từng controller (#18)
16. `feat(api): GET /health`
17. `test(...)` – mỗi nhóm test ở mục 5 một commit
18. `fix(lint): ...` – mỗi file frontend một commit (#22)
19. `docs: cập nhật README/swagger` sau mỗi nhóm API mới

Làm xong từng mục là commit + push ngay; như vậy số commit tự nhiên tăng, lịch sử rõ ràng và mỗi commit đều có giá trị thật.

## 7. Ghi chú kiểm tra đã chạy

- `dotnet build` (backend): **thành công, 0 lỗi, 4 cảnh báo** (NU1902/NU1903 về package Pkcs). *Lưu ý: build vào thư mục mặc định bị khóa file vì API đang chạy (PID 17160); đã build ra thư mục tạm.*
- `npx tsc -b` (frontend): không lỗi.
- `npx oxlint` (frontend): chỉ có cảnh báo (mục 3 – Frontend).
- Không có file `bin/obj/node_modules/dist` bị track trên git.
- Chưa chạy test tự động vì `main` không chứa project test.
