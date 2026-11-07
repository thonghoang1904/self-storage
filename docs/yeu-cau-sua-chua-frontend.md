# Tài Liệu Yêu Cầu Sửa Chữa Phía Frontend (Luồng Khách Hàng)

> **Bối cảnh:** Toàn bộ các lỗi nghiệp vụ phía Backend (`SelfStorage.Api`) trên luồng khách hàng đã được khắc phục xong, đảm bảo **tương thích ngược 100%** với Frontend hiện tại. Thư mục `frontend/` hoàn toàn chưa bị can thiệp. Tài liệu này ghi nhận chi tiết toàn bộ các hạng mục Frontend cần cập nhật để khai thác đầy đủ API/DTO mới và xử lý triệt để các lỗi hiển thị, múi giờ, validation và trải nghiệm người dùng.

---

## Tổng Quan Các Thay Đổi Backend Đã Sẵn Sàng Cho Frontend

| Nhóm thay đổi | Endpoint / DTO Backend | Mô tả ngắn |
|---|---|---|
| Thông số kho trên hợp đồng | `GET /api/contracts/{id}` (`ContractDetailDto`) | Bổ sung 10 trường cuối DTO: `floorNumber`, `zoneArea`, `unitTypeId`, `unitTypeName`, `lengthMeters`, `widthMeters`, `heightMeters`, `volumeCubicMeters`, `hasClimateControl`, `operatingHours`. |
| Chính sách, bảng phí & khuyến mãi công khai | `GET /api/facilities/{facilityId}/rental-policy`<br>`GET /api/fees`<br>`GET /api/promotions` | Mở public (`[AllowAnonymous]`) để khách xem đúng tỷ lệ cọc, số giờ giữ chỗ, số giờ hủy miễn phí, bảng phí phát sinh và danh sách mã khuyến mãi đang hiệu lực. |
| Hủy & giới hạn gia hạn 1–12 tháng | `POST /api/contracts/{id}/renewals`<br>`DELETE /api/contracts/{id}/renewals/{renewalId}` | Giới hạn `extensionMonths` mỗi lần gia hạn từ `1–60` xuống **`1–12` tháng**; cho phép khách tự hủy yêu cầu gia hạn đang `Pending` (khi hóa đơn chưa thanh toán), tự động hủy hóa đơn `RENEWAL` đi kèm. |
| Hủy lịch ra/vào đã duyệt | `DELETE /api/contracts/{id}/visit-registrations/{registrationId}` | Cho phép khách hủy cả lịch `Pending` **lẫn lịch `Approved`** chưa sử dụng và chưa quá `scheduledExitAt`. |
| Phản hồi & mở lại ticket hỗ trợ | `POST /api/support-requests/{requestId}/messages` | Khi khách gửi tin nhắn vào ticket đang `Resolved`, Backend tự động mở lại trạng thái về `InProgress` và xóa `ResolvedAt`. |
| Thanh toán trực tuyến VNPay / MoMo | `POST /api/invoices/{id}/checkout/{provider}`<br>`GET /api/payments/momo/return`<br>`POST /api/payments/{id}/cancel` | Hạn liên kết chờ thanh toán giảm từ `30` xuống **`15` phút**; tự hết hạn giao dịch cũ khi tạo checkout mới sau 15 phút; `momo/return` xác thực chữ ký và trả `?gateway=momo&paymentReturn=1&result=success\|failed`. |
| Lọc & phân trang hóa đơn | `GET /api/invoices/my?contractId=&reservationId=&page=1&pageSize=200` | Bổ sung bộ lọc theo `contractId`, `reservationId`, phân trang (`page`, `pageSize <= 500`) và header `X-Total-Count`. |

---

## Bảng Phân Loại & Mức Độ Ưu Tiên Sửa Chữa Frontend

| Mã | Mức độ | Hạng mục sửa chữa | Các file Frontend cần sửa |
|---|---|---|---|
| **FE-01** | Nghiêm trọng | Đọc thông số kho & loại kho trực tiếp từ `ContractDetail` thay vì `GET /api/facilities/{id}/units` | `src/types.ts`, `src/pages/ContractDetail.tsx`, `src/pages/MoveInRegistration.tsx`, `src/pages/ContractPolicy.tsx`, `src/components/unitPhoto.tsx` |
| **FE-02** | Nghiêm trọng | Đồng bộ hiển thị lịch thanh toán `paymentSchedule` với kỳ hóa đơn thực tế từ Backend | `src/pages/ContractDetail.tsx` |
| **FE-03** | Nghiêm trọng | Bổ sung UI hủy đơn đặt kho chưa cọc & gửi/theo dõi yêu cầu hủy đơn đã đặt cọc | `src/pages/MyUnits.tsx`, `src/pages/PickupAppointment.tsx`, `src/pages/Invoices.tsx` |
| **FE-04** | Nghiêm trọng | Mở nút Hủy cho lịch vào kho & lịch chuyển đồ ở trạng thái `Approved` (chưa sử dụng) | `src/pages/VisitRegistration.tsx`, `src/pages/MoveInRegistration.tsx` |
| **FE-05** | Nghiêm trọng | Bổ sung ô nhập/chọn Mã khuyến mãi (`promoCode`) và tính nhẩm giảm giá trên trang Đặt kho | `src/pages/Rent.tsx`, `src/types.ts` |
| **FE-06** | Nghiêm trọng | Thay các con số chính sách & bảng phí hardcode bằng dữ liệu động từ API public mới | `src/pages/Rent.tsx`, `src/pages/Pricing.tsx`, `src/pages/ContractPolicy.tsx`, `src/pages/Terms.tsx`, `src/types.ts` |
| **FE-07** | Trung bình | Bổ sung nút Hủy yêu cầu gia hạn (`Pending`) và khóa chéo UI Gia hạn ↔ Trả kho sớm | `src/pages/ContractDetail.tsx`, `src/pages/ContractRenew.tsx` |
| **FE-08** | Trung bình | Sửa parser `operatingHours` (`"24/7 Access"`) và lỗi lệch múi giờ UTC vs `+07:00` | `src/components/appointment.tsx`, `src/pages/VisitRegistration.tsx`, `src/pages/MoveInRegistration.tsx` |
| **FE-09** | Trung bình | Đồng bộ `CANCEL_AFTER_MS = 15 phút`, trạng thái thanh toán còn thiếu và tùy chọn MoMo | `src/pages/Invoices.tsx`, `src/components/checkout.tsx`, `src/pages/InvoiceDetail.tsx` |
| **FE-10** | Trung bình | Bổ sung form gửi phản hồi & mở lại ticket hỗ trợ cho khách hàng | `src/pages/Support.tsx` |
| **FE-11** | Thấp / UX | Kiểm tra sớm tài khoản thiếu CCCD trước khi đặt kho & khi Admin đổi vai trò | `src/pages/Rent.tsx`, `src/pages/AdminUsers.tsx` (nếu có form gán role) |
| **FE-12** | Thấp / Hiệu năng | Dùng query filter `?contractId=` cho hóa đơn và đồng bộ mock server (`dev:demo`) | `src/pages/ContractDetail.tsx`, `src/pages/Invoices.tsx`, `src/mock/server.ts` |

