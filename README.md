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
- Hệ thống không cho bấm "Cho vào" khi hợp đồng đã kết thúc/chưa bắt đầu, quá hạn, kho bị khóa hoặc đang bảo trì, hoặc khi còn hóa đơn tiền thuê/phụ thu chưa trả quá `MaxOverdueDaysBeforeLock` ngày sau hạn (khách phải thanh toán trước, kể cả khi đến dọn kho); mã cảnh báo trùng với `DenyReason` để nhân viên ghi nhận từ chối luôn.
- Vận hành 24/7: không giới hạn giờ ra vào. Nhân viên được ghi bù giờ vào kho tối đa 12 giờ trước (kể cả qua nửa đêm); `GET /api/gate/facilities/{id}/today` trả về các lượt trong 24 giờ gần nhất để ca đêm không bị cắt lúc 00:00.
- Nhân viên cập nhật CCCD cho khách sau khi kiểm tra thẻ: `PUT /api/gate/facilities/{id}/customers/{customerId}/citizen-id` (`customerId` có trong kết quả tra cứu). Khách không tự đổi được CCCD đã lưu.
- Một người đang ở trong kho thì không thể được cho vào lần nữa trước khi xác nhận ra.
- Nhân viên chỉ thao tác ở cơ sở mình được phân công (`FacilityStaffAssignments`).
- Lượt bị từ chối được lưu với `EntryTime` là thời điểm khách đến, `ExitTime` để trống, đúng ràng buộc `CK_AccessRec_DenyReason` của database.

## 2. API (xem đầy đủ trên Swagger)

