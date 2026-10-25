# Cấu hình VNPay Sandbox khi chạy local

Hướng dẫn này dành cho môi trường phát triển local, không phải cấu hình production. VNPay chạy trên sandbox; API và SQL Server vẫn chạy trên máy của bạn.

## Những gì cần có

- .NET SDK đúng phiên bản trong `backend/SelfStorage.Api/SelfStorage.Api.csproj`.
- SQL Server local và database của dự án.
- Tài khoản merchant VNPay sandbox, gồm `TmnCode` (Terminal ID) và `HashSecret`.
- HTTPS tunnel trỏ tới API local port `5080`, ví dụ ngrok.
- Frontend chạy tại `http://localhost:5173` nếu muốn xem trang kết quả sau khi thanh toán.

Không đưa `HashSecret` vào Git, `appsettings.json`, ảnh chụp màn hình hoặc chat. Không mở SQL Server ra internet.

## Cấu hình API và tunnel

1. Chạy SQL Server/database và API theo hướng dẫn trong README.
2. Mở terminal riêng, tạo tunnel tới API:

   ```powershell
   ngrok http 5080
   ```

3. Sao chép HTTPS forwarding URL do tunnel cung cấp, ví dụ `https://example.ngrok-free.app`. Để tunnel chạy trong suốt quá trình kiểm thử.
4. Từ thư mục gốc repository, chạy script:

   ```powershell
   .\scripts\configure-vnpay-sandbox.ps1
   ```

5. Nhập HTTPS URL tunnel, `TmnCode`, và `HashSecret` khi được hỏi. HashSecret được nhập ẩn. Nhấn Enter để dùng URL mặc định cho frontend và VNPay Sandbox.
6. Khởi động lại API sau khi cấu hình. Cấu hình được lưu trong .NET User Secrets cục bộ, không được thêm vào repository.

Script cấu hình các khóa:

| Khóa | Giá trị |
|---|---|
| `PaymentGateways:PublicBaseUrl` | HTTPS URL công khai của tunnel |
| `PaymentGateways:FrontendReturnUrl` | Mặc định `http://localhost:5173/payment-result` |
| `PaymentGateways:VnPay:Enabled` | `true` |
| `PaymentGateways:VnPay:PaymentUrl` | Mặc định `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` |
| `PaymentGateways:VnPay:TmnCode` | Terminal ID của merchant sandbox |
| `PaymentGateways:VnPay:HashSecret` | HashSecret của merchant sandbox |

## Đăng ký IPN và kiểm thử

URL IPN phải dùng HTTPS và trỏ tới tunnel hiện tại:

```text
https://<api-public-url>/api/payments/vnpay/ipn
```

Đăng ký URL này trong cấu hình merchant/SIT được VNPay cấp cho tài khoản sandbox. Nếu không có quyền vào trang cấu hình merchant hoặc công cụ SIT, API vẫn có thể tạo checkout và VNPay vẫn có thể hiển thị kết quả giao dịch test, nhưng VNPay sẽ không biết địa chỉ để gọi IPN. Khi đó trạng thái thanh toán trong database local sẽ không tự chuyển sang thành công.

Luồng kiểm thử:

1. Đăng nhập Swagger bằng tài khoản customer có hóa đơn cần thanh toán.
2. Gọi `POST /api/invoices/{invoiceId}/checkout/vnpay` và mở URL thanh toán trả về.
3. Hoàn tất thanh toán bằng phương thức/thẻ test do VNPay Sandbox cung cấp.
4. Kiểm tra ngrok request inspector hoặc log API để xác nhận VNPay gọi `/api/payments/vnpay/ipn`.
5. Kiểm tra trạng thái hóa đơn/payment qua API. Chỉ IPN có chữ ký hợp lệ mới xác nhận hóa đơn; trang Return chỉ chuyển hướng trình duyệt, không phải xác nhận thanh toán.

Mỗi lần khởi động lại tunnel, URL công khai có thể thay đổi. Chạy lại script để cập nhật `PublicBaseUrl`, khởi động lại API, và cập nhật URL IPN tại VNPay nếu địa chỉ đã đổi. Đảm bảo callback đi tới đúng tunnel và API vẫn đang chạy.

## Secrets sau khi pull code

.NET User Secrets được lưu ngoài repository, gắn với `UserSecretsId` của project và tài khoản Windows hiện tại. Vì vậy:

- Pull/re-clone repository trên cùng máy và cùng tài khoản Windows thường **không** yêu cầu nhập lại credentials.
- Máy mới hoặc tài khoản Windows khác cần cấu hình secrets riêng. Git không truyền chúng sang người khác.
- Có thể chia sẻ merchant sandbox credentials cho nhóm qua kênh riêng được phép, nhưng không commit chúng vào repository. Nếu không muốn chia sẻ credentials, mỗi người cần merchant sandbox riêng.
- URL tunnel có thể đổi dù credentials vẫn còn; chỉ cập nhật lại `PublicBaseUrl` và URL IPN khi cần.

Lệnh xem tên khóa đã lưu (không in giá trị secret):

```powershell
dotnet user-secrets list --project .\backend\SelfStorage.Api\SelfStorage.Api.csproj
```

Để xóa secrets của project khỏi tài khoản Windows hiện tại:

```powershell
dotnet user-secrets clear --project .\backend\SelfStorage.Api\SelfStorage.Api.csproj
```
