# Hướng dẫn test đăng ký ra/vào kho trên Swagger

Tài liệu này hướng dẫn chạy API local, tạo tài khoản khách bằng email test, tạo hợp đồng nếu chưa có, sau đó đăng ký lịch ra/vào, staff duyệt và kiểm tra CCCD tại cổng.

## 1. Tài khoản dùng để test

### Khách test mới

- Username: `khanhtdss160376`
- Email: `khanhtdss160376@fpt.edu.vn`
- Password: tự đặt trong bước đăng ký (tối thiểu 8 ký tự); không lưu password thật trong file hướng dẫn.
- CCCD và số điện thoại: nhập thông tin test do bạn quản lý. Dùng cùng một CCCD khi đăng ký tài khoản, tạo lịch và xác minh ở cổng.

Email hiện được lưu làm thông tin tài khoản; API đăng ký không yêu cầu xác nhận email hoặc gửi mã OTP.

### Staff local Development

Nếu `SeedDemoData` đang bật và mật khẩu demo chưa bị đổi:

- Username: `staff1`
- Password: `Demo@12345`

Chỉ dùng tài khoản demo trên môi trường local Development. Staff phải được phân công vào cơ sở đang test. Có thể đăng nhập staff rồi gọi `GET /api/gate/my-facilities` để xem `facilityId` được phép thao tác.

## 2. Mở Swagger

Chạy backend trong môi trường Development:

```powershell
dotnet run --project backend\SelfStorage.Api\SelfStorage.Api.csproj
```

Mở `http://localhost:5080/swagger`. Khi chạy Development, database bootstrapper tự áp dụng các migration đến `14_business_timezone_defaults.sql`. Migration 14 đồng bộ các giá trị thời gian mặc định mới theo múi giờ Việt Nam, không thay đổi dữ liệu ngày giờ hiện có. Nếu chạy môi trường khác, áp dụng migration theo quy trình database của môi trường đó.

## 3. Tạo tài khoản khách và đăng nhập

Trong Swagger mở `POST /api/auth/register`, chọn **Try it out** và gửi:

```json
{
  "username": "khanhtdss160376",
  "password": "<mật khẩu tự đặt, tối thiểu 8 ký tự>",
  "fullName": "Khách test Self Storage",
  "email": "khanhtdss160376@fpt.edu.vn",
  "phoneNumber": "<số điện thoại test>",
  "citizenId": "<CCCD test>"
}
```

Ghi lại CCCD đã dùng. Đăng nhập tại `POST /api/auth/login`:

```json
{
  "username": "khanhtdss160376",
  "password": "<mật khẩu vừa đặt>"
}
```

Copy trường `token` trong response. Bấm **Authorize** ở đầu Swagger và nhập:

```text
Bearer <token>
```

Các API có yêu cầu role Customer sẽ dùng token khách này. Khi đổi sang staff để duyệt lịch, bấm **Authorize** và thay bằng token đăng nhập của `staff1`.

## 4. Cần có hợp đồng đang thuê

Đăng ký lịch ra/vào chỉ dùng được với hợp đồng `Active`. Nếu tài khoản test đã có hợp đồng, gọi `GET /api/contracts/my`, ghi lại `contractId` và chuyển sang bước 5.

Nếu chưa có hợp đồng, tạo hợp đồng test theo luồng đặt kho:

1. Không cần token: gọi `GET /api/facilities`, `GET /api/unit-types`, rồi `GET /api/facilities/{facilityId}/availability`. Chọn cơ sở `Active`, `unitTypeId` còn kho.
2. Dùng token khách gọi `POST /api/reservations`:

   ```json
   {
     "facilityId": 1,
     "unitTypeId": 1,
     "expectedStartDate": "2026-10-21",
     "durationMonths": 1
   }
   ```

   Thay ID bằng giá trị trả về từ catalog. Chọn ngày bắt đầu trong tương lai và còn đủ thời gian thanh toán trước `depositDeadline`.