---

## Chi Tiết Từng Yêu Cầu Sửa Chữa

### FE-01 — Đọc thông số kho & ảnh minh họa từ `ContractDetail` (Khắc phục lỗi `—` và `capacity = 0`)

#### 1. Hiện trạng & Nguyên nhân lỗi
Endpoint `GET /api/facilities/{facilityId}/units` chỉ trả danh sách các kho đang `Available` đối với tài khoản Khách hàng (ẩn danh sách kho `Rented`/`OverdueLocked` của khách khác để bảo mật). Do đó, khi kho đã ký hợp đồng (`Status = 'Rented'`), lệnh `us.find((x) => x.unitId === d.unitId)` luôn trả về `undefined`, gây lỗi ở **4 nơi**:
1. `frontend/src/pages/ContractDetail.tsx` (dòng `101–105`, `127`, `131`, `204–219`): Tên loại kho, diện tích `m²`, kích thước `D × R × C`, vị trí `Tầng / Khu`, điều hòa đều hiển thị `—`.
2. `frontend/src/pages/MoveInRegistration.tsx` (dòng `118–121`, `151–152`, `435`, `441–446`): `type` luôn `null` → `capacity` luôn `= 0` → thanh tiến trình thể tích (`volume / capacity`) và cảnh báo vượt sức chứa kho (`fill > 100%`) bị vô hiệu hóa hoàn toàn.
3. `frontend/src/pages/ContractPolicy.tsx` (`useContract` dòng `65`, `ContractStrip` dòng `104–110`): `unitType` luôn là `""` trên cả 3 trang `ContractPolicy`, `ContractRenew`, `ContractEarlyReturn`.
4. `frontend/src/components/unitPhoto.tsx` (`ContractUnitArt` dòng `18–38`): Không tìm thấy kho nên luôn rơi về ảnh mặc định `variant = 2` (kho vừa) cho mọi hợp đồng.

#### 2. Dữ liệu Backend đã bổ sung
`GET /api/contracts/{id}` hiện trả thêm trong `ContractDetailDto`:
```ts
export interface ContractDetail {
  // ... các trường cũ giữ nguyên ...
  floorNumber: number
  zoneArea: string | null
  unitTypeId: number
  unitTypeName: string
  lengthMeters: number
  widthMeters: number
  heightMeters: number
  volumeCubicMeters: number
  hasClimateControl: boolean
  operatingHours: string
}
```

#### 3. Yêu cầu sửa phía Frontend
- **`frontend/src/types.ts` (dòng `301–319`):** Mở rộng interface `ContractDetail` với 10 trường trên.
- **`frontend/src/pages/ContractDetail.tsx` (dòng `101–108`, `127–131`, `204–219`):**
  - Bỏ lời gọi thừa `GET /api/facilities/${d.facilityId}/units` và `GET /api/unit-types`.
  - Đọc trực tiếp `c.unitTypeName`, `c.unitTypeId`, `c.lengthMeters`, `c.widthMeters`, `c.heightMeters`, `c.floorNumber`, `c.zoneArea`, `c.hasClimateControl`, và `c.operatingHours || facility?.operatingHours`.
- **`frontend/src/pages/MoveInRegistration.tsx` (dòng `118–121`, `128`, `151`, `435`, `440`):**
  - Bỏ lời gọi `GET /api/facilities/${d.facilityId}/units` và `GET /api/unit-types`.
  - Tính `capacity = c.volumeCubicMeters || (c.lengthMeters * c.widthMeters * c.heightMeters)` trực tiếp từ `c`.
  - Lấy giờ mở cửa từ `c.operatingHours || facility?.operatingHours`.
- **`frontend/src/pages/ContractPolicy.tsx` (`useContract` dòng `54–73`):**
  - Bỏ lời gọi `GET /api/facilities/${d.facilityId}/units`; gán `unitType = d.unitTypeName` và dùng `d.operatingHours || facility?.operatingHours`.