| Nhóm | Endpoint | Ai dùng |
|---|---|---|
| Tài khoản | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `GET/PUT /api/auth/profile`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` | Mọi người |
| Danh mục | `GET /api/facilities`, `GET /api/unit-types`, `GET /api/facilities/{id}/availability`, `GET /api/facilities/{id}/units` | Công khai |
| Đặt kho | `POST /api/reservations`, `GET /api/reservations/my` | Khách |
| Nhận kho | `GET /api/facilities/{id}/reservations`, `POST /api/reservations/{id}/confirm-deposit`, `POST /api/reservations/{id}/check-in` | Nhân viên, quản lý cơ sở |
| Hợp đồng | `GET /api/contracts/my`, `GET /api/contracts/{id}`, `POST /api/contracts/{id}/renewals`, `GET /api/contracts/{id}/renewals`, `GET/POST/DELETE /api/contracts/{id}/authorized-persons`, `GET /api/contracts/{id}/access-history` | Khách (chi tiết và lịch sử: cả nhân viên cơ sở) |
| Gia hạn | `GET /api/contracts/facilities/{facilityId}/renewals`, `POST /api/contracts/renewals/{renewalId}/confirm-payment`, `POST /api/contracts/renewals/{renewalId}/reject` | Nhân viên, quản lý cơ sở |
| Trả kho/quá hạn | `POST /api/contracts/{id}/return`, `GET /api/contracts/facilities/{facilityId}/overdue`, `GET /api/contracts/facilities/{facilityId}/due?days=7` | Nhân viên, quản lý cơ sở |
| Hóa đơn/thanh toán | `GET /api/invoices/my`, `GET /api/invoices/{id}`, `POST /api/invoices/{id}/checkout/vnpay`, `POST /api/invoices/{id}/checkout/momo`, `POST /api/invoices/{id}/checkout/cancel` | Khách |
| Thu tiền tại cơ sở | `GET /api/invoices/facilities/{facilityId}`, `POST /api/invoices/{id}/payments` | Nhân viên, quản lý cơ sở |
| Hoàn tiền online không ghi nhận được | `GET /api/invoices/facilities/{facilityId}/refund-due`, `POST /api/invoices/payments/{paymentId}/refund` | Nhân viên, quản lý cơ sở |
| Hoàn cọc | `POST /api/contracts/{id}/deposit-refunds` | Nhân viên, quản lý cơ sở |
| Callback thanh toán | `GET /api/payments/vnpay/ipn`, `GET /api/payments/vnpay/return`, `POST /api/payments/momo/ipn`, `GET /api/payments/momo/return` | VNPay/MoMo |
| Hỗ trợ | `POST /api/support-requests`, `GET /api/support-requests/my`, `GET /api/support-requests/{requestId}/updates`, `GET /api/support-requests/{requestId}/checklist`, `PUT /api/support-requests/{requestId}/checklist/{itemId}`, `GET /api/support-requests/facilities/{facilityId}`, `PUT /api/support-requests/{requestId}` | Khách; nhân viên, quản lý cơ sở |
| Cổng | `GET /api/gate/my-facilities`, `GET /api/gate/facilities/{id}/lookup?q=`, `POST /api/gate/facilities/{id}/entries`, `POST /api/gate/facilities/{id}/denials`, `GET /api/gate/facilities/{id}/inside`, `GET /api/gate/facilities/{id}/today`, `POST /api/gate/access-records/{id}/exit`, `PUT /api/gate/facilities/{id}/customers/{customerId}/citizen-id` | Nhân viên, quản lý cơ sở |

Quy tắc hợp đồng: cọc theo `RentalPolicies.DepositPercent`, tính trên giá thuê cơ bản của loại kho. Khi bàn giao, tiền thuê hằng tháng lấy theo `StorageUnits.MonthlyPrice` của kho được giao (giá loại kho chỉ dùng khi kho chưa đặt giá); ưu đãi lần đầu được tính lại theo giá đó. Cơ sở vận hành 24/7 nên hợp đồng tính đến từng phút: hết hạn vào ngày kết thúc đúng giờ đã bàn giao (`Contracts.SignedDate`, ví dụ bàn giao 22:15 thì hết hạn 22:15), mỗi kỳ tiền thuê cũng bắt đầu từ giờ đó; quá `MaxOverdueDaysBeforeLock` ngày mà chưa gia hạn/trả kho thì dịch vụ nền khóa kho và tính phí theo `LATE_FEE_DAILY`, cấn trừ vào cọc; chi tiết hợp đồng trả về số dư cọc và khoản phí còn phải thu. Bàn giao/trả kho và yêu cầu hỗ trợ được ghi nhận để nhân viên xử lý tại cơ sở được phân công.

- **Bàn giao 24/7:** nhận kho và trả kho làm được bất kỳ giờ nào. Lịch hẹn nhận kho chỉ để sắp xếp, không chặn bàn giao; khách đến trước ngày dự kiến thì hợp đồng tính từ hôm nay. Không bàn giao được khi đơn đang có yêu cầu hủy chờ xử lý.
- **Giữ chỗ:** đơn mới chờ cọc trong `RentalPolicies.DepositPaymentHours` giờ (mặc định 24). Đơn đã cọc giữ kho đến hết ngày `ExpectedStartDate + 7`; quá hạn mà khách không đến, hệ thống tự hủy đơn và duyệt hoàn cọc trừ phí hủy (nhân viên chi tiền qua `cancellation-refunds`). Lịch hẹn nhận kho đặt được tới ngày đó.
- **Hủy đơn:** đơn chưa cọc hủy ngay khi khách gửi yêu cầu. Đơn đã cọc chờ nhân viên duyệt; được hoàn đủ nếu khách yêu cầu trong `CancellationGraceHours` giờ kể từ lúc đặt, sau đó trừ `CancellationFeePercent`.
- **Trả kho:** trả trước hạn được phép (ghi chú "trả kho trước hạn"). Khi trả kho: yêu cầu gia hạn đang chờ và hóa đơn gia hạn chưa trả bị hủy; hóa đơn tiền thuê chưa trả của các kỳ chưa bắt đầu bị hủy; tiền đã trả trước cho các kỳ chưa bắt đầu (hóa đơn tháng trả trước, các tháng gia hạn chưa dùng) được hoàn đủ cùng tiền cọc (`PrepaidRentCredit`), kỳ đang dùng thì không hoàn; tiền cọc cùng khoản hoàn này cấn trừ lần lượt phí quá hạn rồi các hóa đơn tiền thuê/phụ thu chưa trả (cả hóa đơn, cũ trước), ghi nhận bằng phương thức `DepositOffset` (không tính lại vào doanh thu). Phần nợ cọc không đủ trả vẫn để chưa thanh toán và phần cọc còn lại bị giữ đến khi trả hết. Có thể lập phụ thu (ví dụ phí vệ sinh) sau khi trả kho, miễn chưa hoàn cọc. Không trả kho được khi đang có giao dịch online chờ xác nhận.
- **Thanh toán sớm:** khách trả trước tiền thuê các tháng còn lại trong thời hạn hợp đồng bằng `POST /api/contracts/{id}/prepay` với `{ "months": N }` (1–24): API tạo ngay hóa đơn cho N kỳ kế tiếp chưa có hóa đơn, trả online hoặc tại quầy như mọi hóa đơn (worker vẫn tự tạo hóa đơn trước 7 ngày cho ai không trả trước). Muốn trả cho thời gian sau ngày kết thúc thì gia hạn: khách gửi yêu cầu gia hạn và trả hóa đơn gia hạn bất kỳ lúc nào khi hợp đồng còn hiệu lực (kể cả sau giờ hết hạn, miễn kho chưa bị khóa) và không còn hóa đơn quá hạn. Khi kho bị khóa do quá hạn, yêu cầu gia hạn đang chờ bị từ chối. `RenewalNoticeDays` chỉ còn là mốc nhắc gia hạn.
- **Bảo trì:** nhân viên/quản lý cơ sở chuyển kho sang `UnderMaintenance`; kết thúc bảo trì (`Available`) đưa kho đang thuê về `Rented` (hoặc `OverdueLocked` nếu hợp đồng quá hạn). Nhân viên cũng lập được phụ thu.
- **Giờ nghiệp vụ:** mọi mốc thời gian dùng giờ Việt Nam (`BusinessTimeZone`, mặc định `Asia/Ho_Chi_Minh`) bất kể múi giờ của server.
- **Dọn kho khi hết hạn:** hợp đồng hết hạn hoặc bị khóa quá hạn nhưng chưa trả kho, nhân viên vẫn có thể "Cho vào dọn kho" (`moveOut: true`).
- Trả hóa đơn `OVERDUE_FINE` (phí vượt cọc sau trả kho) sẽ đóng hồ sơ quá hạn; danh sách quá hạn có cờ `returnedWithDebt`.
- Quản lý cơ sở có thể giao lại yêu cầu hỗ trợ (`assignToStaffId`).

Quy tắc dữ liệu liên hệ: CCCD đúng 12 chữ số (3 số đầu là mã tỉnh 001–096), SĐT di động Việt Nam (`0[35789]` + 8 số, chấp nhận `+84`), email hợp lệ. Backend tự bỏ dấu cách/chấm/gạch, đổi `+84` thành `0`, chuyển email về chữ thường trước khi lưu và so sánh; trùng dữ liệu trả 409 kèm tên trường. Dữ liệu cũ được chuẩn hóa bởi `database/11_normalize_contacts.sql`.

Checklist ticket được tạo theo loại sự cố khi khách gửi yêu cầu. Khách và nhân viên cơ sở được phân công xem checklist; nhân viên tiếp nhận ticket trước khi cập nhật từng mục qua `PUT /api/support-requests/{requestId}/checklist/{itemId}`. API chuyển ticket sang `Resolved` chỉ thành công khi tất cả mục đã hoàn tất; mọi cập nhật checklist được lưu vào lịch sử ticket.

API checklist:

```http
GET /api/support-requests/{requestId}/checklist
PUT /api/support-requests/{requestId}/checklist/{itemId}
Content-Type: application/json