3. Từ response ghi lại `reservationId`. Khách cần thanh toán tiền cọc bằng một tháng tiền thuê. Để mô phỏng luồng local, staff có thể ghi nhận khoản tiền mặt **đã nhận thực tế** qua `POST /api/reservations/{reservationId}/confirm-deposit`. Đăng nhập `staff1`, dùng đúng ID đơn và cơ sở được phân công. Endpoint này đánh dấu hóa đơn cọc đã thanh toán, không thay thế thanh toán thật ngoài môi trường test.
4. Chuyển lại token khách, gọi `PUT /api/reservations/{reservationId}/appointment`:

   ```json
   {
     "appointmentAt": "2026-10-21T10:00:00+07:00"
   }
   ```

   `appointmentAt` phải là giờ tương lai, đúng ngày bắt đầu đã đặt và trước 20:00.
5. Đến thời gian hẹn, staff gọi `POST /api/reservations/{reservationId}/check-in` với một `unitId` còn trống cùng cơ sở và đúng loại kho:

   ```json
   {
     "unitId": 1,
     "unitConditionNotes": "Kho test bình thường khi bàn giao"
   }
   ```

   Response trả về `contractId`. Đổi lại token khách và gọi `GET /api/contracts/my` để xác nhận hợp đồng.

> Ngày trong ví dụ chỉ minh họa định dạng. Hãy chọn ngày/giờ tương lai phù hợp lúc test. Check-in chỉ thành công sau thời gian hẹn. Có thể dùng hợp đồng demo có sẵn nếu nó còn `Active`.

## 5. Khách đăng ký lịch ra/vào

Giữ token khách đã tạo hợp đồng. Gọi `POST /api/contracts/{contractId}/visit-registrations`:

```json
{
  "citizenId": "<CCCD đã đăng ký trên hồ sơ>",
  "authorizedPersonId": null,
  "scheduledEntryAt": "2026-10-22T09:00:00+07:00",
  "scheduledExitAt": "2026-10-22T11:00:00+07:00",
  "purpose": "Đưa đồ vào kho"
}
```

- Với chính khách thuê, đặt `authorizedPersonId` là `null` và CCCD phải khớp tài khoản khách.
- Nếu chủ hợp đồng đã thêm người được ủy quyền, có thể đăng ký cho người đó bằng `authorizedPersonId` tương ứng và CCCD của người đó.
- Hai mốc giờ phải có offset rõ ràng, là thời điểm tương lai, theo đúng hạn hợp đồng và giờ ra phải sau giờ vào.
- Ghi lại `visitRegistrationId` từ response. Trạng thái ban đầu là `Pending`.
- Xem lịch của mình bằng `GET /api/contracts/{contractId}/visit-registrations`.

## 6. Staff duyệt lịch

Đăng nhập `staff1`, thay token trong **Authorize**. Gọi `GET /api/gate/my-facilities` và dùng đúng `facilityId` của hợp đồng.

Liệt kê lịch đang chờ:

```http
GET /api/gate/facilities/{facilityId}/visit-registrations?status=Pending
```

Duyệt bằng `POST /api/gate/facilities/{facilityId}/visit-registrations/{visitRegistrationId}/review`:

```json
{
  "approve": true,
  "notes": "Đã kiểm tra thông tin và khung giờ"
}
```

Nếu từ chối, gửi `"approve": false` và ghi lý do trong `notes`. Chỉ lịch `Approved` mới được dùng để ghi nhận vào cổng; staff không thể duyệt lịch đã quá giờ hoặc hợp đồng/kho không còn đủ điều kiện.

## 7. Staff xác minh CCCD và ghi nhận vào/ra

Trong khoảng thời gian đã đăng ký, staff kiểm tra CCCD gốc của người đến, sau đó gọi `POST /api/gate/facilities/{facilityId}/entries`:

```json
{
  "contractId": 1,
  "visitRegistrationId": 1,
  "authorizedPersonId": null,
  "citizenId": "<CCCD đọc từ thẻ gốc>",
  "purpose": "Đưa đồ vào kho",
  "notes": "Đã đối chiếu CCCD tại quầy"
}
```

Thay `contractId` và `visitRegistrationId` bằng ID thực tế. Nếu lịch được lập cho người được ủy quyền, truyền đúng `authorizedPersonId` của lịch đó. CCCD lúc vào phải khớp CCCD đã đăng ký; không dùng CCCD thật của người khác trong dữ liệu demo.

