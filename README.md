# Self-Storage: Hệ thống cho thuê và quản lý kho tự phục vụ

Khung dự án gồm:

| Thư mục | Nội dung |
|---|---|
| `database/` | `01_schema.sql`: đúng file `sqlquery.txt` của bạn, **không sửa gì**. Backend dùng nguyên database này. |
| `backend/` | ASP.NET Core Web API (.NET 10), EF Core cho SQL Server, Swagger, JWT |
| `frontend/` | React + TypeScript (Vite): trang khách hàng và màn hình nhân viên trực cổng |

## 1. Luồng ra vào kho (chỉ xác thực bằng CCCD, không dùng PIN)

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
- Chỉ chấp nhận CCCD (`VerificationMethod` luôn là `CitizenID`). Nhân viên phải gõ số trên thẻ và hệ thống so khớp với hồ sơ, tránh việc bấm "Cho vào" mà không kiểm tra. Người chưa có CCCD trong hồ sơ thì không thể được cho vào.
- Hệ thống không cho bấm "Cho vào" khi hợp đồng đã kết thúc/chưa bắt đầu, quá hạn thanh toán, kho bị khóa hoặc đang bảo trì; mã cảnh báo trùng với `DenyReason` để nhân viên ghi nhận từ chối luôn.
- Một người đang ở trong kho thì không thể được cho vào lần nữa trước khi xác nhận ra.
- Nhân viên chỉ thao tác ở cơ sở mình được phân công (`FacilityStaffAssignments`).
- Lượt bị từ chối được lưu với `EntryTime` là thời điểm khách đến, `ExitTime` để trống, đúng ràng buộc `CK_AccessRec_DenyReason` của database.

## 2. API (xem đầy đủ trên Swagger)

| Nhóm | Endpoint | Ai dùng |
|---|---|---|
| Tài khoản | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` | Mọi người |
| Danh mục | `GET /api/facilities`, `GET /api/unit-types`, `GET /api/facilities/{id}/availability`, `GET /api/facilities/{id}/units` | Công khai |
| Đặt kho | `POST /api/reservations`, `GET /api/reservations/my` | Khách |
| Nhận kho | `GET /api/facilities/{id}/reservations`, `POST /api/reservations/{id}/confirm-deposit`, `POST /api/reservations/{id}/check-in` | Nhân viên, quản lý cơ sở |
| Hợp đồng | `GET /api/contracts/my`, `GET /api/contracts/{id}`, `POST /api/contracts/{id}/renewals`, `GET /api/contracts/{id}/renewals`, `GET/POST/DELETE /api/contracts/{id}/authorized-persons`, `GET /api/contracts/{id}/access-history` | Khách |
| Gia hạn | `GET /api/contracts/facilities/{facilityId}/renewals`, `POST /api/contracts/renewals/{renewalId}/confirm-payment`, `POST /api/contracts/renewals/{renewalId}/reject` | Nhân viên, quản lý cơ sở |
| Trả kho/quá hạn | `POST /api/contracts/{id}/return`, `GET /api/contracts/facilities/{facilityId}/overdue` | Nhân viên, quản lý cơ sở |
| Hóa đơn/thanh toán | `GET /api/invoices/my`, `GET /api/invoices/{id}`, `POST /api/invoices/{id}/checkout/vnpay`, `POST /api/invoices/{id}/checkout/momo` | Khách |
| Thu tiền tại cơ sở | `GET /api/invoices/facilities/{facilityId}`, `POST /api/invoices/{id}/payments` | Nhân viên, quản lý cơ sở |
| Hoàn cọc | `POST /api/contracts/{id}/deposit-refunds` | Nhân viên, quản lý cơ sở |
| Callback thanh toán | `GET /api/payments/vnpay/ipn`, `GET /api/payments/vnpay/return`, `POST /api/payments/momo/ipn`, `GET /api/payments/momo/return` | VNPay/MoMo |
| Hỗ trợ | `POST /api/support-requests`, `GET /api/support-requests/my`, `GET /api/support-requests/{requestId}/updates`, `GET /api/support-requests/{requestId}/checklist`, `PUT /api/support-requests/{requestId}/checklist/{itemId}`, `GET /api/support-requests/facilities/{facilityId}`, `PUT /api/support-requests/{requestId}` | Khách; nhân viên, quản lý cơ sở |
| Cổng | `GET /api/gate/my-facilities`, `GET /api/gate/facilities/{id}/lookup?q=`, `POST /api/gate/facilities/{id}/entries`, `POST /api/gate/facilities/{id}/denials`, `GET /api/gate/facilities/{id}/inside`, `GET /api/gate/facilities/{id}/today`, `POST /api/gate/access-records/{id}/exit` | Nhân viên, quản lý cơ sở |

Quy tắc hợp đồng: cọc ban đầu bằng một tháng tiền thuê; khách gửi yêu cầu gia hạn trong 7 ngày trước ngày hết hạn, nhân viên xác nhận đã thu phí để kích hoạt; lịch trả kho từ 20:00 ngày hết hạn. Nếu chưa trả sau 24 giờ, dịch vụ nền khóa kho và tính phí mỗi ngày theo `MonthlyRentFee / 30`, cấn trừ vào cọc; chi tiết hợp đồng trả về số dư cọc và khoản phí còn phải thu. Bàn giao/trả kho và yêu cầu hỗ trợ được ghi nhận để nhân viên xử lý tại cơ sở được phân công.

Checklist ticket được tạo theo loại sự cố khi khách gửi yêu cầu. Khách và nhân viên cơ sở được phân công xem checklist; nhân viên tiếp nhận ticket trước khi cập nhật từng mục qua `PUT /api/support-requests/{requestId}/checklist/{itemId}`. API chuyển ticket sang `Resolved` chỉ thành công khi tất cả mục đã hoàn tất; mọi cập nhật checklist được lưu vào lịch sử ticket.

API checklist:

```http
GET /api/support-requests/{requestId}/checklist
PUT /api/support-requests/{requestId}/checklist/{itemId}
Content-Type: application/json