{ "isCompleted": true, "notes": "Đã thử cùng khách, khóa hoạt động bình thường." }
```

Khách chỉ xem checklist của ticket mình; nhân viên/quản lý chỉ xem và cập nhật ticket tại cơ sở được phân công. Mục checklist bắt đầu chưa hoàn thành; khi nhân viên đánh dấu hoàn tất, hệ thống lưu người thực hiện, thời gian và ghi chú. Trạng thái ticket đi theo `Open` → `InProgress` → `Resolved` → `Closed`, và chỉ được chuyển sang `Resolved` sau khi hoàn thành tất cả mục checklist.

Hóa đơn cọc được tạo cùng lúc đặt kho; hóa đơn gia hạn được tạo cùng yêu cầu gia hạn. Nhân viên chỉ ghi nhận thanh toán tiền mặt/chuyển khoản đã thực nhận, đủ đúng số dư hóa đơn; các mã giao dịch được kiểm tra không trùng. `confirm-deposit` và `renewals/{id}/confirm-payment` mặc định là tiền mặt; gửi body `{ "paymentMethod": "BankTransfer", "transactionCode": "..." }` cho chuyển khoản.

Giao dịch VNPay/MoMo chưa được cổng xác nhận sau 20 phút (hoặc khách bấm hủy qua `checkout/cancel`) chuyển sang `Failed` để hóa đơn có thể trả cách khác. Không hủy đơn, từ chối gia hạn hay để đơn hết hạn khi đang có giao dịch online chờ. Nếu cổng báo thành công muộn: hóa đơn còn chờ thanh toán thì vẫn ghi nhận bình thường; hóa đơn đã hủy/hết hạn/đã trả cách khác thì khoản tiền được lưu với trạng thái `RefundDue`, hiện trong danh sách `refund-due` để nhân viên hoàn cho khách (sau đó thành `Reversed`). Khách có thể khởi tạo thanh toán VNPay hoặc MoMo; hóa đơn chỉ được đánh dấu đã trả sau khi callback/IPN được xác minh chữ ký, mã đơn và số tiền. IPN là nguồn xác nhận chính thức, không tin trạng thái trên trang chuyển hướng. Khi trả kho, phần phí quá hạn vượt cọc được tạo thành hóa đơn; nhân viên ghi nhận khoản hoàn cọc, không được hoàn quá số dư sau khi khấu trừ phí.

## 3. Chạy thử trên máy

Cần: .NET SDK 10, Node.js 20+, SQL Server (Express/Developer đều được).

**Development local:** chỉ cần khởi động backend bằng `dotnet run`. Backend tự tạo database `SelfStorageDB` nếu chưa tồn tại, sau đó tự áp dụng schema/migration `02`–`12` theo thứ tự. Nếu database đã có dữ liệu, backend chỉ chạy các migration có thể chạy lặp lại; không chạy lại `01_schema.sql` và không xóa dữ liệu. Frontend chỉ gọi API, không kết nối hay tự cập nhật database.

**Tạo database thủ công hoặc khôi phục môi trường mới:** có thể chạy một lệnh từ thư mục gốc repo:

```
sqlcmd -S .\SQLEXPRESS -U sa -C -I -f 65001 -b -i database/setup_fresh.sql
```

`sqlcmd` sẽ hỏi mật khẩu. Nếu dùng SQL Server instance khác, thay `.\SQLEXPRESS` bằng tên server/instance tương ứng. `setup_fresh.sql` gọi `01_schema.sql`, script này xóa các bảng hiện có trước khi tạo lại, nên **chỉ dùng cho database mới hoặc khi chủ động muốn xóa toàn bộ dữ liệu**.

Để nâng cấp database đã có dữ liệu ngoài Development, không chạy `setup_fresh.sql` hoặc `01_schema.sql`; dùng:

```
sqlcmd -S .\SQLEXPRESS -U sa -C -I -f 65001 -b -d SelfStorageDB -i database/upgrade_existing.sql
```

`upgrade_existing.sql` chạy các migration `02`–`12` theo đúng thứ tự; có thể chạy lại nếu cần. Nếu chạy bằng SSMS, bật **SQLCMD Mode** rồi mở script tổng tương ứng. Giữ các file migration riêng để kiểm tra thay đổi và dùng trong quy trình deploy có kiểm soát. Tự động cập nhật database hiện chỉ bật cho môi trường Development; trước khi deploy môi trường thật, cần có quy trình backup và migrate phù hợp, không reset database.

**Backend.** Chuỗi kết nối mặc định trong `appsettings.json` dùng Windows Authentication. Để dùng SQL Authentication cho môi trường Development, lưu chuỗi kết nối bằng User Secrets (không ghi mật khẩu vào file trong repo):

```
dotnet user-secrets set "ConnectionStrings:SelfStorageDB" "Server=.\SQLEXPRESS;Database=SelfStorageDB;User Id=sa;Password=<mat-khau-sa>;TrustServerCertificate=True" --project backend\SelfStorage.Api\SelfStorage.Api.csproj
```

Thay `<mat-khau-sa>` bằng mật khẩu của tài khoản `sa`. User Secrets đã được khởi tạo cho project; cấu hình này chỉ áp dụng trên máy hiện tại khi chạy Development.

**Email reset password khi chưa cấu hình SMTP:** ở môi trường Development, nếu chưa có thông tin SMTP (ví dụ vừa clone/pull về), `POST /api/auth/forgot-password` vẫn chạy bình thường nhưng không gửi mail thật: mã đặt lại mật khẩu được in ra console của backend và email được lưu thành file `.eml` trong `backend/SelfStorage.Api/dev-emails/` (đã gitignore). Muốn gửi mail thật thì cấu hình SMTP như dưới đây.

**Cấu hình Gmail SMTP để gửi email reset password (Windows/PowerShell):**

1. Bật **2-Step Verification** cho tài khoản Gmail gửi thư.
2. Trong Google Account → Security, tạo **App Password**. App Password này khác mật khẩu đăng nhập Google. Không dán mật khẩu vào chat hoặc lưu trong file repo.
3. Tại thư mục gốc repo, chạy script. Nhập `tdkhanh123z@gmail.com` làm mailbox; App Password được nhập bằng secure prompt và lưu vào User Secrets. Script tự bỏ khoảng trắng khi lưu:

```powershell
.\scripts\configure-gmail-smtp.ps1
```

Backend gửi qua `smtp.gmail.com:587` với TLS. Chức năng này không cần OAuth Playground hay cấu hình OAuth consent screen; đăng nhập Google nếu sử dụng vẫn là luồng riêng. User Secrets chỉ áp dụng local Development. Khi deploy, lưu App Password trong secret manager của môi trường host, không commit hoặc gửi qua chat. Nếu Google không hiển thị mục App Passwords, kiểm tra 2-Step Verification và chính sách bảo mật của tài khoản.

Các API frontend cho vận hành:

- Nhân viên/quản lý: `GET /api/facilities/{facilityId}/daily-operations`, `GET /api/facilities/{facilityId}/contracts`, `GET /api/gate/my-facilities`.
- Khách hàng đặt lịch nhận kho sau khi cọc được xác nhận: `PUT /api/reservations/{id}/appointment` với `AppointmentAt` dạng ISO-8601 có offset (ví dụ `2026-05-10T10:00:00+07:00`), chậm nhất ngày `ExpectedStartDate + 7`. Lịch chỉ để sắp xếp, không chặn check-in; danh sách công việc theo ngày sẽ hiển thị các lịch hẹn.
- Khách hàng có thể gửi mã `PromoCode` khi `POST /api/reservations`; mã chỉ được nhận nếu khách chưa có hợp đồng thuê và chưa có đơn đang mở dùng ưu đãi, và giảm một lần trên hóa đơn thuê đầu tiên. Nếu đến lúc bàn giao khách đã có hợp đồng khác thì ưu đãi bị bỏ (không chặn bàn giao). Nhân viên xử lý yêu cầu hủy tại `/api/facilities/{facilityId}/cancellation-requests`; hoàn cọc được ghi nhận riêng sau khi chuyển tiền thực tế.
- Khách hàng gửi yêu cầu hủy tại `POST /api/reservations/{id}/cancellation-requests` và xem trạng thái tại `GET /api/reservations/{id}/cancellation-requests/my`. Nhân viên duyệt/từ chối tại `POST /api/facilities/{facilityId}/cancellation-requests/{requestId}/resolve`; sau khi duyệt, ghi nhận khoản hoàn thực tế bằng `POST /api/reservations/{id}/cancellation-refunds`.
- Quản lý cơ sở: `GET/POST /api/facility-management/facilities/{facilityId}/units`, `PUT /units/{unitId}`, quản lý nhân viên tại `/staff`. Nhân viên và quản lý cơ sở: `PUT /units/{unitId}/status` (bắt đầu/kết thúc bảo trì) và tạo phụ thu tại `/contracts/{contractId}/extra-charges`.
- Báo cáo: `GET /api/facilities/{facilityId}/dashboard` cho quản lý cơ sở; `GET /api/operations/reports/facilities` cho quản lý vận hành toàn hệ thống.
- Quản lý vận hành: `GET/POST/PUT /api/operations/facilities`, `/rental-policies`, `/fees`, `/promotions`.
- Quản trị hệ thống: `GET /api/admin/roles`, quản lý tài khoản tại `/api/admin/users`, cập nhật vai trò/trạng thái bằng `/users/{userId}/role` và `/users/{userId}/status`, phân công cơ sở cho nhân viên/quản lý cơ sở bằng `GET/PUT /users/{userId}/facilities`, đặt lại mật khẩu bằng `POST /users/{userId}/password`, xem lịch sử tại `/users/{userId}/activity`.
- Tiền thuê: API tạo hóa đơn tháng đầu khi bàn giao; worker tạo hóa đơn kỳ tiếp theo trước hạn 7 ngày và đánh dấu hóa đơn chưa trả là quá hạn.

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

Yêu cầu email luôn trả thông báo chung, dù email chưa đăng ký; chỉ tài khoản đang hoạt động mới nhận thư. Token sống 30 phút, dùng một lần. Hai endpoint reset bị giới hạn 5 lần mỗi 15 phút trên mỗi IP; đăng nhập (mật khẩu và Google) giới hạn 10 lần mỗi phút trên mỗi IP. Tài khoản demo có địa chỉ `@example.com` nên không nhận được thư; hãy dùng một tài khoản có email thật mà bạn kiểm soát.

**Đăng nhập API bằng Google (độc lập với luồng gửi mail):**

1. Trong [Google Cloud Console](https://console.cloud.google.com/), tạo OAuth Client ID loại **Web application**. Thêm origin của ứng dụng client vào **Authorized JavaScript origins**. Luồng API này nhận Google ID token do client lấy được, không dùng OAuth client secret ở backend.
2. Lưu Client ID cho API trong User Secrets:

   ```powershell
   dotnet user-secrets set "Google:ClientId" "client-id-cua-ban.apps.googleusercontent.com" --project backend\SelfStorage.Api\SelfStorage.Api.csproj
   ```

3. Sau khi chạy migration `database/05_google_login.sql`, client gửi Google ID token tới `POST /api/auth/google`:

   ```json
   {
     "idToken": "google-id-token"
   }
   ```

   Khi token chữ ký/audience/thời hạn hợp lệ và email đã được Google xác minh, API liên kết lần đầu với tài khoản đang hoạt động có cùng email rồi trả JWT nội bộ như endpoint đăng nhập thông thường. Google subject được lưu làm liên kết duy nhất; lần đăng nhập sau dựa vào subject. API chỉ đăng nhập tài khoản đã tồn tại, không tự tạo tài khoản vì đăng ký Self-Storage cần thông tin hồ sơ bắt buộc. Tài khoản chưa liên kết vẫn có thể dùng tên đăng nhập/mật khẩu và reset password qua email.

```
cd backend/SelfStorage.Api
dotnet run
```

Mở Swagger tại http://localhost:5080/swagger. Đăng nhập qua `POST /api/auth/login`, sao chép riêng giá trị `token` trong response, bấm **Authorize** và dán JWT nguyên bản (không thêm `Bearer `; Swagger tự thêm tiền tố này). Nếu dán cả tiền tố, request sẽ thành `Bearer Bearer ...` và bị trả về `401`.

Ở môi trường Development, backend tự tạo các tài khoản mẫu còn thiếu cho năm role. Không ghi đè hoặc xóa tài khoản người dùng hiện có. Nếu database chưa có cơ sở nào thì tạo thêm cơ sở và dữ liệu mẫu để thử luồng nhận kho:

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `customer1` | `Demo@12345` | Khách, đang thuê kho `B-01`, CCCD `079200000123` |
| `staff1` | `Demo@12345` | Nhân viên cơ sở Quận 7 |
| `manager1` | `Demo@12345` | Quản lý cơ sở Quận 7 |
| `ops1` | `Demo@12345` | Quản lý vận hành toàn hệ thống |
| `admin` | `Demo@12345` | Quản trị hệ thống |

Các tài khoản mẫu chỉ dành cho local Development; không sử dụng mật khẩu mẫu trong môi trường thật. Nếu username đã tồn tại với role khác, backend giữ nguyên tài khoản và ghi cảnh báo. Người được ủy quyền mẫu của `B-01`: Nguyễn Thị Người Nhà, CCCD `079300000456`.

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
- Lịch sử bảo trì (`MaintenanceRecords`), CRUD loại kho (`UnitTypes`), đặt kho hộ khách vãng lai tại quầy.
- Email nhắc gia hạn/báo quá hạn, luồng thanh lý hợp đồng quá hạn lâu (`Liquidated`), hoàn tiền thuê theo số ngày của kỳ đang dùng khi trả kho sớm (hiện chỉ hoàn các kỳ chưa bắt đầu).
- Màn hình cho quản lý vận hành, quản trị hệ thống, báo cáo doanh thu.
- Giao diện chưa đối chiếu với file Figma (mình không mở được Figma từ môi trường này). Nếu bạn xuất ảnh các màn hình và gửi vào đây, mình sẽ chỉnh theo.