Response thành công có `accessRecordId`, `visitRegistrationId`, `entryTime` và `verifiedBy`. Khi khách rời cơ sở, staff gọi:

```http
POST /api/gate/access-records/{accessRecordId}/exit
```

Có thể kiểm tra danh sách người đang ở trong cơ sở bằng `GET /api/gate/facilities/{facilityId}/inside`, hoặc lịch sử trong ngày bằng `GET /api/gate/facilities/{facilityId}/today`.

## 8. Các trường hợp nên thử để xác nhận kiểm tra

- Đăng ký bằng CCCD không trùng hồ sơ: API từ chối.
- Dùng lịch `Pending` hoặc `Rejected` để vào cổng: API từ chối.
- Dùng lịch trước giờ vào hoặc sau giờ ra đã đăng ký: API từ chối.
- Dùng lịch của hợp đồng khác hoặc người được ủy quyền khác: API từ chối.
- Gọi API staff với token khách hoặc staff không được phân công ở cơ sở: bị từ chối quyền.
- Dùng lại lịch sau khi đã được ghi nhận vào: API từ chối; staff cần xác nhận lượt ra bằng `accessRecordId`.

## 9. Core flow: đặt kho → thanh toán → hợp đồng → ra/vào → billing → gia hạn/trả kho

Flow dưới đây dùng ID thực tế trả về từ mỗi API; không giả định các ID mẫu luôn là `1`. Các API khách cần token Customer, còn thu tiền tại cơ sở, check-in, duyệt renewal và trả kho cần token Staff được phân công tại facility đó.

### 9.1 Đặt kho và thanh toán cọc

1. Xem cơ sở, giá và kho còn trống:
   - `GET /api/facilities`
   - `GET /api/unit-types`
   - `GET /api/facilities/{facilityId}/availability`
2. Đăng nhập khách, gọi `POST /api/reservations`:

   ```json
   {
     "facilityId": 1,
     "unitTypeId": 1,
     "expectedStartDate": "<ngày bắt đầu YYYY-MM-DD>",
     "durationMonths": 1
   }
   ```

   Lưu `reservationId`, `depositInvoiceId`, `depositAmount` và `depositDeadline` từ response. Hóa đơn cọc bằng một tháng tiền thuê theo Rental Policy.
3. Dùng MoMo/VNPay sandbox, khách gọi `POST /api/invoices/{depositInvoiceId}/checkout/momo` hoặc `/checkout/vnpay`. Hoàn tất giao dịch ở sandbox. Hóa đơn chỉ chuyển sang Paid sau khi backend nhận và xác minh callback/IPN; URL redirect trở về trình duyệt không tự xác nhận thanh toán. Sandbox cần credentials hợp lệ và callback HTTPS public tới API.
4. Chỉ để test local khi staff thực sự ghi nhận khoản tiền đã nhận: staff có thể gọi `POST /api/reservations/{reservationId}/confirm-deposit`. API này ghi nhận tiền mặt đã thu, không dùng để giả lập thanh toán online hoặc dùng trên production.
5. Khi hóa đơn cọc đã Paid, khách gọi `PUT /api/reservations/{reservationId}/appointment` với thời điểm tương lai thuộc ngày bắt đầu và trước 20:00:

   ```json
   {
     "appointmentAt": "<YYYY-MM-DD>T10:00:00+07:00"
   }
   ```

### 9.2 Staff bàn giao và tạo hợp đồng

Tại thời điểm hẹn hoặc sau đó trong ngày bắt đầu, staff gọi `POST /api/reservations/{reservationId}/check-in` với `unitId` còn trống, đúng facility và đúng unit type:

```json
{
  "unitId": 1,
  "unitConditionNotes": "Đã kiểm tra tình trạng kho trước bàn giao"
}
```

API check-in ghi nhận bàn giao và tạo Contract. Hiện Swagger không có luồng ký điện tử riêng cho khách; trạng thái hợp đồng và biên bản bàn giao được tạo trong thao tác check-in của staff. Ghi lại `contractId` từ response; khách kiểm tra tại `GET /api/contracts/my`.

Check-in cũng tạo hóa đơn tiền thuê kỳ đầu (`MONTHLY_RENT`) trừ khi đã được giảm đủ 100%. Khách xem invoice tại `GET /api/invoices/my`.