- **`frontend/src/components/unitPhoto.tsx` (`ContractUnitArt` dòng `28–39`):**
  - Cho phép truyền tùy chọn `unitTypeName?: string` và `unitTypeId?: number` vào props của `ContractUnitArt`. Nếu đã có `unitTypeName` hoặc `unitTypeId` thì gọi thẳng `photoVariant(unitTypeName, unitTypeId)` ngay lập tức, không cần gọi mạng `facilityUnits(facilityId)`.

---

### FE-02 — Đồng bộ bảng `paymentSchedule` với hóa đơn thực tế trên `ContractDetail.tsx`

#### 1. Hiện trạng & Nguyên nhân lỗi
Trong `frontend/src/pages/ContractDetail.tsx` (hàm `paymentSchedule` ở phần đầu file, khoảng dòng `50–80`), Frontend tự sinh danh sách kỳ thuê bằng cách cộng tháng thủ công và ghép với hóa đơn. Khi hợp đồng bắt đầu vào ngày `29`, `30`, `31` hoặc đi qua tháng 2 (ví dụ `31/01 -> 28/02 -> 31/03`) hoặc đã gia hạn nhiều lần:
- Backend (`MonthlyRentInvoiceService`) đã sửa cách tính kỳ là `[StartDate.AddMonths(m), min(StartDate.AddMonths(m + 1), EndDate))` và bỏ qua các tháng nằm trong khoảng gia hạn đã thanh toán (`RENEWAL`).
- Nếu Frontend tự suy diễn kỳ khác với `billingPeriodStart` / `billingPeriodEnd` trên hóa đơn hoặc không tính đến các đợt `Renewal` có `status === 'Paid'`, bảng lịch thanh toán sẽ hiển thị thừa kỳ ảo hoặc không khớp được hóa đơn thực.

#### 2. Yêu cầu sửa phía Frontend
- **`frontend/src/pages/ContractDetail.tsx`:**
  - Truyền danh sách `renewals` (các bản ghi `status === 'Paid'` có khoảng `[oldEndDate, newEndDate)`) vào `paymentSchedule(c, invoices, renewals)`.
  - Với các kỳ đã nằm trọn trong một khoảng gia hạn `Paid` (`periodStart >= r.oldEndDate && periodStart < r.newEndDate`), hiển thị trạng thái **"Đã thanh toán (qua gia hạn)"** gắn với hóa đơn `RENEWAL` tương ứng thay vì báo "Sắp tới / Chưa lập hóa đơn".
  - Khi hợp đồng có yêu cầu trả kho sớm đang `Pending` (`returnDate`), đánh dấu các kỳ `periodStart >= returnDate` là *"Sẽ hủy khi hoàn tất trả sớm"* để khách không nhầm lẫn phải đóng thêm.

---

### FE-03 — Bổ sung chức năng Hủy đơn đặt kho (Chưa đặt cọc & Đã đặt cọc)

#### 1. Hiện trạng & Nguyên nhân lỗi
Backend đã có đầy đủ 3 API hủy đơn cho khách hàng (và đã sửa lỗi hoàn cọc 100% trong khung giờ ân hạn kể cả khi quá 20:00 mà nhân viên chưa kịp bấm duyệt):
- `POST /api/reservations/{id}/cancel` — Hủy trực tiếp ngay lập tức khi đơn đang `PendingDeposit` (chưa thanh toán cọc).
- `POST /api/reservations/{id}/cancellation-requests` (body `{ reason: string }`) — Gửi yêu cầu hủy đơn và hoàn cọc khi đơn đang `Confirmed` (đã thanh toán cọc, trước `20:00` ngày `expectedStartDate`).
- `GET /api/reservations/{id}/cancellation-requests/my` — Xem lịch sử yêu cầu hủy, trạng thái (`Pending` / `Approved` / `Rejected`), ghi chú giải quyết và số tiền cọc được duyệt hoàn (`approvedRefundAmount`).

Tuy nhiên hiện tại trên `MyUnits.tsx` (`OrderCard`, dòng `305–338`), `PickupAppointment.tsx` (dòng `46–77`) và `Invoices.tsx` (dòng `183–195`) **hoàn toàn không có nút Hủy đơn nào**, khiến khách đổi ý phải chờ hết hạn giữ chỗ (chiếm giữ kho trống) hoặc chịu mất phí không đến nhận kho (no-show).

#### 2. Yêu cầu sửa phía Frontend
- **`frontend/src/pages/MyUnits.tsx` (`OrderCard`, dòng `305–338`):**
  - Khi `r.status === 'PendingDeposit'` và chưa quá hạn cọc: thêm nút phụ **"Hủy đặt kho"** bên cạnh nút *"Thanh toán cọc"*. Khi xác nhận, gọi `POST /api/reservations/${r.reservationId}/cancel` rồi tải lại danh sách đơn.
  - Khi `r.status === 'Confirmed'` và chưa quá `20:00` ngày `expectedStartDate`:
    - Tải `GET /api/reservations/${r.reservationId}/cancellation-requests/my`.
    - Nếu đã có yêu cầu `Pending`: hiển thị thông báo *"Đang chờ nhân viên duyệt yêu cầu hủy đơn"* (ẩn hoặc khóa nút đặt giờ nhận kho).
    - Nếu chưa có yêu cầu `Pending`: thêm nút **"Yêu cầu hủy & hoàn cọc"** mở hộp nhập lý do (`reason` bắt buộc, tối đa 1000 ký tự) → gọi `POST /api/reservations/${r.reservationId}/cancellation-requests`. Hiển thị rõ chính sách hủy của cơ sở (hủy miễn phí 100% trong `cancellationGraceHours` đầu kể từ lúc đặt, sau đó trừ `cancellationFeePercent%`).
  - Nếu khách có đơn vừa được `Approved` hủy và có `approvedRefundAmount > 0`: hiển thị thông tin số tiền được duyệt hoàn để khách dễ đối chiếu.