{ "isCompleted": true, "notes": "Đã thử cùng khách, khóa hoạt động bình thường." }
```

Khách chỉ xem checklist của ticket mình; nhân viên/quản lý chỉ xem và cập nhật ticket tại cơ sở được phân công. Mục checklist bắt đầu chưa hoàn thành; khi nhân viên đánh dấu hoàn tất, hệ thống lưu người thực hiện, thời gian và ghi chú. Trạng thái ticket đi theo `Open` → `InProgress` → `Resolved` → `Closed`, và chỉ được chuyển sang `Resolved` sau khi hoàn thành tất cả mục checklist.

Hóa đơn cọc được tạo cùng lúc đặt kho; hóa đơn gia hạn được tạo cùng yêu cầu gia hạn. Nhân viên chỉ ghi nhận thanh toán tiền mặt/chuyển khoản đã thực nhận, đủ đúng số dư hóa đơn; các mã giao dịch được kiểm tra không trùng. Khách có thể khởi tạo thanh toán VNPay hoặc MoMo; hóa đơn chỉ được đánh dấu đã trả sau khi callback/IPN được xác minh chữ ký, mã đơn và số tiền. IPN là nguồn xác nhận chính thức, không tin trạng thái trên trang chuyển hướng. Khi trả kho, phần phí quá hạn vượt cọc được tạo thành hóa đơn; nhân viên ghi nhận khoản hoàn cọc, không được hoàn quá số dư sau khi khấu trừ phí.

## 3. Chạy thử trên máy

Cần: .NET SDK 10, Node.js 20+, SQL Server (Express/Developer đều được).

**Database.** Mở SSMS, chạy `database/01_schema.sql`. Nếu dùng `sqlcmd` thì thêm `-I` (bật QUOTED_IDENTIFIER, cần cho filtered index) và `-f 65001` (đọc file dạng UTF-8; thiếu tham số này tiếng Việt trong dữ liệu mẫu sẽ bị lỗi font):

```
sqlcmd -S .\SQLEXPRESS -U sa -C -I -f 65001 -i database/01_schema.sql
```

`sqlcmd` sẽ hỏi mật khẩu. Nếu dùng SQL Server instance khác, thay `.\SQLEXPRESS` bằng tên server/instance tương ứng.

Sau khi đã tạo database theo script trên, chạy migration billing bổ sung liên kết hóa đơn cọc với đơn đặt kho và hóa đơn gia hạn với yêu cầu gia hạn. Script an toàn để chạy lại:

```
sqlcmd -S .\SQLEXPRESS -U sa -C -I -d SelfStorageDB -i database/02_billing_reservation_links.sql
sqlcmd -S .\SQLEXPRESS -U sa -C -I -d SelfStorageDB -i database/03_payment_concurrency.sql
sqlcmd -S .\SQLEXPRESS -U sa -C -I -d SelfStorageDB -i database/04_support_checklists.sql
```

Khi database đã tồn tại, chạy migration `02`, `03`, `04` theo thứ tự — không chạy lại `01_schema.sql` vì script khởi tạo sẽ xóa và tạo lại dữ liệu. Migration `03` thêm index hỗ trợ kiểm tra giữ chỗ và ngăn mã giao dịch/lượt vào kho đang hoạt động bị ghi trùng. Migration `04` tạo checklist cho ticket hiện có và cho các ticket mới.

**Backend.** Chuỗi kết nối mặc định trong `appsettings.json` dùng Windows Authentication. Để dùng SQL Authentication cho môi trường Development, lưu chuỗi kết nối bằng User Secrets (không ghi mật khẩu vào file trong repo):

```
dotnet user-secrets set "ConnectionStrings:SelfStorageDB" "Server=.\SQLEXPRESS;Database=SelfStorageDB;User Id=sa;Password=<mat-khau-sa>;TrustServerCertificate=True" --project backend\SelfStorage.Api\SelfStorage.Api.csproj
```

Thay `<mat-khau-sa>` bằng mật khẩu của tài khoản `sa`. User Secrets đã được khởi tạo cho project; cấu hình này chỉ áp dụng trên máy hiện tại khi chạy Development.

**Bật SMTP Gmail để gửi email reset mật khẩu thật (Windows/PowerShell):**

1. Đăng nhập Gmail bằng tài khoản sẽ gửi email. Vào **Google Account → Security & sign-in → 2-Step Verification** và bật xác minh 2 bước.
2. Trong mục **Security & sign-in**, mở **App passwords** (có thể tìm “App passwords” trong trang Google Account), tạo app password, ví dụ tên `Self-Storage API`. Google sẽ hiện mã gồm 16 ký tự. Dùng mã này làm SMTP password, **không dùng mật khẩu đăng nhập Gmail**. Nếu Google không hiển thị App passwords, tài khoản đó chưa đủ điều kiện tạo app password.
3. Mở PowerShell tại thư mục repo, thay hai chỗ `<gmail-cua-ban>` và `<app-password-16-ky-tu>` bằng thông tin của bạn, rồi chạy:

```powershell
$project = "backend\SelfStorage.Api\SelfStorage.Api.csproj"
dotnet user-secrets set "Smtp:Host" "smtp.gmail.com" --project $project
dotnet user-secrets set "Smtp:Port" "587" --project $project
dotnet user-secrets set "Smtp:Username" "<gmail-cua-ban>" --project $project
dotnet user-secrets set "Smtp:Password" "<app-password-16-ky-tu>" --project $project
dotnet user-secrets set "Smtp:FromAddress" "<gmail-cua-ban>" --project $project
dotnet user-secrets set "Smtp:FromName" "Self-Storage" --project $project
dotnet user-secrets set "Smtp:EnableSsl" "true" --project $project
```

User Secrets lưu ở máy bạn, không nằm trong `appsettings.json` hay Git. Không gửi App Password lên chat hoặc commit vào repo. Dùng port `587` với STARTTLS như cấu hình trên.

4. Khởi động lại API (`dotnet run --project backend\SelfStorage.Api\SelfStorage.Api.csproj`). Mở http://localhost:5080/swagger, gọi `POST /api/auth/forgot-password` với email thật đã đăng ký trong `Users`, ví dụ:

```json
{
  "email": "email-ban-co-the-mo-hop-thu@example.com"
}
```

Mở hộp thư đến (kiểm tra cả Spam), tìm email **“Đặt lại mật khẩu tài khoản Self-Storage”** và sao chép token. Gọi `POST /api/auth/reset-password`:

```json
{
  "token": "token-sao-chep-tu-email",
  "newPassword": "MatKhauMoiAnToan123!"
}
```

Yêu cầu email luôn trả thông báo chung, dù email chưa đăng ký; chỉ tài khoản đang hoạt động mới nhận thư. Token sống 30 phút, dùng một lần. Hai endpoint reset bị giới hạn 5 lần mỗi 15 phút trên mỗi IP. Tài khoản demo có địa chỉ `@example.com` nên không nhận được thư; hãy dùng một tài khoản có email thật mà bạn kiểm soát.

```
cd backend/SelfStorage.Api
dotnet run
```

Mở Swagger tại http://localhost:5080/swagger. Đăng nhập qua `POST /api/auth/login`, sao chép riêng giá trị `token` trong response, bấm **Authorize** và dán JWT nguyên bản (không thêm `Bearer `; Swagger tự thêm tiền tố này). Nếu dán cả tiền tố, request sẽ thành `Bearer Bearer ...` và bị trả về `401`.

Ở môi trường Development, nếu database chưa có cơ sở nào, backend tự tạo dữ liệu mẫu:

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

### Bật thanh toán thử nghiệm VNPay và MoMo

Tích hợp hiện dùng API sandbox. Không gửi các khóa merchant qua chat và không ghi chúng vào `appsettings.json`; lưu bằng User Secrets:

1. Đăng ký sandbox merchant để lấy thông tin kết nối:
   - [VNPay Sandbox](https://sandbox.vnpayment.vn/devreg/) — `TmnCode` và `HashSecret`.
   - [MoMo Developer](https://developers.momo.vn/) — `PartnerCode`, `AccessKey` và `SecretKey`.
2. Cổng cần gọi được callback trên API qua HTTPS công khai. Khi chạy local, dùng một HTTPS tunnel (ví dụ ngrok) trỏ đến cổng API `5080`; đặt `PublicBaseUrl` thành URL HTTPS được cấp. Không mở SQL Server ra internet.
3. Mở PowerShell tại repo và điền URL/credentials của chính merchant sandbox của bạn:

```powershell
$project = "backend\SelfStorage.Api\SelfStorage.Api.csproj"
dotnet user-secrets set "PaymentGateways:PublicBaseUrl" "https://<api-public-url>" --project $project
dotnet user-secrets set "PaymentGateways:FrontendReturnUrl" "http://localhost:5173/payment-result" --project $project
dotnet user-secrets set "PaymentGateways:VnPay:Enabled" "true" --project $project
dotnet user-secrets set "PaymentGateways:VnPay:TmnCode" "<vnpay-tmn-code>" --project $project
dotnet user-secrets set "PaymentGateways:VnPay:HashSecret" "<vnpay-hash-secret>" --project $project
dotnet user-secrets set "PaymentGateways:Momo:Enabled" "true" --project $project
dotnet user-secrets set "PaymentGateways:Momo:PartnerCode" "<momo-partner-code>" --project $project
dotnet user-secrets set "PaymentGateways:Momo:AccessKey" "<momo-access-key>" --project $project
dotnet user-secrets set "PaymentGateways:Momo:SecretKey" "<momo-secret-key>" --project $project
```

4. Đăng ký VNPay IPN là `https://<api-public-url>/api/payments/vnpay/ipn` trong merchant sandbox. MoMo nhận `https://<api-public-url>/api/payments/momo/ipn` trong từng yêu cầu tạo giao dịch. Hai URL `/return` đưa trình duyệt quay về `FrontendReturnUrl`; chúng không tự xác nhận hóa đơn.
5. Đăng nhập với tài khoản customer, lấy `InvoiceId` từ `GET /api/invoices/my`, rồi gọi một trong hai endpoint bằng JWT:

