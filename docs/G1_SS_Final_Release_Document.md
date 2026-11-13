# SELF-STORAGE MANAGEMENT SYSTEM
## Final Release Document
**Group Code:** G1_SS | **Version:** 1.0 | **Date:** Nov 2026

---

## I. Deliverable Package

Phần này liệt kê toàn bộ các gói mã nguồn, tập lệnh cơ sở dữ liệu (SQL scripts), bộ công cụ tự động hóa và hệ thống tài liệu kỹ thuật thuộc bản phát hành cuối cùng (**Version 1.0**) của dự án **Self-Storage Management System** (Hệ thống cho thuê và quản lý kho tự phục vụ đa cơ sở).


| No. | File / Package | Notes |
| --- | --- | --- |
| 1 | **G1_SS_SourceCode_v1.0.zip** | Gói mã nguồn đầy đủ của toàn bộ hệ thống (phiên bản phát hành v1.0), bao gồm:<br>- backend/SelfStorage.Api: RESTful Web API xây dựng trên ASP.NET Core (.NET 10), Entity Framework Core, xác thực JWT, Google OAuth, Swagger và 3 dịch vụ chạy nền (OverdueService, MonthlyRentInvoiceService, EmailOutboxWorker).<br>- frontend/: Ứng dụng giao diện người dùng Single-Page Application (React 19, TypeScript, Vite) phục vụ cả 5 vai trò người dùng, kèm chế độ chạy giả lập độc lập (Demo Mode / Mock Server).<br>- scripts/: Bộ tập lệnh .bat và .ps1 tự động hóa kiểm tra máy, khởi tạo CSDL, chạy đồng thời toàn hệ thống và cấu hình thông tin bí mật (SMTP Gmail, VNPay, MoMo). |
| 2 | **G1_SS_DB_final.sql** (thư mục `database/`) | Gói cơ sở dữ liệu Microsoft SQL Server hoàn chỉnh gồm cả cấu trúc bảng, ràng buộc toàn vẹn và dữ liệu mẫu:<br>- 01_schema.sql & setup_fresh.sql: Khởi tạo mới toàn bộ cấu trúc bảng cốt lõi và áp dụng tuần tự các bản nâng cấp.<br>- 02_billing_reservation_links.sql đến 18_renewal_max_months.sql & upgrade_existing.sql: 17 file migration mở rộng nghiệp vụ có tính lũy đẳng (idempotent), an toàn khi chạy lặp trên cơ sở dữ liệu đang vận hành.<br>- seed_demo_data.sql (cùng DevSeeder): Bộ dữ liệu mẫu gồm cơ sở kho, loại kho, hợp đồng, hóa đơn và tài khoản kiểm thử cho đầy đủ 5 vai trò. |
| 3 | **G1_SS_SRS_final.docx** | Tài liệu Đặc tả Yêu cầu Phần mềm (Software Requirements Specification) phiên bản cuối cùng: mô tả bài toán nghiệp vụ, phân quyền Actor, Use Cases, quy tắc kinh doanh và yêu cầu phi chức năng. |
| 4 | **G1_SS_SDS_final.docx** | Tài liệu Đặc tả Thiết kế Hệ thống (Software Design Specification) phiên bản cuối cùng: kiến trúc tổng thể Client–Server, sơ đồ lớp, lược đồ cơ sở dữ liệu (ERD), Sequence Diagrams và đặc tả giao thức tích hợp cổng thanh toán / SMTP. |
| 5 | **G1_SS_Final Product Backlog.xlsx** (`docs/total-project-tracking.csv`) | Bảng tổng hợp trạng thái hoàn thiện của toàn bộ 74 chức năng/màn hình trong dự án (71 Done – 95.95%, 3 Doing – 4.05%, 0 To Do), bao gồm:<br>- Tên API / Màn hình, nhóm tính năng, vai trò sử dụng (Actor) và mô tả chi tiết nghiệp vụ sau khi chuẩn hóa.<br>- Độ phức tạp (Simple / Medium / Complex), thành viên phụ trách (In Charge).<br>- Trạng thái cuối cùng và ghi chú đối chiếu trực tiếp tới từng Controller, Hosted Service, Migration SQL và Route giao diện. |
| 6 | **G1_SS_Issues & Verification Report.xlsx** (`docs/yeu-cau-sua-chua-frontend.md`, `testswagger.md`) | Danh sách rà soát lỗi nghiệp vụ luồng khách hàng – vận hành, kịch bản kiểm thử API trên Swagger, biên bản kiểm thử tích hợp thanh toán VNPay/MoMo Sandbox và tài liệu đối chiếu đồng bộ Frontend – Backend. |
| 7 | **G1_SS_Final Release Document.docx** | Tài liệu bàn giao bản phát hành cuối cùng (tài liệu hiện tại): danh mục gói bàn giao, hướng dẫn cài đặt – cấu hình môi trường và cẩm nang hướng dẫn sử dụng chi tiết cho từng vai trò. |

*Ghi chú quy ước đặt tên: Tiền tố ****G1_SS**** bao gồm Mã nhóm sinh viên (ví dụ: ****G1**** — vui lòng thay bằng mã nhóm chính thức của lớp khi đóng gói nộp bài) và Mã dự án (****SS**** — Self-Storage Management System).*

**Other related deliverables:**

- **Tagged source codes (GitHub Repository): **https://github.com/thonghoang1904/self-storage (Branch/Tag phát hành: `main` / `<<Điền link Git Release Tag khi chốt nộp>>`)
- **Demonstration video: **`<<Điền link YouTube video demo toàn bộ luồng hệ thống>>`
---

## II. Installation Guides

Phần này hướng dẫn chi tiết quy trình chuẩn bị môi trường, khởi tạo cơ sở dữ liệu SQL Server, cấu hình biến môi trường bảo mật (User Secrets) và biên dịch – khởi chạy mã nguồn dự án **Self-Storage Management System** trên máy cục bộ (Local Development) hoặc môi trường kiểm thử.

### 1. Yêu cầu hệ thống (Prerequisites & System Requirements)