- **`frontend/src/pages/PickupAppointment.tsx` (dòng `46–57`):**
  - Bổ sung liên kết / nút mở form **"Yêu cầu hủy đơn"** ngay dưới thông tin đơn `Confirmed` (hoặc hiển thị trạng thái yêu cầu hủy nếu đang `Pending`).
- **`frontend/src/pages/Invoices.tsx` (dòng `175–181`):**
  - Với hóa đơn `DEPOSIT` đang `Unpaid` thuộc đơn `PendingDeposit`, có thể thêm nút phụ **"Hủy đơn đặt kho"** gọi `POST /api/reservations/${invoice.reservationId}/cancel` để khách hủy trực tiếp nếu đặt nhầm loại kho/cơ sở.

---

### FE-04 — Cho phép khách hủy lịch vào kho & lịch chuyển đồ ở trạng thái `Approved`

#### 1. Hiện trạng & Nguyên nhân lỗi
- **`frontend/src/pages/VisitRegistration.tsx` (dòng `421`):** `{r.status === 'Pending' && <button ... onClick={() => cancel(r)}>Hủy</button>}`
- **`frontend/src/pages/MoveInRegistration.tsx` (dòng `420`):** `{r.status === 'Pending' && <button ... onClick={() => cancel(r)}>Hủy</button>}`

Trước đây chỉ hiện nút `Hủy` khi `r.status === 'Pending'`. Khi nhân viên đã bấm `Approved`, nếu khách bận đột xuất hoặc muốn đổi sang khung giờ khác trong cùng ngày, khách không thể hủy lịch cũ và bị chặn bởi lỗi trùng lịch (`409 Conflict`). Backend nay đã cho phép `DELETE /api/contracts/{id}/visit-registrations/{registrationId}` đối với lịch `Approved` chưa check-in tại cổng và chưa quá `scheduledExitAt`.

#### 2. Yêu cầu sửa phía Frontend
- Tại cả **`VisitRegistration.tsx` (dòng `421`)** và **`MoveInRegistration.tsx` (dòng `420`)**, sửa điều kiện hiển thị nút `Hủy` thành:
  ```tsx
  const canCancel = r.status === 'Pending'
    || (r.status === 'Approved' && new Date(r.scheduledExitAt).getTime() > Date.now())
  ```
- Cập nhật câu xác nhận khi hủy lịch `Approved`: *"Hủy lịch đã được duyệt này? Bạn sẽ cần đăng ký lại nếu muốn vào kho khung giờ khác."*

---

### FE-05 — Bổ sung ô nhập/chọn Mã khuyến mãi (`promoCode`) trên trang Đặt kho (`Rent.tsx`)

#### 1. Hiện trạng & Nguyên nhân lỗi
- Trang `Pricing.tsx` (dòng `174–176`) quảng cáo: *"Có Mã Khuyến Mãi? Nhập mã khi đặt kho để được giảm trên hóa đơn thuê đầu tiên."*
- Thế nhưng `Rent.tsx` (dòng `94`) lại gửi cứng `promoCode: null` và không có bất kỳ ô nhập hay danh sách khuyến mãi nào trên giao diện!

#### 2. API Backend đã sẵn sàng
- `GET /api/promotions` (`[AllowAnonymous]`) trả danh sách `PromotionDto[]` đang hoạt động và còn hạn hôm nay:
  ```ts
  export interface Promotion {
    promotionId: number
    promoCode: string
    title: string
    discountPercent: number
    maxDiscountAmount: number | null
    minRentalMonths: number
    startDate: string
    endDate: string
    isActive: boolean
  }
  ```
- `POST /api/reservations` nhận `promoCode: string | null` (áp dụng cho khách thuê kho lần đầu, thuê tối thiểu `minRentalMonths` tháng, trừ vào hóa đơn tiền thuê tháng đầu tiên).

#### 3. Yêu cầu sửa phía Frontend
- **`frontend/src/types.ts`:** Thêm interface `Promotion` (nếu chưa export cho luồng khách).
- **`frontend/src/pages/Rent.tsx`:**
  - Gọi `GET /api/promotions` khi mở trang để gợi ý các mã ưu đãi đang mở (ví dụ chip bấm nhanh chọn mã nếu `months >= p.minRentalMonths`).
  - Thêm ô nhập **Mã khuyến mãi** trong cột `aside.order-summary` (trước mục tổng tiền, dòng `210`).
  - Kiểm tra điều kiện hiển thị tạm tính giảm giá kỳ đầu:
    `discount = min(round(monthly * discountPercent / 100), maxDiscountAmount ?? Infinity)` khi `months >= minRentalMonths` (kèm chú thích *"Ưu đãi áp dụng cho khách lần đầu thuê kho, trừ vào hóa đơn tiền thuê tháng đầu"*).
  - Tại hàm `reserve()` (dòng `93–95`), truyền `promoCode: promoCode.trim().toUpperCase() || null` thay vì `promoCode: null`.