```http
POST /api/invoices/{invoiceId}/checkout/vnpay
POST /api/invoices/{invoiceId}/checkout/momo
```

Response trả `paymentUrl`; giao diện ở mục **Hóa đơn** tự chuyển khách tới cổng để hoàn tất sandbox. Khi cổng đưa khách về `/payment-result`, trang hiển thị trạng thái hóa đơn; IPN đã xác thực là nguồn cập nhật cuối cùng. Mỗi hóa đơn chỉ cho phép một giao dịch `Pending` tại một thời điểm; giao dịch chưa nhận callback cần đối soát trước khi có thể khởi tạo giao dịch khác.

Tài liệu giao thức: [VNPay PAY API](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html), [MoMo One-Time Checkout](https://developers.momo.vn/v3/docs/payment/api/wallet/onetime/) và [MoMo IPN](https://developers.momo.vn/v3/docs/payment/api/result-handling/notification/). Chỉ đưa hệ thống thật vào sử dụng sau khi thay sandbox URL/credentials bằng cấu hình production do merchant cấp và kiểm thử IPN qua HTTPS.

## 4. Đã có và chưa có

Đã có: đăng ký/đăng nhập/đặt lại mật khẩu qua email theo vai trò, xem cơ sở và loại kho, đặt kho kèm hóa đơn cọc, nhân viên ghi nhận thu tiền và bàn giao (tạo hợp đồng), hóa đơn gia hạn và xác nhận thanh toán, lịch sử hóa đơn/thanh toán, hoàn cọc sau đối soát phí, chi tiết hợp đồng, bàn giao trả kho, tự động khóa/tính phí quá hạn, yêu cầu hỗ trợ và theo dõi xử lý, người được ủy quyền, toàn bộ luồng ra vào do nhân viên xác thực và lịch sử.

Chưa làm:

- Chưa có merchant credentials để chạy giao dịch sandbox tại môi trường này; cần đăng ký merchant và cấu hình User Secrets theo hướng dẫn ở trên.
- Chính sách, phí, khuyến mãi (`RentalPolicies`, `FeeConfigurations`, `Promotions`). Hiện tiền cọc mặc định bằng 1 tháng.
- Bảo trì (`MaintenanceRecords`), nhật ký hoạt động (`ActivityLogs`).
- Màn hình cho quản lý vận hành, quản trị hệ thống, báo cáo doanh thu.
- Giao diện chưa đối chiếu với file Figma (mình không mở được Figma từ môi trường này). Nếu bạn xuất ảnh các màn hình và gửi vào đây, mình sẽ chỉnh theo.