| Thành phần | Phiên bản yêu cầu | Mục đích sử dụng & Lệnh kiểm tra |
| --- | --- | --- |
| **Hệ điều hành** | Windows 10 / 11 (64-bit) (khuyến nghị) hoặc macOS / Linux | Chạy đầy đủ bộ script tự động hóa (.bat, PowerShell .ps1) và SQL Server Express cục bộ. |
| **.NET SDK** | .NET SDK 10.0 trở lên | Biên dịch và khởi chạy Backend ASP.NET Core Web API. Kiểm tra bằng lệnh: `dotnet --version`. |
| **Node.js & npm** | Node.js 20 LTS trở lên (kèm npm 10+) | Cài đặt thư viện và chạy Vite Dev Server cho Frontend React + TypeScript. Kiểm tra: `node -v`. |
| **Hệ quản trị CSDL** | Microsoft SQL Server 2019 / 2022 (Express hoặc Developer) | Lưu trữ dữ liệu giao dịch. Đi kèm công cụ dòng lệnh `sqlcmd` và tùy chọn SSMS (SQL Server Management Studio). |
| **IDE / Trình soạn thảo** | Visual Studio Code (khuyến nghị) hoặc Visual Studio 2022+ | Thư mục gốc dự án đã cấu hình sẵn `.vscode/tasks.json` cho phép chạy đồng thời Backend & Frontend bằng phím tắt `Ctrl+Shift+B`. |
| **Công cụ tùy chọn** | ngrok (HTTPS Tunnel) | Chỉ cần khi muốn kiểm thử callback IPN trực tiếp từ máy chủ VNPay Sandbox hoặc MoMo Sandbox về cổng `5080` trên máy local. |

### 2. Cấu trúc thư mục dự án (Repository Layout)

- `database/`: Chứa schema gốc (`01_schema.sql`), 17 bản nâng cấp lũy đẳng (`02_...sql` đến `18_renewal_max_months.sql`), script tổng tạo mới (`setup_fresh.sql`), script nâng cấp an toàn (`upgrade_existing.sql`) và dữ liệu mẫu (`seed_demo_data.sql`).
- `backend/SelfStorage.Api/`: Dự án ASP.NET Core Web API (.NET 10), gồm `Controllers/` (17 controllers), `Services/` (nghiệp vụ cổng, hóa đơn, cổng thanh toán, email outbox, dịch vụ chạy nền), `Data/` (EF Core DbContext & Entities) và `Infrastructure/` (đồng hồ múi giờ Việt Nam `BusinessClock`, tự động migrate & nạp dữ liệu mẫu).
- `frontend/`: Ứng dụng React + TypeScript + Vite; thư mục `src/pages/` chứa toàn bộ màn hình theo 5 vai trò và `src/mock/server.ts` phục vụ chế độ chạy Demo không cần Backend.
- `scripts/`: Bộ công cụ bấm đúp chạy ngay trên Windows (`check-machine.bat`, `1-create-database.bat`, `RUN-ALL.bat`, `RESET-DATABASE.bat`) và 3 script PowerShell cấu hình SMTP / VNPay / MoMo.
- `docs/`: Tài liệu đặc tả phụ trợ, bảng theo dõi tiến độ tổng thể và hướng dẫn cấu hình tích hợp.
### 3. Cài đặt Cơ sở dữ liệu & Chuỗi kết nối (Database Setup)

Mặc định trong `backend/SelfStorage.Api/appsettings.json`, chuỗi kết nối sử dụng xác thực Windows (`Server=localhost;Database=SelfStorageDB;Trusted_Connection=True;TrustServerCertificate=True`).

- **Trường hợp dùng SQL Server Authentication (tài khoản sa) hoặc tên instance riêng (ví dụ .\SQLEXPRESS): **Lưu chuỗi kết nối an toàn qua .NET User Secrets tại thư mục gốc dự án (không sửa trực tiếp mật khẩu vào file cấu hình trong Git):

```powershell
# Thiết lập chuỗi kết nối riêng cho máy hiện tại bằng User Secrets
dotnet user-secrets set "ConnectionStrings:SelfStorageDB" "Server=.\SQLEXPRESS;Database=SelfStorageDB;User Id=sa;Password=<MatKhauSa>;TrustServerCertificate=True" --project backend\SelfStorage.Api\SelfStorage.Api.csproj
```

**Hai phương thức khởi tạo cơ sở dữ liệu:**


- **Cách 1 — Tự động hoàn toàn khi chạy Backend (Khuyến nghị cho Development):** Khi khởi động ở chế độ `Development`, thành phần `DevelopmentDatabaseBootstrapper` tự động kiểm tra và tạo cơ sở dữ liệu `SelfStorageDB` nếu chưa tồn tại, chạy `01_schema.sql` (chỉ khi CSDL trống), thực thi tuần tự các migration `02` đến `18` và tự động tạo 5 tài khoản mẫu cùng dữ liệu cơ sở kho mẫu qua `DevSeeder`.

- **Cách 2 — Khởi tạo hoặc nâng cấp chủ động bằng sqlcmd:** Sử dụng khi triển khai môi trường kiểm thử độc lập hoặc muốn nạp bộ dữ liệu mẫu mở rộng:

```powershell
# 1. Tạo mới hoàn toàn CSDL (LƯU Ý: lệnh này xóa bảng cũ nếu đã tồn tại)
sqlcmd -S .\SQLEXPRESS -U sa -C -I -f 65001 -b -i database/setup_fresh.sql

# 2. Hoặc chỉ nâng cấp CSDL đã có dữ liệu (chạy an toàn các migration 02 -> 18, không mất dữ liệu)
sqlcmd -S .\SQLEXPRESS -U sa -C -I -f 65001 -b -d SelfStorageDB -i database/upgrade_existing.sql

# 3. (Tùy chọn) Nạp bộ dữ liệu demo phong phú để kiểm thử báo cáo & biểu đồ
sqlcmd -S .\SQLEXPRESS -U sa -C -I -f 65001 -b -d SelfStorageDB -i database/seed_demo_data.sql
```