---

### FE-06 — Đồng bộ động Chính sách cơ sở (`RentalPolicy`) & Bảng phí (`FeeConfigurations`)

#### 1. Hiện trạng & Nguyên nhân lỗi
Nhiều văn bản và công thức tính tiền trên giao diện đang hardcode cứng theo cấu hình mặc định:
- `Rent.tsx` (dòng `109`, `217–218`, `230`): Hardcode tiền cọc `= fmtMoney(monthly)` (100% giá tháng) và giữ đơn `24 giờ`. Nếu quản lý cấu hình cơ sở có `depositPercent = 50%` hoặc `depositPaymentHours = 12`, số tiền *"Thanh toán hôm nay"* trên `Rent.tsx` sẽ sai lệch hoàn toàn so với hóa đơn `DEPOSIT` Backend tạo ra!
- `Pricing.tsx` (dòng `31`, `81`, `88`): Hardcode *"Tiền cọc (1 tháng thuê)"*.
- `types.ts` (dòng `241–247`) & `ContractPolicy.tsx` (dòng `173–175`): Dùng mảng tĩnh `ExtraChargeFees` (thiếu `EARLY_RETURN_FEE` và không phản ánh số tiền thực tế khi Quản lý Vận hành cập nhật cấu hình phí).

#### 2. API Backend đã mở công khai
- `GET /api/facilities/{facilityId}/rental-policy` → trả `EffectiveRentalPolicy`:
  ```ts
  export interface EffectiveRentalPolicy {
    facilityId: number | null
    minDurationMonths: number
    renewalNoticeDays: number
    maxOverdueDaysBeforeLock: number
    maxOverdueDaysBeforeLiquidation: number
    depositPercent: number
    depositPaymentHours: number
    cancellationGraceHours: number
    cancellationFeePercent: number
  }
  ```
- `GET /api/fees` → trả `FeeConfiguration[]` (`feeTypeId`, `feeCode`, `feeName`, `defaultAmount`, `calculationMethod`, `description`).

#### 3. Yêu cầu sửa phía Frontend
- **`frontend/src/pages/Rent.tsx`:**
  - Khi `facilityId` thay đổi (dòng `58–65`), gọi thêm `GET /api/facilities/${facilityId}/rental-policy`.
  - Giới hạn chọn số tháng `months >= policy.minDurationMonths` (disable các nút `DURATIONS` nhỏ hơn `minDurationMonths`).
  - Tính tiền cọc hiển thị ở mục *"Thanh toán hôm nay"* (dòng `218`): `Math.round(monthly * policy.depositPercent / 100)`.
  - Hiển thị đúng số giờ giữ chỗ `policy.depositPaymentHours` giờ, hủy miễn phí trong `policy.cancellationGraceHours` giờ đầu, sau đó phí hủy `policy.cancellationFeePercent%` cọc (dòng `109`, `230`).
- **`frontend/src/pages/ContractPolicy.tsx` (dòng `172–178`):**
  - Gọi `GET /api/fees` (với fallback về `ExtraChargeFees` nếu lỗi mạng) để hiển thị đúng bảng phí phát sinh hiện hành của hệ thống (bao gồm cả `EARLY_RETURN_FEE`).
- **`frontend/src/pages/Pricing.tsx`:**
  - Nếu đọc được chính sách chung hoặc phí, cập nhật nhãn cọc/FAQ cho khớp thực tế.

---

### FE-07 — Hủy yêu cầu gia hạn (`Pending`) & Khóa chéo Gia hạn ↔ Trả kho sớm

#### 1. Hiện trạng & Nguyên nhân lỗi
- Trước đây khách bấm nhầm số tháng gia hạn trên `ContractRenew.tsx` hoặc `ContractDetail.tsx` (`RenewalPanel`) sẽ tạo ra yêu cầu `Pending` kèm hóa đơn `RENEWAL` `Unpaid` nhưng **không có nút hủy** để chọn lại số tháng khác.
- Ngoài ra, Backend hiện đã chặn xung đột nghiệp vụ:
  - Không cho gửi yêu cầu gia hạn khi đang có yêu cầu trả kho sớm `Pending` hoặc khi hợp đồng còn hóa đơn tiền thuê/phụ thu quá hạn chưa thanh toán.
  - Không cho gửi yêu cầu trả kho sớm khi đang có yêu cầu gia hạn `Pending`.

#### 2. API Backend đã bổ sung
- `DELETE /api/contracts/{id}/renewals/{renewalId}` (Role: `Storage Customer`) → Hủy yêu cầu gia hạn đang `Pending` và hủy luôn hóa đơn `RENEWAL` chưa thanh toán.

#### 3. Yêu cầu sửa phía Frontend
- **`frontend/src/pages/ContractDetail.tsx` (`RenewalPanel` dòng `331–339` & `EarlyReturnPanel` dòng `388–518`):**
  - Trong `RenewalPanel` khi có `pending`: thêm nút **"Thanh toán ngay"** (`/invoices/${pending.invoiceId}`) và nút **"Hủy yêu cầu gia hạn"** (gọi `DELETE /api/contracts/${c.contractId}/renewals/${pending.renewalId}`, sau đó gọi `await onChanged()`).
  - Đổi nhãn lịch sử gia hạn khi `status === 'Rejected'` thành *"Đã hủy / Từ chối"* để thân thiện khi chính khách là người hủy.
  - Nếu hợp đồng đang có yêu cầu trả kho sớm `Pending`, hiển thị thông báo nhắc khách hủy yêu cầu trả sớm trước khi gia hạn (và ngược lại trong `EarlyReturnPanel`, nếu `pendingRenewal` tồn tại thì nhắc khách hoàn tất hoặc hủy yêu cầu gia hạn trước khi đăng ký trả sớm).
