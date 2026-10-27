# API trả kho sớm

> **Đã làm ở backend** (`ContractsController`, bảng `EarlyReturnRequests` trong `database/14_early_return_requests.sql`, phí `EARLY_RETURN_FEE` = 200.000đ trong `FeeConfigurations`). Chạy backend ở Development thì migration tự áp dụng; database cũ chạy `database/upgrade_existing.sql` hoặc `scripts/RESET-DATABASE.bat`.

Trang **Trả kho & Hoàn cọc** của nhân viên (`frontend/src/pages/StaffReturn.tsx`) và trang **chi tiết hợp đồng** của khách (`frontend/src/pages/ContractDetail.tsx`, nút "Trả kho sớm") đã có luồng trả kho sớm. Frontend gọi các API dưới đây; chế độ demo (`npm run dev:demo`) đã giả lập sẵn trong `frontend/src/mock/server.ts`.

Quy tắc đề xuất: trả trước 20:00 ngày hết hạn là trả sớm. Không hoàn tiền thuê đã trả; thu phí trả sớm (phí cấu hình `EARLY_RETURN_FEE` trong `FeeConfigurations`, demo dùng 200.000đ) và trừ vào cọc trước; hủy các hóa đơn tiền thuê chưa thanh toán của kỳ sau ngày trả; ngày kết thúc hợp đồng đổi thành ngày trả thực tế.

## 1. Xem trước chi phí

`GET /api/contracts/{id}/early-return-quote?returnDate=2026-10-28` — nhân viên, quản lý cơ sở (cơ sở được phân công) và khách hàng (hợp đồng của mình). `returnDate` không bắt buộc, mặc định hôm nay; `daysEarly` tính từ ngày này đến ngày hết hạn.

```json
{
  "contractId": 1002,
  "endDate": "2027-04-24",
  "daysEarly": 180,
  "earlyReturnFee": 200000,
  "lateFees": 0,
  "depositPaid": 1200000,
  "depositDeducted": 200000,
  "depositRefundDue": 1000000,
  "amountStillOwed": 0,
  "invoicesCancelled": 1
}
```

Trả `409` nếu hợp đồng đã đến lịch trả kho (không còn là trả sớm). Khi API lỗi, frontend vẫn cho làm và ghi "phí theo chính sách".

## 2. Hoàn tất trả kho

Giữ `POST /api/contracts/{id}/return`, thêm 2 trường khi trả sớm:

```json
{
  "unitConditionNotes": "…",
  "allItemsRemoved": true,
  "staffNotes": null,
  "earlyReturn": true,
  "earlyReturnReason": "Khách chuyển nhà sớm"
}
```

- Trước lịch trả kho mà không có `earlyReturn: true` thì vẫn trả `409` như hiện tại.
- `earlyReturnReason` bắt buộc khi trả sớm, 5–500 ký tự.
- Kết quả thêm `earlyReturnFee`; phí này **đã cộng vào** `lateFeesDeducted` / `lateFeesStillOwed` như phí quá hạn, để hoàn cọc (`POST /api/contracts/{id}/deposit-refunds`) tính đúng số còn hoàn.

## 3. Khách gửi yêu cầu trả sớm

Khách hẹn ngày đến trả kho; nhân viên hoàn tất bằng API ở mục 2 tại cơ sở.

`POST /api/contracts/{id}/early-return-requests` — khách hàng, hợp đồng của mình.

```json
{ "returnDate": "2026-10-28", "reason": "Chuyển nhà sớm" }
```

Kết quả (dùng chung cho các API bên dưới):

```json
{
  "requestId": 7,
  "contractId": 1002,
  "contractNumber": "HD-20261024-435185",
  "unitCode": "B-01",
  "customerName": "Nguyễn Văn Khách",
  "returnDate": "2026-10-28",
  "reason": "Chuyển nhà sớm",
  "earlyReturnFee": 200000,
  "status": "Pending",
  "requestedAt": "2026-10-26T00:25:00"
}
```

- Hợp đồng phải `Active`, chưa đến ngày hết hạn; `returnDate` từ hôm nay đến **trước** ngày hết hạn; `reason` 5–500 ký tự.
- Mỗi hợp đồng chỉ một yêu cầu `Pending`; trùng thì `409`.
- `status`: `Pending` → `Completed` (khi nhân viên hoàn tất trả sớm ở mục 2) hoặc `Cancelled` (khách hủy).

`GET /api/contracts/{id}/early-return-requests` — khách xem các yêu cầu của hợp đồng (mới nhất trước).

`DELETE /api/contracts/{id}/early-return-requests/{requestId}` — khách hủy yêu cầu đang `Pending` (`409` nếu đã xong/đã hủy).

`GET /api/contracts/facilities/{facilityId}/early-return-requests` — nhân viên, quản lý cơ sở: các yêu cầu `Pending` của cơ sở, sắp theo `returnDate`. Trang Trả kho hiện thành danh sách "Khách hẹn trả sớm" và điền sẵn lý do.

Khi chưa có các API này, trang khách báo "liên hệ cơ sở để hẹn trả kho" (404/405), trang nhân viên bỏ qua danh sách.