### 4. Biên dịch và Khởi chạy Hệ thống (Build & Run)

#### 4.1. Khởi chạy nhanh trên Windows bằng bộ Script tự động

Mở thư mục `scripts/` và chạy theo thứ tự cho lần đầu tiên: (1) `check-machine.bat` để kiểm tra môi trường máy; (2) `1-create-database.bat` để khởi tạo CSDL; (3) `RUN-ALL.bat` để bật đồng thời cửa sổ Backend (cổng `5080`) và Frontend (cổng `5173`), sau đó tự mở trình duyệt. Từ những lần sử dụng tiếp theo, chỉ cần bấm đúp `RUN-ALL.bat`.

#### 4.2. Mở và chạy bằng Visual Studio Code hoặc Dòng lệnh (CLI)

- **Trong VS Code: **Mở thư mục gốc `self-storage` (`File -> Open Folder`), nhấn tổ hợp phím **Ctrl + Shift + B** để tự động chạy song song hai tiến trình Backend và Frontend trên 2 cửa sổ Terminal tích hợp.
- **Chạy thủ công qua Terminal (2 cửa sổ độc lập): **Thực thi lần lượt các lệnh dưới đây:

```powershell
# --- Cửa sổ Terminal 1: Khởi chạy Backend Web API (http://localhost:5080) ---
cd backend/SelfStorage.Api
dotnet run
# Tài liệu Swagger UI khả dụng tại: http://localhost:5080/swagger

# --- Cửa sổ Terminal 2: Cài đặt thư viện & chạy Frontend (http://localhost:5173) ---
cd frontend
npm install
npm run dev

# --- (Tùy chọn) Chạy chế độ Demo độc lập không cần Backend / SQL Server ---
npm run dev:demo
```

Khi chạy `npm run dev`, Vite tự động chuyển tiếp (proxy) mọi yêu cầu có tiền tố `/api` sang `http://localhost:5080` nên không phát sinh lỗi CORS. Nếu đổi cổng Backend, chỉ cần tạo file `frontend/.env.development.local` khai báo `BACKEND_URL=http://localhost:<cong_moi>`.

### 5. Cấu hình Tích hợp Mở rộng (SMTP, Google OAuth, VNPay & MoMo)

Các tính năng gửi thư điện tử thật, đăng nhập Google và thanh toán qua cổng Sandbox được cấu hình bảo mật qua **.NET User Secrets** (tuyệt đối không lưu khóa bí mật vào `appsettings.json`):

- **Cấu hình Gmail SMTP (gửi mã đặt lại mật khẩu, hóa đơn mới & biên nhận thanh toán): **Bật xác thực 2 bước trên tài khoản Google, tạo *App Password* và chạy script `.\scripts\configure-gmail-smtp.ps1` để lưu thông tin hộp thư gửi qua `smtp.gmail.com:587` (TLS).
- **Cấu hình Đăng nhập bằng Google (Google OAuth 2.0): **Tạo OAuth Client ID (loại Web Application, thêm `http://localhost:5173` vào Authorized JavaScript Origins) trên Google Cloud Console và chạy lệnh: `dotnet user-secrets set "Google:ClientId" "<client-id>.apps.googleusercontent.com" --project backend\SelfStorage.Api\SelfStorage.Api.csproj`.
- **Cấu hình Cổng thanh toán VNPay Sandbox & MoMo Sandbox: **Mở HTTPS tunnel công khai tới cổng `5080` (ví dụ: `ngrok http 5080`) để cổng thanh toán gọi được callback IPN, sau đó chạy `.\scripts\configure-vnpay-sandbox.ps1` hoặc `.\scripts\configure-momo-sandbox.ps1` và nhập thông số merchant ở chế độ ẩn an toàn.
### 6. Danh sách Tài khoản Kiểm thử Mặc định (Default Demo Accounts)

Khi khởi chạy môi trường Development lần đầu, hệ thống tự động khởi tạo 5 tài khoản mẫu đại diện cho đầy đủ 5 vai trò phân quyền (mật khẩu dùng chung: `Demo@12345`):


| Tài khoản | Mật khẩu | Vai trò (Role) | Phạm vi dữ liệu mẫu đi kèm |
| --- | --- | --- | --- |
| `customer1` | `Demo@12345` | Customer (Khách hàng) | Đang thuê kho B-01 tại Cơ sở Quận 7, CCCD 079200000123; có sẵn người vào kho ủy quyền (Nguyễn Thị Người Nhà – CCCD 079300000456). |
| `staff1` | `Demo@12345` | Facility Staff (Nhân viên cơ sở) | Được phân công trực tại Cơ sở Quận 7; đăng nhập vào thẳng màn hình Cổng ra vào (/gate). |
| `manager1` | `Demo@12345` | Facility Manager (Quản lý cơ sở) | Quản lý vận hành, danh mục kho, nhân sự phân công và báo cáo riêng của Cơ sở Quận 7. |
| `ops1` | `Demo@12345` | Business Operations Manager | Quản lý danh mục cơ sở toàn chuỗi, bảng giá chuẩn loại kho, chính sách thuê, biểu phí, khuyến mãi và báo cáo doanh thu. |
| `admin` | `Demo@12345` | System Administrator | Quản trị tài khoản & phân quyền toàn hệ thống, hợp đồng liên cơ sở, xử lý ticket toàn cục, hàng đợi email, đối soát thanh toán và nhật ký hoạt động. |

---

## III. User Manual

### 1. Overview

**Self-Storage Management System** là nền tảng web quản lý hoạt động cho thuê kho tự phục vụ (Self-Storage) tại nhiều cơ sở lưu trữ. Ứng dụng giải quyết trọn vẹn bài toán vận hành thực tế từ lúc khách hàng tìm kiếm kích thước kho phù hợp, đặt chỗ trực tuyến, thanh toán tiền cọc, hẹn lịch nhận bàn giao, ký kết hợp đồng thuê, ủy quyền người ra vào kho, kiểm soát an ninh ra/vào cổng bằng Căn cước công dân (CCCD) không dùng mã PIN, cho đến phát hành hóa đơn định kỳ tự động, xử lý sự cố theo danh mục kiểm tra (checklist), gia hạn, trả kho, cấn trừ đối soát tiền cọc và phân tích doanh thu toàn chuỗi.