- **`frontend/src/pages/ContractRenew.tsx` (dòng `148–154`, `127`):**
  - Dưới nút *"Thanh toán phí gia hạn"* (dòng `149`), bổ sung nút `btn outline block` **"Hủy yêu cầu để chọn lại số tháng"** gọi `DELETE /api/contracts/${c.contractId}/renewals/${pending.renewalId}` rồi gọi `await reload()`.

---

### FE-08 — Sửa parser `operatingHours` (`"24/7 Access"`) & lỗi múi giờ UTC trên `VisitRegistration.tsx`

#### 1. Hiện trạng & Nguyên nhân lỗi
1. **Lỗi parser giờ mở cửa cho kho 24/7:**
   Trong database (`01_schema.sql`), giá trị mặc định của `Facilities.OperatingHours` là `"24/7 Access"`. Thế nhưng cả 3 hàm `openHours` / `hours` ở Frontend:
   - `frontend/src/components/appointment.tsx` (dòng `11–15`)
   - `frontend/src/pages/VisitRegistration.tsx` (dòng `25–28`)
   - `frontend/src/pages/MoveInRegistration.tsx` (dòng `41–44`)
   đều chỉ match regex `/(\d{1,2})[:h](\d{2})?\s*[-–]\s*(\d{1,2})[:h](\d{2})?/` (thiếu cả dấu em-dash `—` và không nhận diện `"24/7"`, `"24/24"`, `"24h"`), dẫn đến âm thầm fallback về `[8 * 60, 20 * 60]` (`08:00 - 20:00`), khóa mất khung giờ sáng sớm và tối muộn của cơ sở hoạt động 24/7!
2. **Lỗi so sánh chuỗi múi giờ UTC với giờ địa phương `+07:00`:**
   Tại `frontend/src/pages/VisitRegistration.tsx` (`VisitHub`, dòng `82–83`):
   ```ts
   const now = new Date().toISOString().slice(0, 16) // <-- Giờ UTC! (VD: 10:00Z khi ở VN là 17:00)
   const upcoming = (booked ?? []).filter((r) =>
     (r.status === 'Pending' || r.status === 'Approved') && r.scheduledExitAt.slice(0, 16) >= now)
   ```
   Trong khi `r.scheduledExitAt` từ API trả về có offset `+07:00` (VD: `"2026-11-06T15:00:00+07:00"`), cắt `.slice(0, 16)` rồi so sánh chuỗi trực tiếp với giờ UTC làm lệch **7 tiếng** — các lịch đã qua từ 6 tiếng trước vẫn hiện trong *"Lịch sắp tới"*!

#### 2. Yêu cầu sửa phía Frontend
- **Tạo hàm dùng chung `parseOperatingHours(raw?: string): [number, number]`** (ví dụ đặt trong `src/components/appointment.tsx` và import sang `VisitRegistration.tsx` & `MoveInRegistration.tsx`), đồng bộ hoàn toàn với `OperatingHoursParser` của Backend:
  ```ts
  export function parseOperatingHours(raw?: string): [number, number] {
    if (!raw) return [8 * 60, 20 * 60]
    if (/24\/7|24\/24|24h/i.test(raw)) return [0, 24 * 60]
    const m = raw.match(/(?<!\d)(\d{1,2})[:h](\d{2})?\s*[-–—]\s*(\d{1,2})[:h](\d{2})?(?!\d)/i)
    if (!m) return [8 * 60, 20 * 60]
    const open = Number(m[1]) * 60 + Number(m[2] ?? 0)
    const close = Number(m[3]) * 60 + Number(m[4] ?? 0)
    return open < close && close <= 24 * 60 ? [open, close] : [8 * 60, 20 * 60]
  }
  ```
  *(Lưu ý: với `MoveInRegistration` và `VisitRegistration`, khi `close === 24 * 60`, đảm bảo `toHHMM` hiển thị `"23:59"` hoặc gửi mốc kết thúc hợp lệ trong ngày để không sinh chuỗi `"24:00:00+07:00"` không hợp lệ chuẩn ISO trong một số trình duyệt; riêng ngày `endDate` của hợp đồng vẫn giới hạn trước `20:00`).*
- **`frontend/src/pages/VisitRegistration.tsx` (`VisitHub`, dòng `82–84`):**
  So sánh theo epoch milliseconds thay vì cắt chuỗi:
  ```ts
  const nowMs = Date.now()
  const upcoming = (booked ?? [])
    .filter((r) => (r.status === 'Pending' || r.status === 'Approved')
      && new Date(r.scheduledExitAt).getTime() >= nowMs)
    .sort((x, y) => new Date(x.scheduledEntryAt).getTime() - new Date(y.scheduledEntryAt).getTime())
  ```

---

### FE-09 — Cập nhật luồng Thanh toán trực tuyến (`Invoices.tsx`, `checkout.tsx`, `InvoiceDetail.tsx`)