### 9.3 Đăng ký ra/vào và xác minh ở cổng

Thực hiện theo các bước ở mục 5–7:

1. Khách tạo lịch với `POST /api/contracts/{contractId}/visit-registrations`, kèm CCCD của người sẽ đến và giờ vào/ra cụ thể.
2. Staff lọc lịch tại `GET /api/gate/facilities/{facilityId}/visit-registrations?status=Pending`, rồi duyệt/từ chối qua endpoint `.../{registrationId}/review`.
3. Trong khung giờ đã duyệt, staff đọc CCCD trên thẻ gốc và gọi `POST /api/gate/facilities/{facilityId}/entries` với `contractId`, `visitRegistrationId`, đúng người và CCCD. Khi khách rời cơ sở, staff ghi nhận `POST /api/gate/access-records/{accessRecordId}/exit`.

### 9.4 Hóa đơn hàng tháng, thanh toán và email

- Worker `MonthlyRentInvoiceService` chạy mỗi 6 giờ. Với hợp đồng Active, worker tạo các hóa đơn kỳ thuê sắp đến hạn trong tối đa 7 ngày tiếp theo; hóa đơn đầu tiên được tạo ngay khi staff check-in. Khách xem hóa đơn, kỳ billing và trạng thái thanh toán tại `GET /api/invoices/my`.
- Khách trả invoice bằng `POST /api/invoices/{invoiceId}/checkout/momo` hoặc `/checkout/vnpay`; xác nhận chính thức vẫn là IPN đã xác minh. Staff có thể ghi nhận tiền mặt/chuyển khoản đã nhận tại `POST /api/invoices/{invoiceId}/payments`, với số tiền chính xác bằng invoice; chuyển khoản phải có mã giao dịch.
- Khi SMTP đã cấu hình, hệ thống tự xếp email thông báo mỗi hóa đơn vào outbox cùng transaction phát hành, gồm cọc, tiền thuê, gia hạn, phụ phí và phí quá hạn; worker tự gửi và retry lỗi. Sau khi MoMo/VNPay IPN hợp lệ hoặc nhân viên ghi nhận khoản thu thực tế, hệ thống tự gửi email xác nhận thanh toán. Các hóa đơn thuê tháng tiếp theo được worker phát hành và gửi nhắc thanh toán tối đa 7 ngày trước hạn. Không cần duyệt thủ công; chỉ Admin retry nếu email đã thất bại hết các lần tự động. Ticket được xem và xử lý trong ứng dụng, không gửi email.

### 9.5 Gia hạn trong tuần trước ngày hết hạn

Trong khoảng `RenewalNoticeDays` trước ngày hết hạn (thường được cấu hình là 7 ngày), khi hợp đồng vẫn Active và chưa tới 20:00 ngày hết hạn:

1. Khách gọi `GET /api/contracts/{contractId}` để xem `renewalAvailableFrom` và `endDate`.
2. Gửi yêu cầu gia hạn:

   ```json
   {
     "extensionMonths": 1
   }
   ```

   tới `POST /api/contracts/{contractId}/renewals`. Response có `renewalId` và `invoiceId`.
3. Thanh toán invoice gia hạn bằng checkout MoMo/VNPay như trên, hoặc staff dùng `POST /api/contracts/renewals/{renewalId}/confirm-payment` để xác nhận khoản thu thực tế tại cơ sở.
4. Khi thanh toán được xác nhận, renewal chuyển sang `Paid` và `endDate` của hợp đồng được cập nhật. Kiểm tra bằng `GET /api/contracts/{contractId}/renewals` và `GET /api/contracts/{contractId}`. Hóa đơn tháng tương ứng khoảng thời gian đã bao phủ bởi renewal sẽ không bị tạo trùng.

### 9.6 Không gia hạn: trả kho hoặc quá hạn

- Trả đúng hạn: lịch trả là **20:00 ngày `endDate`**. Staff chỉ hoàn tất `POST /api/contracts/{contractId}/return` sau giờ hẹn, khi tất cả khách đã ra khỏi facility và staff xác nhận kho đã dọn sạch:

  ```json
  {
    "unitConditionNotes": "Đã kiểm tra kho khi nhận lại",
    "allItemsRemoved": true,
    "staffNotes": "Không còn đồ trong kho"
  }
  ```

  Response cho biết tiền cọc bị khấu trừ, khoản hoàn còn lại và khoản phí còn phải thu nếu tiền cọc không đủ. Sau khi hợp đồng kết thúc, staff ghi nhận khoản hoàn thực tế qua `POST /api/contracts/{contractId}/deposit-refunds`.