#### 1.1. Phân quyền người dùng trên hệ thống (System Actors)


| Vai trò (Actor) | Giao diện chính | Chức năng cốt lõi được cấp quyền |
| --- | --- | --- |
| **Guest / Customer** (Khách vãng lai & Khách thuê) | Portal Khách hàng (`/`, `/rent`, `/my-units`) | Tra cứu cơ sở, loại kho, bảng giá & điều khoản; đặt kho (áp mã khuyến mãi), thanh toán VNPay/MoMo, hẹn giờ nhận kho; quản lý kho đang thuê, người vào kho, đăng ký lịch vào kho / đưa đồ vào kho; yêu cầu gia hạn (1–12 tháng), trả kho sớm, gửi yêu cầu hỗ trợ và xem biên lai điện tử. |
| **Facility Staff** (Nhân viên cơ sở) | Staff Console (`/gate`, `/reservations`, `/staff-*`) | Chỉ thao tác trong phạm vi cơ sở được phân công: duyệt lịch vào kho, kiểm tra CCCD cho khách vào/ra cổng; xác nhận thu cọc & bàn giao kho (check-in); thu tiền tại quầy, xử lý hoàn tiền cổng (RefundDue), duyệt gia hạn, duyệt hủy đặt kho, lập phụ phí, bàn giao trả kho & hoàn cọc, xử lý ticket theo checklist. |
| **Facility Manager** (Quản lý cơ sở) | Staff & Facility Console (`/facility*`) | Bao gồm toàn bộ quyền nghiệp vụ của Nhân viên cơ sở tại cơ sở mình phụ trách, cộng thêm: xem Dashboard vận hành cơ sở, thêm/sửa/xóa kho chưa phát sinh giao dịch, chuyển trạng thái bảo trì kho trống và gán/gỡ nhân viên vào cơ sở. |
| **Business Operations Manager** (Quản lý vận hành) | Operations Console (`/ops/*`) | Điều hành kinh doanh toàn hệ thống: thêm/cập nhật cơ sở lưu trữ, quản lý đơn giá chuẩn theo loại kho, cấu hình chính sách thuê (Rental Policies), biểu phí dịch vụ (Fees), chương trình khuyến mãi (Promotions) và xuất báo cáo doanh thu – tỷ lệ lấp đầy. |
| **System Administrator** (Quản trị hệ thống) | Admin Console (`/admin/*`) | Quản trị tối cao: tạo tài khoản nhân sự, cấp đổi vai trò, khóa/mở tài khoản; tra cứu khách hàng, kho lưu trữ & hợp đồng toàn hệ thống; can thiệp xử lý ticket liên cơ sở; theo dõi & gửi lại Email Outbox bị lỗi; phân tích biểu đồ doanh thu – hoàn tiền 12 tháng, đối soát giao dịch và tra cứu Activity Logs. |

#### 1.2. Tóm tắt các luồng nghiệp vụ khép kín (Core End-to-End Workflows)

- **Workflow 1 — Tài khoản, Đăng nhập & Bảo mật cá nhân: **Đăng ký, đăng nhập mật khẩu hoặc Google OAuth, quên mật khẩu qua email OTP/token, quản lý hồ sơ và tra cứu nhật ký bảo mật hợp nhất.
- **Workflow 2 — Đặt kho, Thanh toán cọc, Hẹn lịch & Bàn giao nhận kho: **Chọn cơ sở/loại kho -> Đặt kho sinh hóa đơn cọc -> Đóng cọc -> Đặt lịch hẹn trước 20:00 ngày bắt đầu -> Nhân viên check-in gán ô kho thực tế, sinh hợp đồng và hóa đơn thuê tháng đầu (hoặc xử lý hủy đơn đặt & hoàn cọc).
- **Workflow 3 — Ủy quyền người vào kho, Đăng ký lịch hẹn & Kiểm soát Cổng bằng CCCD: **Khách khai báo người vào kho -> Đăng ký khung giờ vào/ra (hoặc kê khai đồ chuyển vào) -> Nhân viên duyệt lịch -> Khách xuất trình thẻ CCCD gốc tại cổng -> Nhân viên nhập số CCCD xác thực Cho vào (Granted) / Từ chối (Denied) -> Xác nhận Ra về (Exited).
- **Workflow 4 — Phát hành Hóa đơn, Thanh toán Trực tuyến & Thu tiền tại Cơ sở: **Tự động phát hành hóa đơn thuê hằng tháng trước hạn 7 ngày kèm gửi email và chuông nhắc hạn -> Khách thanh toán VNPay/MoMo (xác nhận qua IPN) hoặc trả tại quầy -> Xuất biên lai điện tử & đối soát giao dịch treo/hoàn tiền.
- **Workflow 5 — Gia hạn Hợp đồng, Xử lý Quá hạn, Trả kho & Hoàn cọc: **Gia hạn trực tuyến 1–12 tháng/lần; tự động khóa kho và khấu trừ phí quá hạn sau 24 giờ trễ hạn; báo giá trả kho sớm, kiểm tra dọn kho, cấn trừ công nợ (DepositOffset) và hoàn trả tiền cọc còn dư.
- **Workflow 6 — Hỗ trợ Khách hàng & Xử lý Sự cố theo Checklist: **Khách gửi yêu cầu hỗ trợ theo kho -> Hệ thống sinh checklist chuẩn theo loại sự cố -> Nhân viên tiếp nhận, trao đổi tin nhắn, hoàn thành 100% mục kiểm tra để chuyển trạng thái Resolved -> Closed.
- **Workflow 7 — Quản lý Cơ sở, Cấu hình Vận hành & Quản trị Hệ thống: **Quản lý danh mục kho/bảo trì, nhân sự cơ sở, chính sách giá – phí – khuyến mãi, giám sát hàng đợi email và báo cáo phân tích doanh thu toàn hệ thống.
### 2. Workflow 1: Quản lý Tài khoản, Đăng nhập & Hồ sơ Bảo mật