#### 1. Hiện trạng & Nguyên nhân lỗi
1. **`frontend/src/pages/Invoices.tsx` (dòng `231`):** Hằng số `CANCEL_AFTER_MS = 30 * 60 * 1000` (30 phút) đang lệch với Backend (`BillingService.PendingPaymentCancelAfter` nay là **15 phút**, khớp thời hạn liên kết thanh toán 15 phút của VNPay/MoMo). Khách phải đợi thêm 15 phút không cần thiết mới thấy nút *"Hủy giao dịch"*.
2. **`frontend/src/components/checkout.tsx` (dòng `36–42`):**
   - `PAY_METHOD` thiếu `DepositOffset: 'Cấn trừ tiền cọc'`.
   - `PAY_STATUS` thiếu `RefundDue: { label: 'Cơ sở sẽ hoàn tiền', tone: 'warn' }` và `Reversed: { label: 'Đã hoàn tiền', tone: 'muted' }`.
   Các map này được `InvoiceDetail.tsx` dùng để hiển thị chi tiết hóa đơn nên sẽ hiện mã tiếng Anh thô khi gặp các trạng thái trên.
3. **Hỗ trợ cổng MoMo (tùy chọn cấu hình hệ thống):** `PayButtons` và `useCheckout` trong `components/checkout.tsx` (dòng `7–32`) hiện chỉ gọi `/api/invoices/${invoiceId}/checkout/vnpay`, trong khi Backend đã hỗ trợ đầy đủ cả `momo` (trả `paymentUrl`, `qrCodeUrl`, `deeplink`) và `GET /api/payments/momo/return` trả `?gateway=momo&paymentReturn=1&result=success|failed`.

#### 2. Yêu cầu sửa phía Frontend
- **`frontend/src/pages/Invoices.tsx` (dòng `231`):** Đổi `const CANCEL_AFTER_MS = 15 * 60 * 1000` (và cập nhật comment phía trên từ 30 phút thành 15 phút).
- **`frontend/src/components/checkout.tsx` (dòng `36–42`):** Bổ sung đầy đủ `DepositOffset`, `RefundDue`, `Reversed` vào `PAY_METHOD` và `PAY_STATUS` (hoặc hợp nhất một bản duy nhất giữa `checkout.tsx` và `Invoices.tsx` để tránh lệch).
- **`frontend/src/components/checkout.tsx` (`useCheckout` & `PayButtons`):** Mở tham số `provider: 'vnpay' | 'momo' = 'vnpay'` cho `startCheckout(invoiceId, provider)` và bổ sung nút **"Thanh toán MoMo"** (hiển thị modal QR nếu chỉ có `qrCodeUrl` hoặc chuyển hướng `checkout.paymentUrl`) nếu dự án bật cổng MoMo trong cấu hình.

---

### FE-10 — Bổ sung khung gửi tin nhắn phản hồi & mở lại ticket hỗ trợ (`Support.tsx`)

#### 1. Hiện trạng & Nguyên nhân lỗi
Backend có sẵn `POST /api/support-requests/{requestId}/messages` (body `{ message: string }`) cho cả Khách hàng và Nhân viên, đồng thời nay đã hỗ trợ **tự động mở lại ticket từ `Resolved` sang `InProgress`** khi khách phản hồi rằng sự cố chưa được xử lý triệt để.
Tuy nhiên trong `frontend/src/pages/Support.tsx` (`RequestCard`, dòng `146–198`), khách hàng chỉ xem được `timeline` một chiều mà không có ô nhập phản hồi (`children` không được truyền gì ở dòng `134`).

#### 2. Yêu cầu sửa phía Frontend
- **`frontend/src/pages/Support.tsx` (`RequestCard` dòng `146–198` và `Support` dòng `133–135`):**
  - Khi `r.status !== 'Closed'`, hiển thị form phản hồi gọn bên dưới `ol.timeline`:
    - `textarea` nhập nội dung phản hồi (`1–2000` ký tự, trim khoảng trắng).
    - Nếu `r.status === 'Resolved'`, hiển thị chú thích nhỏ: *"Gửi phản hồi sẽ mở lại yêu cầu hỗ trợ để nhân viên tiếp tục xử lý."*
    - Khi bấm **Gửi phản hồi**, gọi `POST /api/support-requests/${r.requestId}/messages` với `{ message }`, sau đó tải lại cả `updates` lẫn danh sách ticket `load()` (để badge trạng thái trên thẻ cập nhật từ `Resolved` sang `InProgress`).
  - Khi `r.status === 'Closed'`, hiển thị dòng ghi chú *"Yêu cầu hỗ trợ này đã đóng. Vui lòng tạo yêu cầu mới nếu bạn cần hỗ trợ thêm."*

---

### FE-11 — Kiểm tra sớm CCCD trên `Rent.tsx` & màn quản trị tài khoản

#### 1. Hiện trạng & Nguyên nhân lỗi
- Một tài khoản khách hàng do Admin tạo trước đây có thể chưa có `citizenId` (nay Backend đã chặn tạo/sửa `Storage Customer` thiếu CCCD trong `SystemAdminController`, đồng thời cho phép khách thiếu CCCD tự bổ sung 1 lần duy nhất tại `/account/profile/edit`).
- Nếu tài khoản cũ chưa có CCCD vào đặt kho trên `Rent.tsx`, họ vẫn đặt và thanh toán cọc được nhưng đến khi nhận kho / đăng ký vào kho sẽ bị vướng xác thực CCCD.

#### 2. Yêu cầu sửa phía Frontend
- **`frontend/src/pages/Rent.tsx`:**
  - Gọi `GET /api/auth/profile` khi vào trang Đặt kho. Nếu `!profile.citizenId`, hiển thị cảnh báo nổi bật ở Bước 2 kèm nút dẫn sang `/account/profile/edit` (*"Tài khoản của bạn chưa cập nhật số CCCD. Vui lòng bổ sung CCCD trước khi đặt kho để nhân viên đối chiếu khi bàn giao"*), và khóa nút sang Bước 3 cho đến khi có CCCD.