- Không trả kho: worker quá hạn kiểm tra mỗi phút. Theo `MaxOverdueDaysBeforeLock` (mặc định 1 ngày), sau 24 giờ kể từ 20:00 ngày hết hạn, hợp đồng chuyển Overdue, unit bị khóa và phí tính theo ngày bắt đầu được cộng vào khoản quá hạn. Khi staff thực hiện trả kho, phí được cấn trừ vào cọc; nếu còn thiếu, hệ thống tạo hóa đơn `OVERDUE_FINE`. Staff có thể xem danh sách tại `GET /api/contracts/facilities/{facilityId}/overdue`.
- Nếu còn người đang ở trong facility hoặc `allItemsRemoved` là `false`, API không cho hoàn tất trả kho. Nếu khách cần tiếp tục thuê sau ngày hết hạn thì nên hoàn tất gia hạn và thanh toán trước mốc trả kho.

### Checklist đối chiếu trạng thái

| Mốc | API kiểm tra | Trạng thái mong đợi |
|---|---|---|
| Đặt cọc | `GET /api/invoices/my` | Invoice `DEPOSIT` chuyển `Paid` sau thanh toán |
| Bàn giao | `GET /api/contracts/my` | Có contract `Active` và unit được gán |
| Lượt vào | `GET /api/gate/facilities/{facilityId}/today` | Có `Granted`, đúng `visitRegistrationId`, CCCD đã được staff đối chiếu |
| Billing | `GET /api/invoices/my` | Invoice `MONTHLY_RENT` theo kỳ, paid/unpaid/overdue hiển thị rõ |
| Gia hạn | `GET /api/contracts/{contractId}/renewals` | Renewal `Paid`, ngày hết hạn hợp đồng được kéo dài |
| Kết thúc thuê | `GET /api/contracts/{contractId}` | Contract `Terminated`, unit được trả về Available sau khi staff nhận kho |

## 10. Cấu hình email khi clone repo

Mỗi bản clone chạy API riêng cần một tài khoản SMTP gửi thư; không thể gửi email Gmail thật chỉ bằng source code vì Gmail yêu cầu xác thực người gửi. Không cần sửa file cấu hình hoặc đưa password vào Git.

### Cách dễ nhất cho local Development

1. Tạo Gmail App Password cho tài khoản gửi thư (Gmail cần bật 2-Step Verification).
2. Từ thư mục gốc repo chạy:

   ```powershell
   .\scripts\configure-gmail-smtp.ps1
   ```

3. Nhập địa chỉ Gmail gửi thư và App Password khi script hỏi. App Password được nhập ẩn và lưu vào .NET User Secrets của project trên máy này.
4. Khởi động lại backend. Các giá trị đã lưu được nạp tự động khi ASP.NET chạy `Development`; không phải chạy lại script mỗi lần start.

Người clone repo khác chạy script trên máy của họ với Gmail/App Password của họ. Nếu mọi người chỉ dùng chung một bản API đã deploy, cấu hình SMTP một lần trong secret/environment của server; người dùng API không cần cấu hình SMTP trên máy cá nhân.

Có thể dùng SMTP provider khác bằng cách lưu các khóa `Smtp:Host`, `Smtp:Port`, `Smtp:Username`, `Smtp:Password`, `Smtp:FromAddress`, `Smtp:FromName` và `Smtp:EnableSsl` vào User Secrets hoặc environment variables theo cấu hình của provider đó.

**Phạm vi email:** SMTP dùng cho reset mật khẩu, thông báo phát hành mọi loại hóa đơn và xác nhận thanh toán thành công. Email hóa đơn và biên nhận được lưu vào outbox; worker tự gửi/retry tối đa 8 lần, không cần duyệt. Hóa đơn tháng được phát hành và email nhắc tự động tối đa 7 ngày trước hạn. Admin theo dõi `GET /api/admin/email-outbox?status=Failed` và chỉ gửi lại nếu email thất bại hết các lần tự động. Ticket được trao đổi trong ứng dụng, không gửi email. Nếu chưa cấu hình SMTP, email không thể được chuyển tới hộp thư; áp dụng migration `13_email_outbox.sql` trước khi chạy worker.