**Mục đích: **Giúp khách hàng mới tự đăng ký tài khoản thuê kho, xác thực danh tính người dùng qua JWT hoặc Google OAuth, khôi phục mật khẩu an toàn qua email và tự quản lý thông tin cá nhân cũng như lịch sử bảo mật.


- **Bước 1 — Đăng ký tài khoản khách hàng (/register):** Từ Trang chủ (`/`), nhấn **Đăng ký**. Nhập đầy đủ Họ tên, Tên đăng nhập, Email, Số điện thoại (chuẩn hóa định dạng Việt Nam), Số CCCD 12 chữ số, Địa chỉ và Mật khẩu rồi bấm **Tạo tài khoản**.

- **Bước 2 — Đăng nhập & điều hướng theo vai trò (/login):** Nhập Tên đăng nhập/Email và Mật khẩu (hoặc chọn **Đăng nhập bằng Google** với tài khoản có cùng địa chỉ email đang hoạt động). Hệ thống cấp JWT và tự động chuyển tới trang làm việc tương ứng: Khách hàng về Trang chủ/Kho của tôi, Nhân viên cơ sở vào thẳng **Cổng ra vào** (`/gate`), Quản lý vận hành vào `/ops` và Quản trị viên vào `/admin`.

- **Bước 3 — Khôi phục mật khẩu khi quên (/forgot-password):** Nhấn **Quên mật khẩu?** tại màn hình đăng nhập, nhập email đã đăng ký để nhận mã token khôi phục qua hộp thư (hiệu lực 30 phút, dùng 1 lần, giới hạn chống dò quét 5 lần/15 phút mỗi IP), sau đó dán mã token và đặt mật khẩu mới.