- **Trang quản trị người dùng (`AdminUsers`):**
  - Khi Admin sửa thông tin người dùng có vai trò `Storage Customer` hoặc đổi vai trò sang `Storage Customer`, bắt buộc trường `citizenId` trên form (đồng bộ với validation `400 BadRequest` mới ở `PUT /api/admin/users/{userId}` và `PUT /api/admin/users/{userId}/role`).

---

### FE-12 — Tối ưu tải hóa đơn theo hợp đồng & Đồng bộ Mock Server (`dev:demo`)

#### 1. Hiện trạng & Nguyên nhân lỗi
- `ContractDetail.tsx` (dòng `100`) đang gọi `GET /api/invoices/my` (lấy toàn bộ hóa đơn của khách) rồi `.filter((i) => i.contractId === id)` ở client. Với khách thuê nhiều kho lâu năm, hóa đơn cũ của hợp đồng có thể vượt quá giới hạn trang đầu.
- Chế độ chạy demo (`npm run dev:demo` dùng `frontend/src/mock/server.ts`) cần phản ánh đúng các endpoint/trường mới để không bị lệch hành vi giữa môi trường demo và môi trường API thật.

#### 2. Yêu cầu sửa phía Frontend
- **`frontend/src/pages/ContractDetail.tsx` (dòng `100`):**
  - Đổi lời gọi sang `api<Invoice[]>(`/api/invoices/my?contractId=${id}&pageSize=200`)` (vẫn có thể giữ `.filter((i) => i.contractId === id)` để an toàn tương thích với mock cũ).
- **`frontend/src/pages/Invoices.tsx` (dòng `37`):**
  - Hỗ trợ đọc header `X-Total-Count` hoặc nút *"Tải thêm hóa đơn"* (`?page=2&pageSize=200`) nếu khách có trên 200 hóa đơn.
- **`frontend/src/mock/server.ts`:**
  - Bổ sung 10 trường thông số kho vào phản hồi mock của `GET /api/contracts/:id`.
  - Bổ sung handler mock cho:
    - `GET /api/facilities/:id/rental-policy`
    - `GET /api/fees`
    - `GET /api/promotions`
    - `DELETE /api/contracts/:id/renewals/:renewalId`
    - Tại dòng `1020` (`POST /api/contracts/:id/renewals`): sửa điều kiện `months >= 1 && months <= 60` thành `months >= 1 && months <= 12` (thông báo `'Thời gian gia hạn mỗi lần phải từ 1 đến 12 tháng'`) để khớp giới hạn 12 tháng mới của Backend.
    - Cho phép `DELETE /api/contracts/:id/visit-registrations/:registrationId` khi `status === 'Approved'`
    - Cho phép `POST /api/support-requests/:id/messages` mở lại ticket `Resolved` → `InProgress`.

---

## Danh Sách Kiểm Thử Nghiệm Thu (Checklist Sau Khi Sửa Frontend)

1. Mở chi tiết một hợp đồng đang thuê (`/my-units/:id`): hiển thị đầy đủ tên loại kho, diện tích `m²`, kích thước `D × R × C`, tầng/khu, điều hòa, giờ mở cửa và đúng ảnh minh họa theo cỡ kho (không còn dấu `—`).
2. Mở trang Đăng ký đưa đồ vào kho (`/my-units/:id/move-in`): nhập kích thước món đồ thấy thanh tiến trình thể tích (`m³`) hoạt động và cảnh báo đỏ khi vượt `100%` thể tích kho.
3. Với cơ sở có `OperatingHours = "24/7 Access"`: đặt được lịch vào kho / chuyển đồ ngoài khung `08:00–20:00` (ví dụ `06:30` hoặc `21:30`); trang `/visit` hiển thị đúng danh sách *"Lịch sắp tới"* theo giờ Việt Nam `+07:00`.
4. Đặt kho tại `/rent`: thấy đúng tỷ lệ cọc và giờ giữ chỗ theo `rental-policy` của cơ sở đang chọn; nhập được mã khuyến mãi hợp lệ và thấy số tiền giảm kỳ đầu.
5. Tạo đơn đặt kho `PendingDeposit`: bấm **Hủy đặt kho** thành công ngay trên `/my-units`. Với đơn đã thanh toán cọc (`Confirmed`): gửi được **Yêu cầu hủy & hoàn cọc** và xem được trạng thái chờ duyệt / số tiền hoàn.
6. Với lịch vào kho đã được nhân viên `Approved` (nhưng chưa vào kho): khách bấm **Hủy** thành công và đăng ký lại được khung giờ mới trùng ngày.
7. Gửi yêu cầu gia hạn hợp đồng rồi bấm **Hủy yêu cầu gia hạn** khi chưa thanh toán: yêu cầu hủy thành công, hóa đơn `RENEWAL` chuyển sang `Cancelled`, khách chọn lại được số tháng mới.
8. Trên trang `/invoices`: giao dịch VNPay/MoMo treo quá **15 phút** cho phép bấm **Hủy giao dịch** hoặc bấm thanh toán lại ngay mà không bị kẹt 30 phút.
9. Trên trang `/support`: khách gửi được tin nhắn phản hồi vào ticket đang mở; nếu ticket đang `Resolved`, sau khi khách gửi phản hồi trạng thái tự chuyển lại về `InProgress`.

