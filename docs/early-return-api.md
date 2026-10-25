# API trả kho sớm

Trang **Trả kho & Hoàn cọc** (`frontend/src/pages/StaffReturn.tsx`) đã có luồng trả kho sớm. Frontend gọi 2 API dưới đây; chế độ demo (`npm run dev:demo`) đã giả lập sẵn trong `frontend/src/mock/server.ts`.

Quy tắc đề xuất: trả trước 20:00 ngày hết hạn là trả sớm. Không hoàn tiền thuê đã trả; thu phí trả sớm (phí cấu hình `EARLY_RETURN_FEE` trong `FeeConfigurations`, demo dùng 200.000đ) và trừ vào cọc trước; hủy các hóa đơn tiền thuê chưa thanh toán của kỳ sau ngày trả; ngày kết thúc hợp đồng đổi thành ngày trả thực tế.

## 1. Xem trước chi phí

`GET /api/contracts/{id}/early-return-quote` — nhân viên, quản lý cơ sở (cơ sở được phân công).

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