- **Bước 4 — Cập nhật Hồ sơ, Đổi mật khẩu & Xem Nhật ký Bảo mật (/account/*):** Khách hàng truy cập **Tài khoản -> Hồ sơ cá nhân** (`/account/profile`) để sửa thông tin liên hệ, đổi mật khẩu tại `/account/password`, hoặc mở tab **Bảo mật tài khoản & hợp đồng** (`/account/security`) để kiểm tra nhật ký hợp nhất gồm lượt ra vào kho, giao dịch thanh toán và biến động hợp đồng. Với nhân viên/quản lý/admin, bấm tên tài khoản trên góc phải sẽ mở hộp thoại sửa hồ sơ nhanh ngay tại trang đang làm việc.

> **[Khung chèn ảnh Hình 1.1: Màn hình Đăng nhập / Đăng ký và Trang Hồ sơ & Nhật ký bảo mật khách hàng]**  
> *Chụp tại http://localhost:5173/login và http://localhost:5173/account/security (đăng nhập tài khoản customer1).*

### 3. Workflow 2: Đặt kho, Thanh toán Cọc, Hẹn lịch & Bàn giao Nhận kho

**Mục đích: **Thực hiện quy trình thuê kho mới từ bước khách hàng chọn cơ sở và kích thước kho, thanh toán tiền đặt cọc giữ chỗ, đặt lịch hẹn đến cơ sở, cho tới khi nhân viên kiểm tra thực tế và bàn giao ô kho để kích hoạt hợp đồng.


- **Bước 1 — Tra cứu bảng giá và tạo đơn đặt kho (/pricing, /rent):** Khách hàng tham khảo kích thước, sức chứa và biểu phí tại `/pricing`, sau đó mở trang **Thuê kho** (`/rent`): (1) Chọn Tỉnh/Thành và Cơ sở kho, xem số lượng kho trống theo từng loại kho; (2) Chọn Ngày bắt đầu thuê và gói Thời gian thuê (tháng), nhập Mã khuyến mãi (nếu là khách thuê lần đầu); (3) Kiểm tra khung tóm tắt tách rõ *Thanh toán hôm nay (Tiền cọc)* và *Các kỳ thanh toán tiếp theo*, đồng ý điều khoản và nhấn **Xác nhận đặt kho**. Hệ thống giữ chỗ tạm thời trong thời hạn `DepositPaymentHours` và phát hành ngay hóa đơn `DEPOSIT`.

- **Bước 2 — Thanh toán tiền cọc (/invoices hoặc tại quầy /reservations):** Khách hàng thanh toán hóa đơn cọc trực tuyến qua cổng VNPay/MoMo tại `/invoices` (hoặc nhân viên xác nhận đã thu cọc trực tiếp tại màn hình `/reservations`). Sau khi thu cọc, đơn đặt chuyển từ `PendingDeposit` sang `Confirmed`.

- **Bước 3 — Đặt lịch hẹn nhận kho (/reservations/:id/pickup) hoặc Hủy đơn đặt:** Trên đơn đặt đã xác nhận cọc, khách bấm **Đặt lịch nhận kho** (`/reservations/:id/pickup`) và chọn thời điểm đến cơ sở (bắt buộc trước **20:00** của ngày bắt đầu thuê). Nếu khách thay đổi nhu cầu trước khi nhận kho: đơn chưa cọc được hủy ngay miễn phí; đơn đã đóng cọc gửi yêu cầu hủy để nhân viên duyệt tại **Hủy đặt kho** (`/staff-cancellations`), hệ thống tự tính phí hủy theo `CancellationGraceHours` và nhân viên ghi nhận số tiền hoàn cọc thực tế.

- **Bước 4 — Nhân viên bàn giao kho & kích hoạt hợp đồng (/reservations):** Khi khách đến cơ sở đúng giờ hẹn, nhân viên đăng nhập (`staff1`), mở mục **Đơn đặt & Bàn giao** (`/reservations`), chọn ô kho trống cụ thể thuộc đúng loại kho khách đặt và bấm **Check-in / Bàn giao kho**. Hệ thống tự động tạo Hợp đồng thuê ở trạng thái `Active`, đổi trạng thái kho sang `Rented` và phát hành hóa đơn tiền thuê tháng đầu tiên (`MONTHLY_RENT`, đã trừ khuyến mãi nếu có).

> **[Khung chèn ảnh Hình 2.1: Màn hình Đặt kho (/rent) của Khách hàng và Màn hình Bàn giao kho (/reservations) của Nhân viên]**  
> *Chụp bước chọn gói thuê tại http://localhost:5173/rent (customer1) và màn hình Check-in gán kho tại http://localhost:5173/reservations (staff1).*

### 4. Workflow 3: Người vào kho, Đăng ký Lịch hẹn & Kiểm soát Cổng bằng CCCD

**Mục đích: **Đảm bảo an ninh vật lý tuyệt đối cho tài sản lưu kho thông qua quy trình đăng ký lịch trước và đối chiếu thẻ CCCD trực tiếp bởi nhân viên trực cổng (không dùng mã PIN tĩnh dễ lộ lọt).


- **Bước 1 — Khai báo Người vào kho thay chủ hợp đồng (/my-units hoặc /my-units/:id):** Tại trang **Kho của tôi** (`/my-units`) hoặc chi tiết kho (`/my-units/:id`), khách bấm **Người vào kho** để thêm thông tin người thân/nhân viên vận chuyển được phép vào kho (Họ tên, SĐT, Số CCCD riêng và mối quan hệ), hoặc thu hồi quyền bất cứ lúc nào.

- **Bước 2 — Đăng ký lịch vào kho hoặc lịch đưa đồ vào kho (/visit, /my-units/:id/move-in):** Khách hàng mở **Lịch vào kho** (`/visit` hoặc `/my-units/:id/visit`), chọn kho thuê, chọn người sẽ đến (Chủ hợp đồng hoặc Người vào kho đã khai báo — số CCCD phải khớp hồ sơ), chọn khung giờ dự kiến vào – ra nằm trong giờ hoạt động của cơ sở và nhập mục đích. Nếu chuyển hàng hóa số lượng lớn, khách dùng màn hình **Đưa đồ vào kho** (`/my-units/:id/move-in`) để kê khai kích thước kiện hàng và kiểm tra thanh ước tính thể tích (`m³`) trước khi gửi lịch. Khách có thể chủ động hủy lịch khi chưa sử dụng.

- **Bước 3 — Nhân viên duyệt lịch hẹn trước (/gate):** Tại màn hình **Cổng ra vào** (`/gate`), nhân viên xem danh sách *Lịch đăng ký chờ duyệt*, kiểm tra tình trạng kho/khung giờ và nhấn **Duyệt (Approve)** hoặc **Từ chối (Reject)** kèm ghi chú.

- **Bước 4 — Xác thực CCCD cho khách vào kho & xác nhận ra về (/gate):** Khi khách đến cổng trong khung giờ đã duyệt: (1) Nhân viên gõ tìm kiếm theo Mã kho, Tên khách, SĐT, Số hợp đồng hoặc Số CCCD; (2) Hệ thống tự động kiểm tra điều kiện an toàn (hợp đồng còn hiệu lực, không nợ quá số ngày khóa kho, kho không bị khóa/bảo trì, khách chưa ở sẵn bên trong); (3) Nhân viên cầm thẻ CCCD vật lý của khách, gõ chính xác dãy số CCCD vào ô đối chiếu và nhấn **Xác nhận đúng người, cho vào** (ghi nhận `Granted`) — hoặc nếu sai người/sai lịch/kho bị chặn thì chọn lý do và bấm **Ghi nhận từ chối** (`Denied`); (4) Khi khách rời kho, nhân viên chọn dòng tương ứng trong danh sách *Đang ở trong kho* và nhấn **Xác nhận ra** để đóng lượt truy cập.

> **[Khung chèn ảnh Hình 3.1: Màn hình Đăng ký lịch vào kho (/visit) và Màn hình Trực cổng xác thực CCCD (/gate)]**  
> *Chụp tại http://localhost:5173/visit (customer1) và http://localhost:5173/gate (staff1 tìm kho B-01 / CCCD 079300000456).*

### 5. Workflow 4: Hóa đơn Định kỳ, Thanh toán Trực tuyến & Thu tiền tại Cơ sở

**Mục đích: **Tự động hóa chu kỳ thu phí thuê kho hằng tháng, hỗ trợ thanh toán trực tuyến an toàn qua cổng VNPay / MoMo với xác thực chữ ký IPN, đồng thời cung cấp công cụ thu ngân – lập phụ phí – xử lý hoàn tiền chặt chẽ cho nhân viên cơ sở.


- **Bước 1 — Phát hành hóa đơn tự động & cảnh báo nhắc hạn:** Dịch vụ nền `MonthlyRentInvoiceService` tự động phát hành hóa đơn `MONTHLY_RENT` trước ngày đến hạn kỳ mới tối đa 7 ngày, đồng thời xếp thư thông báo vào hàng đợi `EmailOutboxMessages`. Trên giao diện khách hàng, biểu tượng **Chuông thông báo** góc phải trên cùng tự động hiển thị số lượng hóa đơn chưa thanh toán / quá hạn kèm liên kết mở thẳng tới hóa đơn.

- **Bước 2 — Khách hàng thanh toán qua VNPay / MoMo và xem biên lai (/invoices, /invoices/:id):** Khách hàng vào **Thanh toán** (`/invoices`) hoặc chi tiết hóa đơn (`/invoices/:id`), chọn phương thức thanh toán trực tuyến (VNPay hoặc MoMo QR/Deeplink). Hệ thống khởi tạo giao dịch `Pending` (giữ hiệu lực liên kết trong **15 phút**; nếu khách thoát giữa chừng sau 15 phút có thể bấm hủy giao dịch treo hoặc tạo liên kết thanh toán mới). Sau khi cổng gửi callback **IPN** hợp lệ, hóa đơn chuyển sang `Paid`, hệ thống tự gửi email biên nhận và khách có thể xem/in **Biên lai điện tử** ngay trên trang chi tiết hóa đơn.

- **Bước 3 — Nhân viên lập phụ phí, thu tiền tại quầy & xử lý RefundDue (/facility-contracts, /staff-billing):** Khi phát sinh phí dịch vụ (vệ sinh kho, làm lại khóa, bồi thường hư hỏng...), nhân viên mở **Hợp đồng cơ sở** (`/facility-contracts`) và bấm lập hóa đơn phụ phí (`EXTRA_CHARGE`). Tại màn hình **Hóa đơn & Thu tiền** (`/staff-billing`), nhân viên có thể ghi nhận khoản thu thực tế kèm mã chứng từ không trùng lặp, hủy hóa đơn chưa thu hoặc ghi nhận hoàn trả các khoản thanh toán cổng về muộn khi hóa đơn đã đóng (`RefundDue`).

> **[Khung chèn ảnh Hình 4.1: Màn hình Danh sách Hóa đơn & Biên lai điện tử (/invoices/:id) và Màn hình Thu ngân cơ sở (/staff-billing)]**  
> *Chụp tại http://localhost:5173/invoices (customer1) và http://localhost:5173/staff-billing (staff1).*

### 6. Workflow 5: Gia hạn Hợp đồng, Xử lý Quá hạn, Trả kho & Hoàn cọc

**Mục đích: **Quản lý vòng đời kết thúc hoặc kéo dài hợp đồng thuê kho: cho phép khách gia hạn linh hoạt từ 1 đến 12 tháng, tự động xử lý khóa kho & khấu trừ phí quá hạn, hoặc thực hiện trả kho (đúng hạn / trước hạn) kèm đối soát công nợ và hoàn cọc minh bạch.


- **Bước 1 — Yêu cầu gia hạn hợp đồng 1–12 tháng (/my-units/:id/renew & /staff-contracts):** Khi hợp đồng đang ở trạng thái `Active` (trước **20:00** ngày kết thúc, không nợ hóa đơn quá hạn và không có yêu cầu trả sớm đang chờ), khách mở **Gia hạn hợp đồng** (`/my-units/:id/renew`), chọn số tháng muốn gia hạn thêm (**từ 1 đến 12 tháng/lần**) và gửi yêu cầu. Hệ thống sinh hóa đơn `RENEWAL` tương ứng; khách có thể tự hủy yêu cầu gia hạn nếu đổi ý trước khi thanh toán. Ngay khi hóa đơn gia hạn được thanh toán qua cổng trực tuyến (hoặc được nhân viên xác nhận thu phí tại `/staff-contracts`), ngày kết thúc hợp đồng (`EndDate`) được cộng nối tiếp tự động.

- **Bước 2 — Dịch vụ tự động khóa kho & tính phí quá hạn (OverdueService):** Nếu quá hạn hợp đồng sau **24 giờ** mà kho chưa được bàn giao trả, dịch vụ nền `OverdueService` tự động chuyển trạng thái hợp đồng sang `Overdue`, khóa quyền ra vào cổng của kho và tính phí lưu kho quá hạn hằng ngày bằng `MonthlyRentFee / 30` khấu trừ dần vào số dư tiền cọc.

- **Bước 3 — Báo giá và gửi yêu cầu trả kho sớm (/my-units/:id/early-return):** Trường hợp khách muốn kết thúc hợp đồng trước ngày hết hạn, khách vào **Trả kho sớm** (`/my-units/:id/early-return`) để xem bảng tạm tính tự động (phí chấm dứt trước hạn theo chính sách, các khoản nợ cần cấn trừ và số tiền cọc dự kiến được nhận lại), nhập lý do và gửi yêu cầu trả kho sớm.

- **Bước 4 — Bàn giao trả kho, cấn trừ DepositOffset & hoàn cọc (/staff-return):** Khách dọn sạch đồ đạc trong kho trước khi bàn giao. Nhân viên mở **Trả kho, Quá hạn & Hoàn cọc** (`/staff-return`), kiểm tra thực địa tình trạng kho, tích xác nhận khách đã dọn hết tài sản, nhập biên bản hiện trạng và nhấn **Xác nhận trả kho**. Hệ thống tự động đối soát phí quá hạn/phí trả sớm, cấn trừ tiền cọc vào các hóa đơn tiền thuê/phụ thu còn nợ (`DepositOffset` — hoặc lập hóa đơn phần vượt cọc nếu cọc không đủ), chuyển hợp đồng sang `Terminated` và mở kho về `Available`. Cuối cùng, nhân viên bấm **Hoàn cọc** để ghi nhận số tiền hoàn trả thực tế cho khách (không vượt quá số dư cọc sau đối soát).

> **[Khung chèn ảnh Hình 5.1: Màn hình Gia hạn hợp đồng (/my-units/:id/renew), Trả kho sớm (/early-return) và Màn hình Trả kho & Hoàn cọc (/staff-return)]**  
> *Chụp tại http://localhost:5173/my-units/1/renew (customer1) và http://localhost:5173/staff-return (staff1).*

### 7. Workflow 6: Yêu cầu Hỗ trợ & Xử lý Sự cố theo Checklist

**Mục đích: **Chuẩn hóa quy trình tiếp nhận và khắc phục sự cố tại kho lưu trữ bằng danh sách bước kiểm tra bắt buộc (Checklist) theo từng phân loại yêu cầu, đảm bảo không bỏ sót bước nghiệp vụ trước khi đóng ticket.


- **Bước 1 — Khách hàng gửi yêu cầu hỗ trợ & phản hồi (/support):** Khách hàng mở trang **Hỗ trợ** (`/support`), chọn kho đang thuê gặp vấn đề, chọn loại sự cố, mức độ ưu tiên (Bình thường / Khẩn cấp) và mô tả chi tiết (hệ thống tự chặn gửi trùng ticket cùng kho – cùng loại đang mở hoặc spam liên tiếp). Ngay khi tạo, hệ thống khởi tạo danh sách mục kiểm tra (`SupportChecklist`) tương ứng với loại sự cố. Khách có thể theo dõi tiến độ từng mục checklist và nhắn tin trao đổi trực tiếp trong ticket.

- **Bước 2 — Nhân viên tiếp nhận, hoàn thành Checklist & giải quyết (/staff-support):** Nhân viên cơ sở vào **Hỗ trợ khách hàng** (`/staff-support`), chọn ticket mới (`Open`) và chuyển sang **Đang xử lý (InProgress)**. Trong quá trình kiểm tra thực tế tại kho, nhân viên đánh dấu hoàn thành từng mục trong Checklist kèm ghi chú kết quả; hệ thống chỉ cho phép chuyển trạng thái ticket sang **Đã giải quyết (Resolved)** sau khi 100% mục checklist đã hoàn tất. Nếu khách gửi thêm phản hồi vào ticket đang `Resolved`, hệ thống tự động mở lại trạng thái `InProgress` để nhân viên tiếp tục hỗ trợ trước khi đóng hẳn (`Closed`).

> **[Khung chèn ảnh Hình 6.1: Màn hình Gửi & Theo dõi Hỗ trợ của Khách hàng (/support) và Màn hình Xử lý Checklist của Nhân viên (/staff-support)]**  
> *Chụp tại http://localhost:5173/support (customer1) và http://localhost:5173/staff-support (staff1).*

### 8. Workflow 7: Quản lý Cơ sở, Cấu hình Vận hành & Quản trị Hệ thống

**Mục đích: **Cung cấp bộ bảng điều khiển chuyên biệt cho cấp Quản lý cơ sở (Facility Manager), Quản lý vận hành chuỗi (Business Operations Manager) và Quản trị viên hệ thống (System Administrator) để điều hành tài nguyên kho, chính sách giá – phí và giám sát toàn bộ dữ liệu giao dịch.

#### 8.1. Dành cho Quản lý Cơ sở — Facility Manager (/facility, /facility-units, /facility-staff)

- **Tổng quan cơ sở (/facility): **Theo dõi danh sách công việc trong ngày (lịch hẹn nhận kho, đơn chờ xử lý), tỷ lệ lấp đầy kho, hợp đồng sắp hết hạn/quá hạn, doanh thu thu được tại cơ sở và số ticket hỗ trợ đang mở.
- **Quản lý kho tại cơ sở (/facility-units): **Thêm ô kho mới, cập nhật mã/tầng/khu vực, xóa kho chưa từng phát sinh dữ liệu thuê, hoặc chuyển kho trống sang trạng thái **Đang bảo trì (UnderMaintenance)** và mở lại `Available` khi hoàn tất (hệ thống tự chặn đưa kho vào bảo trì nếu làm thiếu số lượng kho đang giữ chỗ cho các đơn đã đặt).
- **Quản lý nhân sự cơ sở (/facility-staff): **Xem danh sách nhân viên trực thuộc cơ sở, gán tài khoản nhân viên mới vào cơ sở bằng mã người dùng hoặc kết thúc phân công.
#### 8.2. Dành cho Quản lý Vận hành — Business Operations Manager (/ops/*)

- **Quản lý Cơ sở & Kho toàn chuỗi (/ops/facilities, /ops/storage): **Thêm cơ sở lưu trữ mới, cập nhật địa chỉ, số điện thoại, giờ mở cửa (`08:00 - 20:00` hoặc `24/7 Access`), trạng thái hoạt động và điều chỉnh **Đơn giá niêm yết chuẩn theo từng Loại kho** (áp dụng thống nhất cho tính cọc, hợp đồng mới và gia hạn).
- **Cấu hình Chính sách, Phí dịch vụ & Khuyến mãi (/ops/policies): **Thiết lập chính sách thuê theo cơ sở (tỷ lệ cọc, số giờ hạn đóng cọc `DepositPaymentHours`, số giờ hủy miễn phí `CancellationGraceHours`, số ngày nợ tối đa trước khi khóa kho `MaxOverdueDaysBeforeLock`), cập nhật biểu phí phụ thu và tạo/ngừng các mã khuyến mãi theo phần trăm hoặc số tiền cố định.
- **Báo cáo Vận hành & Doanh thu (/ops, /ops/revenue): **Xem bảng tổng hợp doanh thu, hoàn tiền, công suất khai thác từng cơ sở theo khoảng thời gian lọc và tải xuống báo cáo chi tiết định dạng `.csv`.
#### 8.3. Dành cho Quản trị Hệ thống — System Administrator (/admin/*)

- **Quản lý Tài khoản & Phân quyền (/admin/users): **Tạo tài khoản nhân viên/quản lý mới, chỉnh sửa thông tin hồ sơ, thay đổi vai trò (Role) và khóa/mở khóa tài khoản (token JWT của tài khoản vừa bị khóa hoặc đổi vai trò sẽ lập tức bị từ chối ở lần gọi API kế tiếp).
- **Quản trị Khách hàng, Hợp đồng, Kho & Hỗ trợ liên cơ sở (/admin/customers, /admin/contracts, /admin/storage, /admin/support): **Tra cứu trạng thái thuê của toàn bộ khách hàng (Đang thuê / Sắp hết hạn / Quá hạn), xem và điều chỉnh ngày kết thúc/điều khoản hợp đồng đang hiệu lực, giám sát kho toàn chuỗi và trực tiếp xử lý các ticket hỗ trợ liên cơ sở.
- **Giám sát Hàng đợi Email, Phân tích Doanh thu & Đối soát Nhật ký (/admin/emails, /admin/revenue, /admin/system): **Theo dõi trạng thái gửi thư trong **Email Outbox** và bấm **Retry** với các email giao dịch bị lỗi sau 8 lần thử tự động; xem biểu đồ xu hướng Doanh thu – Hoàn tiền 12 tháng, cơ cấu doanh thu theo loại kho và danh sách khách hàng chi tiêu cao tại `/admin/revenue`; đối soát từng giao dịch thanh toán VNPay/MoMo và tra cứu vết thao tác người dùng (`ActivityLogs`) tại `/admin/system`.

> **[Khung chèn ảnh Hình 7.1: Bảng điều khiển Quản lý Cơ sở (/facility), Quản lý Vận hành (/ops/policies) và Quản trị Hệ thống (/admin/revenue, /admin/system)]**  
> *Chụp lần lượt với tài khoản manager1 (/facility), ops1 (/ops/policies) và admin (/admin/revenue, /admin/system).*