## 11. API quản trị hợp đồng và dashboard

Đăng nhập bằng tài khoản có role `SystemAdministrator` rồi bấm **Authorize** trong Swagger. Các API dưới đây cho Admin xem dữ liệu toàn hệ thống, không yêu cầu phân công cơ sở:

- `GET /api/admin/contracts`: danh sách có lọc theo `facilityId`, `customerId`, `status`, `search`, `page`, `pageSize`.
- `GET /api/admin/contracts/{contractId}`: chi tiết hợp đồng, khách thuê, cơ sở, unit, tiền thuê/cọc và điều khoản.
- `PUT /api/admin/contracts/{contractId}`: chỉ chỉnh `endDate` và `termsConditions`. Không thể sửa ngày bắt đầu, giá thuê hoặc dữ liệu thanh toán; ngày kết thúc phải hợp lệ và không làm xung đột hóa đơn tiền thuê/gia hạn. Mọi cập nhật được ghi activity log.

Ví dụ cập nhật điều khoản/ngày kết thúc:

```json
{
  "endDate": "2027-10-20",
  "termsConditions": "Điều khoản cập nhật được phê duyệt bởi quản trị viên."
}
```

Tạo hợp đồng vẫn phải theo nghiệp vụ: reservation cọc đã thanh toán, lịch nhận hợp lệ và unit phù hợp. Admin thực hiện bàn giao qua `POST /api/admin/contracts/from-reservations/{reservationId}/check-in` với body `unitId` và `unitConditionNotes` như mục 4. Hệ thống ghi staff tạo hợp đồng là tài khoản Admin đang thao tác và lưu audit log.

Không xóa cứng hợp đồng để bảo toàn hóa đơn, thanh toán, lịch sử ra/vào và biên bản. Khi khách trả kho, Admin có thể dùng `POST /api/admin/contracts/{contractId}/return` với body `unitConditionNotes`, `allItemsRemoved: true`, `staffNotes`; endpoint vẫn kiểm tra mốc 20:00, khách đã ra khỏi facility và xác nhận dọn sạch. Hợp đồng kết thúc ở trạng thái `Terminated`, unit được trả về Available và lịch sử được giữ lại.

Dashboard cho Admin:

- `GET /api/operations/reports/facilities?fromDate=2026-10-01&toDate=2026-10-31`: báo cáo toàn hệ thống theo khoảng ngày.
- `GET /api/operations/reports/details?fromDate=2026-10-01&toDate=2026-10-31&facilityId=1&unitTypeId=1&contractStatus=Active`: báo cáo chi tiết theo cơ sở và loại kho, gồm tồn kho, tỷ lệ sử dụng, số hợp đồng theo trạng thái và doanh thu ròng. Các bộ lọc ID/trạng thái là tùy chọn.
- `GET /api/operations/reports/details.csv?fromDate=2026-10-01&toDate=2026-10-31`: tải báo cáo chi tiết CSV; có thể dùng chung các bộ lọc như endpoint JSON.
- `GET /api/facilities/{facilityId}/dashboard?fromDate=2026-10-01&toDate=2026-10-31`: dashboard từng cơ sở.

Khoảng ngày chỉ lọc doanh thu theo ngày thanh toán. Số kho, tỷ lệ sử dụng, trạng thái hợp đồng và ticket là snapshot tại thời điểm gọi API, không phải số liệu lịch sử tại `toDate`.

Admin cập nhật hồ sơ tài khoản bằng `PUT /api/admin/users/{userId}/profile`:

```json
{
  "fullName": "Nguyen Van A",
  "email": "user@example.com",
  "phoneNumber": "0901234567",
  "citizenId": "079300000456"
}
```

Username không đổi qua API hồ sơ; role và trạng thái tài khoản tiếp tục được quản lý bằng các endpoint riêng. Tài khoản không xóa cứng để giữ lịch sử nghiệp vụ.
