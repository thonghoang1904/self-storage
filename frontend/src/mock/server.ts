/**
 * Demo mode only (VITE_MOCK=true): an in-browser stand-in for the ASP.NET Core API so the frontend
 * can be tried without .NET or SQL Server. It follows the same rules as the real backend
 * (AccessService, ReservationsController, ...) and seeds the same demo data as DevSeeder.
 * Data lives in localStorage of this browser only; "Đặt lại dữ liệu demo" wipes it.
 */
import type {
  AccessIssue, ActivityLog, AdminUser, AdminContract, EmailOutboxMessage, OperationsReportRow, CancellationRequest, CancellationRefund, ExtraChargeInvoice, FacilityStaff, FacilityWorkQueue, FacilityTaskContract, FacilityReport, OperationsReport, AccessRecord, Availability, Contract, ContractDetail, Facility, Invoice, LoginResponse,
  OverdueSummary, Person, Renewal, SupportChecklistItem, SupportRequest, SupportUpdate, Reservation, ReturnUnitResult, StaffContract, StorageUnit, UnitType, UserDto, VisitCandidate, VisitRegistration, RentalPolicy, FeeConfiguration, Promotion,
} from '../types'
import { Roles } from '../types'

export const DEMO_PASSWORD = 'Demo@12345'
const DB_KEY = 'ss_mock_db_v12'

// ------------------------------------------------------------------ data model

interface User { userId: number; username: string; password: string; fullName: string; email: string; phoneNumber: string; citizenId: string | null; role: string; status?: string }
interface Unit { unitId: number; facilityId: number; unitTypeId: number; unitCode: string; floorNumber: number; zoneArea: string; monthlyPrice: number; status: string }
interface Rsv { reservationId: number; reservationCode: string; customerId: number; facilityId: number; unitTypeId: number; assignedUnitId: number | null; expectedStartDate: string; checkInAppointmentAt?: string | null; durationMonths: number; depositAmount: number; estimatedTotalFee: number; status: string; depositDeadline: string; createdAt: string; promoCode?: string | null; promotionDiscountAmount?: number; depositWasPaid?: boolean }
interface Ctr { contractId: number; contractNumber: string; customerId: number; unitId: number; startDate: string; endDate: string; monthlyRentFee: number; depositPaid: number; status: string; signedDate?: string; termsConditions?: string | null }
interface Rnw { renewalId: number; contractId: number; oldEndDate: string; newEndDate: string; extensionMonths: number; renewalFee: number; status: string; requestedAt: string }
interface Sup { requestId: number; requestCode: string; customerId: number; facilityId: number; contractId: number; unitId: number; assignedStaffId: number | null; category: string; priority: string; title: string; description: string; status: string; createdAt: string; resolvedAt: string | null; checklist?: Chk[] }
interface Chk { checklistItemId: number; sortOrder: number; description: string; isCompleted: boolean; completedAt: string | null; completedByStaffId: number | null; notes: string | null }
interface SupUpd { updateId: number; requestId: number; updatedByUserId: number; actionMessage: string; previousStatus: string | null; newStatus: string | null; createdAt: string }
interface Ovd { overdueId: number; contractId: number; daysOverdue: number; accumulatedLateFee: number; lockAppliedAt: string; resolvedAt: string | null }
interface AuthPerson { authorizedPersonId: number; contractId: number; fullName: string; phoneNumber: string; citizenId: string; relationship: string | null; status: string }
interface Vreg { visitRegistrationId: number; contractId: number; customerId: number; authorizedPersonId: number | null; scheduledEntryAt: string; scheduledExitAt: string; purpose: string; status: string; requestedAt: string; reviewedAt: string | null; reviewNotes: string | null }
interface Rec { accessRecordId: number; contractId: number; facilityId: number; unitId: number; authorizedPersonId: number | null; verifiedByStaffId: number; result: 'Granted' | 'Denied'; denyReason: string | null; purpose: string | null; companionCount?: number; entryTime: string; exitTime: string | null }

interface Db {
  seq: number
  users: User[]
  facilities: Facility[]
  assignments: { facilityId: number; staffId: number; assignedDate?: string }[]
  unitTypes: UnitType[]
  units: Unit[]
  reservations: Rsv[]
  contracts: Ctr[]
  persons: AuthPerson[]
  records: Rec[]
  /** Visit registrations (VisitRegistrations table): customer books a time, staff approves, the gate only admits approved ones. */
  visits: Vreg[]
  policies?: RentalPolicy[]
  fees?: FeeConfiguration[]
  promotions?: Promotion[]
  renewals: Rnw[]
  /** Monthly rent paid at the counter in the demo, by `${contractId}:${periodStart}`. */
  rentPaid?: Record<string, Paid>
  overdues: Ovd[]
  supports: Sup[]
  supportUpdates: SupUpd[]
  refunds?: { contractId: number; amount: number; at: string }[]
  logs?: (ActivityLog & { userId: number })[]
  /** ReservationCancellationRequests; refunds of an approved one are kept with it. */
  cancellations?: Cnl[]
  /** Extra-charge invoices a facility billed on a contract (FacilityManagementController.CreateExtraCharge). */
  extraCharges?: Xtra[]
  /** EmailOutboxMessages: invoice and receipt emails (sent by a worker in the real backend). */
  emails?: (EmailOutboxMessage & { emailOutboxMessageId: number })[]
}
interface Cnl { cancellationRequestId: number; reservationId: number; customerId: number; reason: string; status: string; requestedAt: string; resolvedAt: string | null; resolvedByStaffId: number | null; resolutionNotes: string | null; approvedRefundAmount: number | null; refunds: { amount: number; method: string; code: string | null; at: string; staffId: number }[] }
interface Xtra { id: number; contractId: number; feeCode: string; feeName: string; unitPrice: number; quantity: number; notes: string | null; dueDate: string; createdAt: string; paid?: Paid }

// ------------------------------------------------------------------ time helpers (server local time, like SYSDATETIME)

const pad = (n: number) => String(n).padStart(2, '0')
const localIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const dateOnly = (d: Date) => localIso(d).slice(0, 10)
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }
/** Vietnam-offset ISO time, as DateTimeOffset values come back from the API. */
const tz = (d: Date) => `${localIso(d)}+07:00`
const atToday = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }
const today = () => dateOnly(new Date())

// ------------------------------------------------------------------ seed (same accounts as DevSeeder)

function seed(): Db {
  const now = new Date()
  const unitTypes: UnitType[] = [
    { unitTypeId: 1, typeName: 'Locker Mini (0.5m x 0.5m)', lengthMeters: 0.5, widthMeters: 0.5, heightMeters: 0.5, volumeCubicMeters: 0.125, hasClimateControl: false, baseDailyRate: 15000, baseMonthlyRate: 300000, description: 'Phù hợp lưu trữ giấy tờ, hồ sơ, tư trang cá nhân nhỏ gọn' },
    { unitTypeId: 2, typeName: 'Kho Nhỏ S (1.5m x 1.5m)', lengthMeters: 1.5, widthMeters: 1.5, heightMeters: 2.5, volumeCubicMeters: 5.625, hasClimateControl: false, baseDailyRate: 50000, baseMonthlyRate: 1200000, description: 'Phù hợp đồ đạc sinh viên, vali, đồ dùng chuyển trọ' },
    { unitTypeId: 3, typeName: 'Kho Tiêu Chuẩn M (2.0m x 2.5m)', lengthMeters: 2, widthMeters: 2.5, heightMeters: 2.8, volumeCubicMeters: 14, hasClimateControl: false, baseDailyRate: 95000, baseMonthlyRate: 2400000, description: 'Lưu trữ nội thất gia đình 1 phòng ngủ hoặc kho hàng online' },
    { unitTypeId: 4, typeName: 'Kho Lớn L - Điều Hòa (3.0m x 4.0m)', lengthMeters: 3, widthMeters: 4, heightMeters: 3, volumeCubicMeters: 36, hasClimateControl: true, baseDailyRate: 180000, baseMonthlyRate: 4800000, description: 'Hệ thống điều hòa kiểm soát độ ẩm và nhiệt độ cho đồ điện tử, mỹ phẩm' },
  ]
  const facilities: Facility[] = [
    { facilityId: 1, facilityName: 'SafeKeep Quận 7', address: '123 Nguyễn Thị Thập', city: 'TP. Hồ Chí Minh', district: 'Quận 7', hotline: '02812345678', operatingHours: '06:00 - 22:00', status: 'Active' },
    { facilityId: 2, facilityName: 'SafeKeep Thủ Đức', address: '45 Võ Văn Ngân', city: 'TP. Hồ Chí Minh', district: 'TP. Thủ Đức', hotline: '02887654321', operatingHours: '07:00 - 21:00', status: 'Active' },
  ]
  const units: Unit[] = []
  let unitId = 1
  for (const f of facilities)
    unitTypes.forEach((t, i) => {
      for (let n = 1; n <= 3; n++)
        units.push({ unitId: unitId++, facilityId: f.facilityId, unitTypeId: t.unitTypeId, unitCode: `${String.fromCharCode(65 + i)}-${pad(n)}`, floorNumber: 1, zoneArea: `Khu ${String.fromCharCode(65 + i)}`, monthlyPrice: t.baseMonthlyRate, status: 'Available' })
    })
  const unit = (fid: number, code: string) => units.find((u) => u.facilityId === fid && u.unitCode === code)!

  const users: User[] = [
    { userId: 1, username: 'admin', password: DEMO_PASSWORD, fullName: 'Quản trị hệ thống', email: 'admin@example.com', phoneNumber: '0900000000', citizenId: '079000000001', role: Roles.Admin },
    { userId: 2, username: 'manager1', password: DEMO_PASSWORD, fullName: 'Trần Quản Lý', email: 'manager1@example.com', phoneNumber: '0900000000', citizenId: '079000000002', role: Roles.Manager },
    { userId: 3, username: 'staff1', password: DEMO_PASSWORD, fullName: 'Lê Nhân Viên', email: 'staff1@example.com', phoneNumber: '0900000000', citizenId: '079000000003', role: Roles.Staff },
    { userId: 9, username: 'staff2', password: DEMO_PASSWORD, fullName: 'Đỗ Thị Trực Cổng', email: 'staff2@example.com', phoneNumber: '0900000009', citizenId: '079000000009', role: Roles.Staff },
    { userId: 8, username: 'ops1', password: DEMO_PASSWORD, fullName: 'Ngô Vận Hành', email: 'ops1@example.com', phoneNumber: '0900000000', citizenId: '079000000008', role: Roles.OpsManager },
    { userId: 4, username: 'customer1', password: DEMO_PASSWORD, fullName: 'Nguyễn Văn Khách', email: 'customer1@example.com', phoneNumber: '0900000000', citizenId: '079200000123', role: Roles.Customer },
    // Extra demo customers so the gate screen has something to show.
    { userId: 5, username: 'customer2', password: DEMO_PASSWORD, fullName: 'Trần Hoàng Nam', email: 'customer2@example.com', phoneNumber: '0903456982', citizenId: '079200000814', role: Roles.Customer },
    { userId: 6, username: 'customer3', password: DEMO_PASSWORD, fullName: 'Phạm Thị Lan', email: 'customer3@example.com', phoneNumber: '0987654321', citizenId: '079200000777', role: Roles.Customer },
    { userId: 7, username: 'customer4', password: DEMO_PASSWORD, fullName: 'Võ Minh Tuấn', email: 'customer4@example.com', phoneNumber: '0912345678', citizenId: '079200000999', role: Roles.Customer },
  ]

  const contracts: Ctr[] = [
    { contractId: 1, contractNumber: 'HD-DEMO-0001', customerId: 4, unitId: unit(1, 'B-01').unitId, startDate: dateOnly(addDays(now, -7)), endDate: dateOnly(addMonths(now, 6)), monthlyRentFee: 1200000, depositPaid: 1200000, status: 'Active' },
    // Ends in 5 days, so the renewal window (7 days before the end) is open in the demo.
    { contractId: 2, contractNumber: 'HD-DEMO-0002', customerId: 4, unitId: unit(1, 'A-02').unitId, startDate: dateOnly(addDays(addMonths(now, -3), 5)), endDate: dateOnly(addDays(now, 5)), monthlyRentFee: 300000, depositPaid: 300000, status: 'Active' },
    { contractId: 3, contractNumber: 'HD-DEMO-0003', customerId: 5, unitId: unit(1, 'C-01').unitId, startDate: dateOnly(addMonths(now, -3)), endDate: dateOnly(addMonths(now, 9)), monthlyRentFee: 2400000, depositPaid: 2400000, status: 'Active' },
    // Ended 3 days ago and was never returned: locked, with late fees.
    { contractId: 4, contractNumber: 'HD-DEMO-0004', customerId: 6, unitId: unit(1, 'C-02').unitId, startDate: dateOnly(addDays(addMonths(now, -4), -3)), endDate: dateOnly(addDays(now, -3)), monthlyRentFee: 2400000, depositPaid: 2400000, status: 'Overdue' },
    { contractId: 5, contractNumber: 'HD-DEMO-0005', customerId: 7, unitId: unit(1, 'D-01').unitId, startDate: dateOnly(addMonths(now, -1)), endDate: dateOnly(addMonths(now, 11)), monthlyRentFee: 4800000, depositPaid: 4800000, status: 'Active' },
  ]
  unit(1, 'B-01').status = 'Rented'
  unit(1, 'A-02').status = 'Rented'
  unit(1, 'C-01').status = 'Rented'
  unit(1, 'C-02').status = 'OverdueLocked'
  unit(1, 'D-01').status = 'Rented'
  unit(1, 'D-03').status = 'UnderMaintenance'

  const persons: AuthPerson[] = [
    { authorizedPersonId: 1, contractId: 1, fullName: 'Nguyễn Thị Người Nhà', phoneNumber: '0911111111', citizenId: '079300000456', relationship: 'Vợ', status: 'Active' },
    { authorizedPersonId: 2, contractId: 5, fullName: 'Lý Văn Kho', phoneNumber: '0933222111', citizenId: '079300000321', relationship: 'Nhân viên', status: 'Active' },
  ]

  const records: Rec[] = [
    { accessRecordId: 1, contractId: 1, facilityId: 1, unitId: unit(1, 'B-01').unitId, authorizedPersonId: null, verifiedByStaffId: 3, result: 'Granted', denyReason: null, purpose: 'Gửi đồ', entryTime: localIso(addDays(atToday(9, 10), -3)), exitTime: localIso(addDays(atToday(9, 45), -3)) },
    { accessRecordId: 2, contractId: 1, facilityId: 1, unitId: unit(1, 'B-01').unitId, authorizedPersonId: 1, verifiedByStaffId: 3, result: 'Granted', denyReason: null, purpose: 'Lấy đồ', entryTime: localIso(addDays(atToday(17, 20), -1)), exitTime: localIso(addDays(atToday(17, 40), -1)) },
    { accessRecordId: 3, contractId: 4, facilityId: 1, unitId: unit(1, 'C-02').unitId, authorizedPersonId: null, verifiedByStaffId: 3, result: 'Denied', denyReason: 'OverdueLocked', purpose: null, entryTime: localIso(atToday(7, 5)), exitTime: null },
    { accessRecordId: 4, contractId: 3, facilityId: 1, unitId: unit(1, 'C-01').unitId, authorizedPersonId: null, verifiedByStaffId: 3, result: 'Granted', denyReason: null, purpose: 'Lấy hàng', entryTime: localIso(atToday(6, 40)), exitTime: localIso(atToday(7, 15)) },
    { accessRecordId: 5, contractId: 5, facilityId: 1, unitId: unit(1, 'D-01').unitId, authorizedPersonId: 2, verifiedByStaffId: 3, result: 'Granted', denyReason: null, purpose: 'Nhập hàng', companionCount: 2, entryTime: localIso(atToday(6, 50)), exitTime: null },
  ]

  const rsvBase = { facilityId: 1, assignedUnitId: null, durationMonths: 6, createdAt: localIso(now) }
  const reservations: Rsv[] = [
    { ...rsvBase, reservationId: 1, reservationCode: 'RSV-DEMO-100231', customerId: 5, unitTypeId: 2, expectedStartDate: dateOnly(addDays(now, 2)), depositAmount: 1200000, estimatedTotalFee: 7200000, status: 'PendingDeposit', depositDeadline: localIso(addDays(now, 1)) },
    { ...rsvBase, reservationId: 2, reservationCode: 'RSV-DEMO-100198', customerId: 7, unitTypeId: 3, durationMonths: 3, expectedStartDate: dateOnly(now), checkInAppointmentAt: `${localIso(new Date(now.getTime() - 3600000))}+07:00`, depositAmount: 2400000, estimatedTotalFee: 7200000, status: 'Confirmed', depositDeadline: localIso(addDays(now, 1)) },
    { ...rsvBase, reservationId: 3, reservationCode: 'RSV-DEMO-099870', customerId: 4, unitTypeId: 2, durationMonths: 6, assignedUnitId: unit(1, 'B-01').unitId, expectedStartDate: dateOnly(addDays(now, -7)), depositAmount: 1200000, estimatedTotalFee: 7200000, status: 'CheckedIn', depositDeadline: localIso(addDays(now, -8)) },
    // customer1 has paid the deposit and still has to book a pick-up time
    { ...rsvBase, reservationId: 4, reservationCode: 'RSV-DEMO-100305', customerId: 4, unitTypeId: 3, durationMonths: 3, expectedStartDate: dateOnly(addDays(now, 1)), depositAmount: 2400000, estimatedTotalFee: 7200000, status: 'Confirmed', depositDeadline: localIso(addDays(now, 1)) },
  ]

  return {
    seq: 1000,
    users,
    facilities,
    assignments: [{ facilityId: 1, staffId: 2 }, { facilityId: 1, staffId: 3 }],
    unitTypes, units, reservations, contracts, persons, records,
    visits: [
      // Người Nhà of B-01 is approved to come in now (gate demo); the owner has one waiting for staff tomorrow.
      { visitRegistrationId: 1, contractId: 1, customerId: 4, authorizedPersonId: 1, scheduledEntryAt: tz(new Date(now.getTime() - 3600000)), scheduledExitAt: tz(new Date(now.getTime() + 3 * 3600000)), purpose: 'Lấy đồ', status: 'Approved', requestedAt: localIso(addDays(now, -1)), reviewedAt: localIso(addDays(now, -1)), reviewNotes: null },
      { visitRegistrationId: 2, contractId: 1, customerId: 4, authorizedPersonId: null, scheduledEntryAt: tz(addDays(atToday(9, 0), 1)), scheduledExitAt: tz(addDays(atToday(10, 30), 1)), purpose: 'Gửi thêm đồ', status: 'Pending', requestedAt: localIso(now), reviewedAt: null, reviewNotes: null },
      { visitRegistrationId: 3, contractId: 5, customerId: 7, authorizedPersonId: 2, scheduledEntryAt: tz(atToday(6, 30)), scheduledExitAt: tz(atToday(12, 0)), purpose: 'Nhập hàng', status: 'Approved', requestedAt: localIso(addDays(now, -1)), reviewedAt: localIso(addDays(now, -1)), reviewNotes: null },
      { visitRegistrationId: 4, contractId: 3, customerId: 5, authorizedPersonId: null, scheduledEntryAt: tz(addDays(atToday(14, 0), 1)), scheduledExitAt: tz(addDays(atToday(15, 0), 1)), purpose: 'Kiểm tra kho', status: 'Pending', requestedAt: localIso(now), reviewedAt: null, reviewNotes: null },
    ],
    renewals: [],
    // customer2 changed plans before paying the deposit: waiting for staff at Quận 7.
    cancellations: [{ cancellationRequestId: 1, reservationId: 1, customerId: 5, reason: 'Đổi kế hoạch chuyển nhà, chưa cần kho nữa', status: 'Pending', requestedAt: localIso(addDays(now, -0.1)), resolvedAt: null, resolvedByStaffId: null, resolutionNotes: null, approvedRefundAmount: null, refunds: [] }],
    supports: [
      { requestId: 1, requestCode: 'SUP-DEMO-000101', customerId: 4, facilityId: 1, contractId: 1, unitId: unit(1, 'B-01').unitId, assignedStaffId: 3, category: 'LockIssue', priority: 'High', title: 'Ổ khóa kho B-01 bị kẹt', description: 'Sáng nay tôi mở khóa rất khó, chìa vặn không hết vòng.', status: 'InProgress', createdAt: localIso(addDays(atToday(8, 30), -1)), resolvedAt: null },
      { requestId: 2, requestCode: 'SUP-DEMO-000102', customerId: 5, facilityId: 1, contractId: 3, unitId: unit(1, 'C-01').unitId, assignedStaffId: null, category: 'DamagedUnit', priority: 'Urgent', title: 'Trần kho C-01 bị dột nước', description: 'Sau cơn mưa tối qua có nước nhỏ giọt xuống thùng hàng ở góc trái.', status: 'Open', createdAt: localIso(atToday(7, 20)), resolvedAt: null },
      { requestId: 3, requestCode: 'SUP-DEMO-000095', customerId: 4, facilityId: 1, contractId: 2, unitId: unit(1, 'A-02').unitId, assignedStaffId: 3, category: 'PaymentIssue', priority: 'Low', title: 'Xin hóa đơn tiền cọc', description: 'Nhờ cơ sở xuất giúp hóa đơn cho khoản cọc kho A-02.', status: 'Resolved', createdAt: localIso(addDays(atToday(10, 0), -5)), resolvedAt: localIso(addDays(atToday(15, 0), -4)) },
    ],
    supportUpdates: [
      { updateId: 1, requestId: 1, updatedByUserId: 4, actionMessage: 'Khách hàng đã gửi yêu cầu hỗ trợ', previousStatus: null, newStatus: 'Open', createdAt: localIso(addDays(atToday(8, 30), -1)) },
      { updateId: 2, requestId: 1, updatedByUserId: 3, actionMessage: 'Đã tiếp nhận, kỹ thuật sẽ kiểm tra ổ khóa trong chiều nay.', previousStatus: 'Open', newStatus: 'InProgress', createdAt: localIso(addDays(atToday(9, 15), -1)) },
      { updateId: 3, requestId: 2, updatedByUserId: 5, actionMessage: 'Khách hàng đã gửi yêu cầu hỗ trợ', previousStatus: null, newStatus: 'Open', createdAt: localIso(atToday(7, 20)) },
      { updateId: 4, requestId: 3, updatedByUserId: 4, actionMessage: 'Khách hàng đã gửi yêu cầu hỗ trợ', previousStatus: null, newStatus: 'Open', createdAt: localIso(addDays(atToday(10, 0), -5)) },
      { updateId: 5, requestId: 3, updatedByUserId: 3, actionMessage: 'Đã gửi hóa đơn qua email của bạn.', previousStatus: 'Open', newStatus: 'Resolved', createdAt: localIso(addDays(atToday(15, 0), -4)) },
    ],
    overdues: [{ overdueId: 1, contractId: 4, daysOverdue: 2, accumulatedLateFee: 160000, lockAppliedAt: localIso(addDays(atToday(20, 0), -2)), resolvedAt: null }],
  }
}

// ------------------------------------------------------------------ persistence (localStorage may be missing or throw)

let db: Db = load()

function load(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) return JSON.parse(raw) as Db
  } catch { /* fall through */ }
  return seed()
}
function save() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)) } catch { /* in-memory only */ }
}
export function resetDemoData() {
  db = seed()
  save()
}

// ------------------------------------------------------------------ errors and request plumbing

export class MockHttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
const bad = (m: string) => new MockHttpError(400, m)
const conflict = (m: string) => new MockHttpError(409, m)
const notFound = (m: string) => new MockHttpError(404, m)
const forbidden = (m = 'Bạn không có quyền thực hiện thao tác này') => new MockHttpError(403, m)

const nextId = () => ++db.seq
const userById = (id: number) => db.users.find((u) => u.userId === id)!
const unitById = (id: number) => db.units.find((u) => u.unitId === id)!
const typeById = (id: number) => db.unitTypes.find((t) => t.unitTypeId === id)!
const facilityById = (id: number) => db.facilities.find((f) => f.facilityId === id)
const toUserDto = (u: User): UserDto => ({ userId: u.userId, username: u.username, fullName: u.fullName, role: u.role })

function currentUser(token: string | null): User {
  const id = token?.startsWith('mock.') ? Number(token.slice(5)) : NaN
  const u = db.users.find((x) => x.userId === id)
  if (!u) throw new MockHttpError(401, 'Phiên đăng nhập đã hết hạn')
  return u
}
function requireRole(u: User, roles: string[]) {
  if (!roles.includes(u.role)) throw forbidden()
}
const STAFF = [Roles.Staff, Roles.Manager] as string[]

function ensureAssigned(staffId: number, facilityId: number) {
  if (!db.assignments.some((a) => a.staffId === staffId && a.facilityId === facilityId))
    throw forbidden('Bạn không được phân công tại cơ sở này')
}

// ------------------------------------------------------------------ projections (same shapes as the API DTOs)

function visitDto(v: Vreg): VisitRegistration {
  const c = db.contracts.find((x) => x.contractId === v.contractId)!
  const p = v.authorizedPersonId ? db.persons.find((x) => x.authorizedPersonId === v.authorizedPersonId) : null
  return {
    visitRegistrationId: v.visitRegistrationId, contractId: v.contractId, contractNumber: c.contractNumber,
    facilityId: unitById(c.unitId).facilityId, unitCode: unitById(c.unitId).unitCode, authorizedPersonId: v.authorizedPersonId,
    visitorName: p ? p.fullName : userById(v.customerId).fullName,
    scheduledEntryAt: v.scheduledEntryAt, scheduledExitAt: v.scheduledExitAt, purpose: v.purpose, status: v.status,
    requestedAt: v.requestedAt, reviewedAt: v.reviewedAt, reviewNotes: v.reviewNotes,
  }
}
const visitsOf = () => (db.visits ??= [])
// Operations manager data, same seed rows as 01_schema.sql (created on first use).
const policiesOf = () => (db.policies ??= [
  { policyId: 1, policyName: 'Chính sách thuê kho tiêu chuẩn 2026', facilityId: null, depositPercent: 100, cancellationGraceHours: 24, cancellationFeePercent: 10, renewalNoticeDays: 7, maxOverdueDaysBeforeLock: 1, isActive: true, effectiveDate: '2026-01-01' },
])
const feesOf = () => (db.fees ??= [
  { feeTypeId: 1, feeCode: 'CLEANING_FEE', feeName: 'Phí vệ sinh sau trả kho', defaultAmount: 200000, calculationMethod: 'Fixed', description: 'Áp dụng nếu kho bị bẩn hoặc để lại rác thải khi check-out' },
  { feeTypeId: 2, feeCode: 'LATE_FEE_DAILY', feeName: 'Phí phạt quá hạn mỗi ngày', defaultAmount: 100000, calculationMethod: 'DailyRate', description: 'Tính lũy tiến cho mỗi ngày trễ hạn bàn giao hoặc thanh toán' },
  { feeTypeId: 3, feeCode: 'LOCK_REPLACE_FEE', feeName: 'Phí thay mới ổ khóa thông minh', defaultAmount: 500000, calculationMethod: 'Fixed', description: 'Áp dụng trong trường hợp ổ khóa bị hỏng hóc do lỗi người dùng' },
  { feeTypeId: 4, feeCode: 'LOST_CARD_FEE', feeName: 'Phí cấp lại thẻ từ truy cập', defaultAmount: 100000, calculationMethod: 'Fixed', description: 'Phí cấp mới thẻ từ mở cửa kho/thang máy' },
  { feeTypeId: 5, feeCode: 'LOST_KEY_FEE', feeName: 'Phí cấp lại chìa khóa cơ', defaultAmount: 150000, calculationMethod: 'Fixed', description: 'Áp dụng khi khách hàng làm mất chìa khóa cơ vật lý' },
])
const promotionsOf = () => (db.promotions ??= [
  { promotionId: 1, promoCode: 'WELCOME10', title: 'Giảm 10% tháng đầu cho khách mới', discountPercent: 10, maxDiscountAmount: 500000, minRentalMonths: 3, startDate: '2026-10-01', endDate: '2026-12-31', isActive: true },
  { promotionId: 2, promoCode: 'TET2027', title: 'Ưu đãi Tết: giảm 15% thuê từ 6 tháng', discountPercent: 15, maxDiscountAmount: 1000000, minRentalMonths: 6, startDate: '2027-01-15', endDate: '2027-02-28', isActive: true },
  { promotionId: 3, promoCode: 'SUMMER26', title: 'Hè 2026 cho sinh viên', discountPercent: 20, maxDiscountAmount: 300000, minRentalMonths: 1, startDate: '2026-06-01', endDate: '2026-08-31', isActive: false },
])
const opsOnly = (token: string | null) => requireRole(currentUser(token), [Roles.OpsManager])
/** Approved registration whose window contains now, for this visitor (AccessService.GrantEntryAsync). */
const approvedNow = (contractId: number, apId?: number | null) => {
  const now = Date.now()
  return visitsOf().filter((v) => v.contractId === contractId && v.status === 'Approved'
    && new Date(v.scheduledEntryAt).getTime() <= now && new Date(v.scheduledExitAt).getTime() >= now
    && (apId === undefined || v.authorizedPersonId === apId)
    && !db.records.some((r) => (r as Rec & { visitRegistrationId?: number }).visitRegistrationId === v.visitRegistrationId && r.result === 'Granted'))
}

function recordDto(r: Rec): AccessRecord {
  const c = db.contracts.find((x) => x.contractId === r.contractId)!
  const p = r.authorizedPersonId ? db.persons.find((x) => x.authorizedPersonId === r.authorizedPersonId) : null
  return {
    accessRecordId: r.accessRecordId,
    visitRegistrationId: (r as Rec & { visitRegistrationId?: number }).visitRegistrationId ?? null,
    unitCode: unitById(r.unitId).unitCode,
    contractNumber: c.contractNumber,
    visitorName: p ? p.fullName : userById(c.customerId).fullName,
    result: r.result,
    denyReason: r.denyReason,
    purpose: r.purpose,
    companionCount: r.companionCount ?? 0,
    entryTime: r.entryTime,
    exitTime: r.exitTime,
    verifiedBy: userById(r.verifiedByStaffId).fullName,
  }
}

function reservationDto(r: Rsv): Reservation {
  return {
    reservationId: r.reservationId,
    reservationCode: r.reservationCode,
    facilityName: facilityById(r.facilityId)!.facilityName,
    unitTypeName: typeById(r.unitTypeId).typeName,
    assignedUnitCode: r.assignedUnitId ? unitById(r.assignedUnitId).unitCode : null,
    expectedStartDate: r.expectedStartDate,
    checkInAppointmentAt: r.checkInAppointmentAt ?? null,
    durationMonths: r.durationMonths,
    depositAmount: r.depositAmount,
    estimatedTotalFee: r.estimatedTotalFee,
    status: r.status,
    depositDeadline: r.depositDeadline,
    customerName: userById(r.customerId).fullName,
    promoCode: r.promoCode ?? null,
    promotionDiscountAmount: r.promotionDiscountAmount ?? 0,
    depositInvoiceId: 10000 + r.reservationId,
  }
}

function contractDto(c: Ctr): Contract {
  const u = unitById(c.unitId)
  const f = facilityById(u.facilityId)!
  return { contractId: c.contractId, contractNumber: c.contractNumber, facilityId: f.facilityId, facilityName: f.facilityName, unitCode: u.unitCode, startDate: c.startDate, endDate: c.endDate, monthlyRentFee: c.monthlyRentFee, status: c.status }
}

const personDto = (p: AuthPerson): Person =>
  ({ authorizedPersonId: p.authorizedPersonId, fullName: p.fullName, citizenId: p.citizenId, phoneNumber: p.phoneNumber, relationship: p.relationship })

/** Same checks as AccessService.FindIssues. */
function findIssues(c: Ctr): AccessIssue[] {
  const t = today()
  const unit = unitById(c.unitId)
  const issues: AccessIssue[] = []
  if (c.status === 'Terminated' || c.status === 'Liquidated' || c.endDate < t) issues.push({ code: 'ContractEnded', message: 'Hợp đồng đã kết thúc' })
  else if (c.startDate > t) issues.push({ code: 'ContractEnded', message: `Hợp đồng chưa bắt đầu (từ ${c.startDate.split('-').reverse().join('/')})` })
  if (c.status === 'Overdue' || unit.status === 'OverdueLocked') issues.push({ code: 'OverdueLocked', message: 'Hợp đồng quá hạn thanh toán, kho đang bị khóa' })
  if (unit.status === 'UnderMaintenance') issues.push({ code: 'UnitUnderMaintenance', message: 'Kho đang bảo trì' })
  return issues
}

function loadContract(facilityId: number, contractId: number): Ctr {
  const c = db.contracts.find((x) => x.contractId === contractId && unitById(x.unitId).facilityId === facilityId)
  if (!c) throw notFound('Không tìm thấy hợp đồng tại cơ sở này')
  return c
}

function resolveVisitor(c: Ctr, authorizedPersonId: number | null): string | null {
  if (authorizedPersonId == null) return userById(c.customerId).citizenId
  const p = db.persons.find((x) => x.authorizedPersonId === authorizedPersonId && x.contractId === c.contractId && x.status === 'Active')
  if (!p) throw bad('Người này không có trong danh sách được ủy quyền của hợp đồng')
  return p.citizenId
}

function ownContract(user: User, id: number): Ctr {
  const c = db.contracts.find((x) => x.contractId === id)
  if (!c) throw notFound('Không tìm thấy hợp đồng')
  if (c.customerId !== user.userId) throw forbidden()
  return c
}

const returnAppointment = (c: Ctr) => `${c.endDate}T20:00:00`
const openOverdue = (contractId: number) =>
  db.overdues.filter((o) => o.contractId === contractId && !o.resolvedAt).sort((a, b) => b.overdueId - a.overdueId)[0]
const renewalDto = (r: Rnw): Renewal => ({ ...r })
const addMonthsIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return dateOnly(d)
}
const staffRenewal = (me: User, renewalId: number) => {
  const r = db.renewals.find((x) => x.renewalId === renewalId)
  if (!r) throw notFound('Không tìm thấy yêu cầu gia hạn')
  const c = db.contracts.find((x) => x.contractId === r.contractId)!
  ensureAssigned(me.userId, unitById(c.unitId).facilityId)
  return { r, c }
}
const supportDto = (r: Sup): SupportRequest => ({
  requestId: r.requestId, requestCode: r.requestCode, contractId: r.contractId, unitCode: unitById(r.unitId).unitCode,
  category: r.category, priority: r.priority, title: r.title, description: r.description, status: r.status,
  createdAt: r.createdAt, assignedStaffName: r.assignedStaffId ? userById(r.assignedStaffId).fullName : null,
})
/** Same checklist templates as SupportController. */
const CHECKLIST_TEMPLATES: Record<string, string[]> = {
  LockIssue: ['Xác minh khách hàng và mã kho', 'Kiểm tra tình trạng khóa tại chỗ', 'Thử khóa và mở kho cùng khách'],
  AccessCodeIssue: ['Xác minh khách hàng hoặc người được ủy quyền', 'Kiểm tra quyền truy cập còn hiệu lực', 'Hướng dẫn hoặc cấp lại mã truy cập', 'Xác nhận khách truy cập được'],
  DamagedUnit: ['Ghi nhận vị trí và tình trạng hư hỏng', 'Đánh giá nguy cơ an toàn và tài sản', 'Ghi nhận bằng chứng và báo quản lý/bảo trì', 'Thông báo phương án xử lý cho khách'],
  PaymentIssue: ['Đối chiếu hóa đơn và mã giao dịch', 'Kiểm tra trạng thái giao dịch với bộ phận phụ trách', 'Thông báo kết quả và bước tiếp theo cho khách'],
  StoredItemsIssue: ['Xác minh khách hàng và mã kho', 'Ghi nhận tình trạng và vị trí hàng hóa', 'Kiểm tra lịch sử ra vào liên quan', 'Thống nhất phương án hỗ trợ với khách'],
  Other: ['Liên hệ và xác nhận vấn đề với khách', 'Ghi nhận kết quả kiểm tra', 'Thống nhất và thông báo hướng xử lý cho khách'],
}
/** Checklist of a ticket, created from the template on first use (seeded tickets included). */
function checklistOf(r: Sup): Chk[] {
  if (!r.checklist) {
    const done = r.status === 'Resolved' || r.status === 'Closed'
    r.checklist = (CHECKLIST_TEMPLATES[r.category] ?? CHECKLIST_TEMPLATES.Other).map((description, i) => ({
      checklistItemId: r.requestId * 100 + i + 1, sortOrder: i + 1, description, isCompleted: done || (r.status === 'InProgress' && i === 0),
      completedAt: done || (r.status === 'InProgress' && i === 0) ? r.createdAt : null, completedByStaffId: done || (r.status === 'InProgress' && i === 0) ? r.assignedStaffId : null, notes: null,
    }))
  }
  return r.checklist
}
const checklistDto = (c: Chk): SupportChecklistItem => ({
  checklistItemId: c.checklistItemId, sortOrder: c.sortOrder, description: c.description, isCompleted: c.isCompleted,
  completedAt: c.completedAt, completedByStaff: c.completedByStaffId ? userById(c.completedByStaffId).fullName : null, notes: c.notes,
})
const SUPPORT_CATEGORIES = ['LockIssue', 'AccessCodeIssue', 'DamagedUnit', 'PaymentIssue', 'StoredItemsIssue', 'Other']
const SUPPORT_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
const SUPPORT_STATUSES = ['Open', 'InProgress', 'Resolved', 'Closed']

type Paid = { method: string; code: string | null; at: string; staffId: number }
/** Invoices derived from deposits and renewals (the demo keeps no separate invoice table). */
function allInvoices(): { customerId: number; facilityId: number; invoice: Invoice }[] {
  const payments = (id: number, amount: number, p: Paid | undefined, fallbackAt: string, note: string) => [{
    paymentId: id, paymentMethod: p?.method ?? 'Cash', transactionCode: p?.code ?? null, amountPaid: amount,
    paymentDate: p?.at ?? fallbackAt, status: 'Success', paymentNotes: note, receivedByStaff: userById(p?.staffId ?? 3).fullName,
  }]
  const now = localIso(new Date())
  const fromRsv = db.reservations.map((r) => {
    const p = (r as Rsv & { paid?: Paid }).paid
    const status = r.status === 'PendingDeposit' ? (r.depositDeadline <= now ? 'Overdue' : 'Unpaid') : r.status === 'Confirmed' || r.status === 'CheckedIn' || r.depositWasPaid ? 'Paid' : 'Cancelled'
    const refunds = (db.cancellations ?? []).filter((c) => c.reservationId === r.reservationId).flatMap((c) => c.refunds)
    const invoice: Invoice = { invoiceId: 10000 + r.reservationId, invoiceNumber: `INV-DEP-${r.reservationId}`, contractId: null, reservationId: r.reservationId, invoiceType: 'DEPOSIT', subTotal: r.depositAmount, discountAmount: 0, totalAmount: r.depositAmount, dueDate: r.depositDeadline.slice(0, 10), status, createdAt: r.createdAt,
      details: [{ detailId: 1, description: `Tiền cọc 1 tháng cho đơn ${r.reservationCode}`, quantity: 1, unitPrice: r.depositAmount, lineTotal: r.depositAmount }],
      payments: status === 'Paid' ? [...payments(1, r.depositAmount, p, r.createdAt, 'Nhân viên xác nhận đã nhận tiền cọc'),
        ...refunds.map((x, i) => ({ paymentId: 2 + i, paymentMethod: x.method, transactionCode: x.code, amountPaid: x.amount, paymentDate: x.at, status: 'Refunded', paymentNotes: 'Hoàn cọc do hủy đơn đặt kho', receivedByStaff: userById(x.staffId).fullName }))] : [] }
    return { customerId: r.customerId, facilityId: r.facilityId, invoice }
  })
  const fromRenewals = db.renewals.map((r) => {
    const c = db.contracts.find((x) => x.contractId === r.contractId)!
    const p = (r as Rnw & { paid?: Paid }).paid
    const status = r.status === 'Paid' ? 'Paid' : r.status === 'Pending' ? 'Unpaid' : 'Cancelled'
    const invoice: Invoice = { invoiceId: 20000 + r.renewalId, invoiceNumber: `INV-REN-${r.renewalId}`, contractId: c.contractId, reservationId: null, invoiceType: 'RENEWAL', subTotal: r.renewalFee, discountAmount: 0, totalAmount: r.renewalFee, dueDate: r.oldEndDate, status, createdAt: r.requestedAt,
      details: [{ detailId: 1, description: `Phí gia hạn ${r.extensionMonths} tháng cho hợp đồng ${c.contractNumber}`, quantity: r.extensionMonths, unitPrice: c.monthlyRentFee, lineTotal: r.renewalFee }],
      payments: status === 'Paid' ? payments(1, r.renewalFee, p, r.requestedAt, 'Nhân viên xác nhận đã nhận phí gia hạn') : [] }
    return { customerId: c.customerId, facilityId: unitById(c.unitId).facilityId, invoice }
  })
  // Monthly rent, like MonthlyRentInvoiceService: one invoice per month from the start date, issued up to 7 days ahead,
  // skipped when a paid renewal covers the month. Months already started count as paid in the demo history.
  const horizon = dateOnly(addDays(new Date(), 7))
  const fromRent = db.contracts.filter((c) => c.status === 'Active' || c.status === 'Renewed' || c.status === 'Overdue').flatMap((c) => {
    const out: { customerId: number; facilityId: number; invoice: Invoice }[] = []
    for (let k = 0; k < 120; k++) {
      const periodStart = dateOnly(addMonths(new Date(c.startDate + 'T00:00:00'), k))
      if (periodStart >= c.endDate || periodStart > horizon) break
      const next = dateOnly(addMonths(new Date(c.startDate + 'T00:00:00'), k + 1))
      const periodEnd = next > c.endDate ? c.endDate : next
      if (db.renewals.some((r) => r.contractId === c.contractId && r.status === 'Paid' && r.oldEndDate <= periodStart && r.newEndDate >= periodEnd)) continue
      const key = `${c.contractId}:${periodStart}`
      const p = db.rentPaid?.[key]
      const status = p || periodStart < today() ? 'Paid' : 'Unpaid'
      const invoice: Invoice = { invoiceId: 30000 + c.contractId * 100 + k, invoiceNumber: `INV-RENT-${c.contractId}-${k + 1}`, contractId: c.contractId, reservationId: null, invoiceType: 'MONTHLY_RENT', subTotal: c.monthlyRentFee, discountAmount: 0, totalAmount: c.monthlyRentFee, dueDate: periodStart, status, createdAt: `${periodStart}T00:00:00`,
        billingPeriodStart: periodStart, billingPeriodEnd: periodEnd,
        details: [{ detailId: 1, description: `Tiền thuê kỳ ${periodStart.split('-').reverse().join('/')} - ${periodEnd.split('-').reverse().join('/')} cho hợp đồng ${c.contractNumber}`, quantity: 1, unitPrice: c.monthlyRentFee, lineTotal: c.monthlyRentFee }],
        payments: status === 'Paid' ? payments(1, c.monthlyRentFee, p, `${periodStart}T09:00:00`, 'Thu tiền thuê tháng') : [] }
      out.push({ customerId: c.customerId, facilityId: unitById(c.unitId).facilityId, invoice })
    }
    return out
  })
  const fromExtra = (db.extraCharges ?? []).map((x) => {
    const c = db.contracts.find((k) => k.contractId === x.contractId)!
    const total = x.unitPrice * x.quantity
    const invoice: Invoice = { invoiceId: 40000 + x.id, invoiceNumber: `INV-EXT-${x.id}`, contractId: c.contractId, reservationId: null, invoiceType: 'EXTRA_CHARGE', subTotal: total, discountAmount: 0, totalAmount: total, dueDate: x.dueDate, status: x.paid ? 'Paid' : x.dueDate < today() ? 'Overdue' : 'Unpaid', createdAt: x.createdAt,
      details: [{ detailId: 1, description: x.notes ? `${x.feeName}: ${x.notes}` : x.feeName, quantity: x.quantity, unitPrice: x.unitPrice, lineTotal: total }],
      payments: x.paid ? payments(1, total, x.paid, x.createdAt, 'Thu phụ phí') : [] }
    return { customerId: c.customerId, facilityId: unitById(c.unitId).facilityId, invoice }
  })
  return [...fromRsv, ...fromRenewals, ...fromRent, ...fromExtra].sort((a, b) => b.invoice.createdAt.localeCompare(a.invoice.createdAt))
}


// ------------------------------------------------------------------ system administrator (SystemAdminController)

// Same order as the Roles rows inserted by 01_schema.sql.
const ROLE_ROWS = [
  { roleId: 1, roleName: Roles.Customer, description: 'Khách hàng thuê và sử dụng kho tự quản' },
  { roleId: 2, roleName: Roles.Staff, description: 'Nhân viên hỗ trợ bàn giao, kiểm tra và bảo trì tại chi nhánh' },
  { roleId: 3, roleName: Roles.Manager, description: 'Quản lý chi nhánh kho, phân bổ nhân sự và giám sát hợp đồng' },
  { roleId: 4, roleName: Roles.OpsManager, description: 'Quản trị viên vận hành kinh doanh, quản lý giá và toàn chuỗi' },
  { roleId: 5, roleName: Roles.Admin, description: 'Quản trị hệ thống, tài khoản và an ninh dữ liệu' },
]
const roleRow = (roleId: number) => ROLE_ROWS.find((r) => r.roleId === roleId)
const adminUserDto = (u: User): AdminUser => ({
  userId: u.userId, username: u.username, fullName: u.fullName, email: u.email, phoneNumber: u.phoneNumber,
  citizenId: u.citizenId, status: u.status ?? 'Active', roleId: ROLE_ROWS.find((r) => r.roleName === u.role)!.roleId, roleName: u.role,
})
function addLog(userId: number, action: string, details: string) {
  db.logs ??= []
  db.logs.push({ logId: nextId(), userId, action, details, ipAddress: '127.0.0.1', createdAt: localIso(new Date()) })
}
function adminTarget(token: string | null, userId: number) {
  const me = currentUser(token)
  requireRole(me, [Roles.Admin])
  const u = db.users.find((x) => x.userId === userId)
  if (!u) throw notFound('Không tìm thấy tài khoản')
  return { me, u }
}
function ensureAnotherActiveAdmin(excludedUserId: number) {
  if (!db.users.some((u) => u.userId !== excludedUserId && (u.status ?? 'Active') === 'Active' && u.role === Roles.Admin))
    throw conflict('Không thể thay đổi trạng thái/vai trò của quản trị viên hoạt động cuối cùng')
}
const ACCOUNT_STATUSES = ['Active', 'Inactive', 'Suspended']

/** Required text fields of a facility (CreateFacilityRequest / UpdateFacilityRequest). */
function facilityFields(body: Body) {
  const f = body as Record<string, string>
  for (const k of ['facilityName', 'address', 'city', 'district', 'hotline'])
    if (!String(f[k] ?? '').trim()) throw bad('Vui lòng nhập đầy đủ thông tin cơ sở')
  return {
    facilityName: f.facilityName.trim(), address: f.address.trim(), city: f.city.trim(), district: f.district.trim(),
    hotline: f.hotline.trim(), operatingHours: String(f.operatingHours ?? '').trim(),
  }
}

// Reset tokens for the forgot-password flow: token -> { userId, password at issue time, expiry }.
const resetTokens = new Map<string, { userId: number; password: string; expiresAt: number }>()

// Same checks as SaveRentalPolicyRequest / SaveFeeConfigurationRequest / SavePromotionRequest and the controller.
function checkPolicy(b: Body): Omit<RentalPolicy, 'policyId'> {
  const name = String(b.policyName ?? '').trim()
  if (!name) throw bad('Vui lòng nhập tên chính sách')
  const facilityId = b.facilityId == null || b.facilityId === '' ? null : Number(b.facilityId)
  if (facilityId != null && !facilityById(facilityId)) throw notFound('Không tìm thấy cơ sở cho chính sách')
  const n = (k: string) => Number(b[k])
  if (!(n('depositPercent') >= 0.01 && n('depositPercent') <= 100)) throw bad('Tỷ lệ cọc phải từ 0,01 đến 100%')
  if (!(n('cancellationFeePercent') >= 0 && n('cancellationFeePercent') <= 100)) throw bad('Phí hủy phải từ 0 đến 100%')
  for (const [k, max] of [['cancellationGraceHours', 8760], ['renewalNoticeDays', 365], ['maxOverdueDaysBeforeLock', 365]] as const)
    if (!(Number.isInteger(n(k)) && n(k) >= 0 && n(k) <= max)) throw bad('Giá trị số ngày/giờ không hợp lệ')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.effectiveDate ?? ''))) throw bad('Vui lòng chọn ngày hiệu lực')
  return { policyName: name, facilityId, depositPercent: n('depositPercent'), cancellationGraceHours: n('cancellationGraceHours'),
    cancellationFeePercent: n('cancellationFeePercent'), renewalNoticeDays: n('renewalNoticeDays'), maxOverdueDaysBeforeLock: n('maxOverdueDaysBeforeLock'),
    isActive: b.isActive === true, effectiveDate: String(b.effectiveDate) }
}
function checkFee(b: Body, selfId: number | null): Omit<FeeConfiguration, 'feeTypeId'> {
  const code = String(b.feeCode ?? '').trim().toUpperCase(), name = String(b.feeName ?? '').trim(), method = String(b.calculationMethod ?? '')
  if (!code || !name) throw bad('Vui lòng nhập mã và tên loại phí')
  if (!['Fixed', 'DailyRate', 'Percentage'].includes(method)) throw bad('Cách tính phí phải là Fixed, DailyRate hoặc Percentage')
  if (code === 'LATE_FEE_DAILY' && method === 'Fixed') throw bad('LATE_FEE_DAILY chỉ hỗ trợ cách tính DailyRate hoặc Percentage')
  if (!(Number(b.defaultAmount) >= 0)) throw bad('Số tiền không hợp lệ')
  if (feesOf().some((f) => f.feeCode === code && f.feeTypeId !== selfId)) throw conflict('Mã loại phí đã tồn tại')
  return { feeCode: code, feeName: name, defaultAmount: Number(b.defaultAmount), calculationMethod: method, description: String(b.description ?? '').trim() || null }
}
function checkPromotion(b: Body, selfId: number | null): Omit<Promotion, 'promotionId'> {
  const code = String(b.promoCode ?? '').trim().toUpperCase(), title = String(b.title ?? '').trim()
  if (!code || !title) throw bad('Vui lòng nhập mã và tên khuyến mãi')
  const pct = Number(b.discountPercent), months = Number(b.minRentalMonths)
  if (!(pct >= 0 && pct <= 100)) throw bad('Mức giảm phải từ 0 đến 100%')
  if (!(Number.isInteger(months) && months >= 1 && months <= 60)) throw bad('Số tháng thuê tối thiểu từ 1 đến 60')
  const start = String(b.startDate ?? ''), end = String(b.endDate ?? '')
  if (!start || !end) throw bad('Vui lòng chọn thời gian áp dụng')
  if (end < start) throw bad('Ngày kết thúc khuyến mãi phải từ ngày bắt đầu trở đi')
  if (promotionsOf().some((p) => p.promoCode === code && p.promotionId !== selfId)) throw conflict('Mã khuyến mãi đã tồn tại')
  const max = b.maxDiscountAmount == null || b.maxDiscountAmount === '' ? null : Number(b.maxDiscountAmount)
  return { promoCode: code, title, discountPercent: pct, maxDiscountAmount: max, minRentalMonths: months, startDate: start, endDate: end, isActive: b.isActive === true }
}

// ------------------------------------------------------------------ facility manager (FacilityOperationsController, FacilityManagementController)

/** KPIs of one facility for payments made between from and to (FacilityDashboardDto). */
function facilityKpis(facilityId: number, from: string, to: string): FacilityReport {
  const f = facilityById(facilityId)!
  const units = db.units.filter((u) => u.facilityId === facilityId)
  const count = (status: string) => units.filter((u) => u.status === status).length
  const contracts = db.contracts.filter((c) => unitById(c.unitId).facilityId === facilityId)
  const pays = allInvoices().filter((x) => x.facilityId === facilityId).flatMap((x) => x.invoice.payments)
    .filter((p) => p.paymentDate.slice(0, 10) >= from && p.paymentDate.slice(0, 10) <= to)
  const sumOf = (status: string) => pays.filter((p) => p.status === status).reduce((n, p) => n + p.amountPaid, 0)
  return {
    facilityId, facilityName: f.facilityName, fromDate: from, toDate: to, totalUnits: units.length,
    availableUnits: count('Available'), rentedUnits: count('Rented'), maintenanceUnits: count('UnderMaintenance'), overdueLockedUnits: count('OverdueLocked'),
    activeContracts: contracts.filter((c) => c.status === 'Active').length, overdueContracts: contracts.filter((c) => c.status === 'Overdue').length,
    openSupportRequests: db.supports.filter((r) => r.facilityId === facilityId && (r.status === 'Open' || r.status === 'InProgress')).length,
    netRevenue: sumOf('Success') - sumOf('Refunded'),
  }
}
/** fromDate/toDate query, last 30 days by default (same as the controllers). */
function dateRange(query: URLSearchParams) {
  const to = query.get('toDate') || today()
  const from = query.get('fromDate') || dateOnly(addDays(new Date(`${to}T00:00:00`), -29))
  if (from > to) throw bad('Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc')
  return { from, to }
}
/** Staff or manager assigned at the facility (AccessService.EnsureAssignedAsync). */
function facilityStaff(token: string | null, facilityId: number, roles = STAFF) {
  const me = currentUser(token)
  requireRole(me, roles)
  ensureAssigned(me.userId, facilityId)
  if (!facilityById(facilityId)) throw notFound('Không tìm thấy cơ sở')
  return me
}
const cancellationsOf = () => (db.cancellations ??= [])
const cancellationDto = (c: Cnl): CancellationRequest => ({
  cancellationRequestId: c.cancellationRequestId, reservationId: c.reservationId,
  reservationCode: db.reservations.find((r) => r.reservationId === c.reservationId)!.reservationCode,
  customerName: userById(c.customerId).fullName, reason: c.reason, status: c.status, requestedAt: c.requestedAt,
  resolvedAt: c.resolvedAt, resolutionNotes: c.resolutionNotes, approvedRefundAmount: c.approvedRefundAmount,
})
const unitDto = (u: Unit): StorageUnit => ({ unitId: u.unitId, unitCode: u.unitCode, floorNumber: u.floorNumber, zoneArea: u.zoneArea || null, monthlyPrice: typeById(u.unitTypeId).baseMonthlyRate, status: u.status, unitTypeId: u.unitTypeId, unitTypeName: typeById(u.unitTypeId).typeName })
/** Units of a type still free once open reservations hold theirs (used before taking a unit out of the free pool). */
const spareUnits = (facilityId: number, unitTypeId: number) => {
  const now = localIso(new Date())
  const free = db.units.filter((u) => u.facilityId === facilityId && u.unitTypeId === unitTypeId && u.status === 'Available').length
  const held = db.reservations.filter((r) => r.facilityId === facilityId && r.unitTypeId === unitTypeId
    && (r.status === 'Confirmed' || (r.status === 'PendingDeposit' && r.depositDeadline > now))).length
  return free - held
}
function unitFields(body: Body) {
  const type = db.unitTypes.find((t) => t.unitTypeId === Number(body.unitTypeId))
  if (!type) throw notFound('Không tìm thấy loại kho')
  if (Number(body.monthlyPrice) !== type.baseMonthlyRate) throw bad('Giá thuê kho phải bằng giá niêm yết của loại kho')
  const code = String(body.unitCode ?? '').trim()
  if (!code || code.length > 30) throw bad('Mã kho bắt buộc, tối đa 30 ký tự')
  const floor = Number(body.floorNumber)
  if (!(Number.isInteger(floor) && floor >= 1 && floor <= 100)) throw bad('Tầng phải từ 1 đến 100')
  const zone = String(body.zoneArea ?? '').trim()
  if (zone.length > 30) throw bad('Khu vực tối đa 30 ký tự')
  return { type, code, floor, zone }
}
/** Same fee rows and IDs as 01_schema.sql (the order they are inserted). */
const SQL_FEE_CODES = ['LATE_FEE_DAILY', 'LOST_KEY_FEE', 'LOST_CARD_FEE', 'CLEANING_FEE', 'LOCK_REPLACE_FEE']

// ------------------------------------------------------------------ admin contracts, email outbox, report details

const adminContractDto = (c: Ctr): AdminContract => {
  const u = unitById(c.unitId), cust = userById(c.customerId)
  return { contractId: c.contractId, contractNumber: c.contractNumber, customerId: c.customerId, customerName: cust.fullName,
    customerEmail: cust.email, customerPhoneNumber: cust.phoneNumber, facilityId: u.facilityId, facilityName: facilityById(u.facilityId)!.facilityName,
    unitId: c.unitId, unitCode: u.unitCode, startDate: c.startDate, endDate: c.endDate, status: c.status, monthlyRentFee: c.monthlyRentFee,
    depositPaid: c.depositPaid, signedDate: c.signedDate ?? `${c.startDate}T09:00:00`, termsConditions: c.termsConditions ?? null }
}
const paging = (query: URLSearchParams) => {
  const page = Number(query.get('page') ?? 1), size = Number(query.get('pageSize') ?? 50)
  if (!(page >= 1) || !(size >= 1 && size <= 100)) throw bad('page phải từ 1 và pageSize phải từ 1 đến 100')
  return { skip: (page - 1) * size, size }
}
const emailsOf = () => (db.emails ??= (() => {
  const t = (d: number, h: number) => localIso(addDays(atToday(h, 0), d))
  return [
    { emailOutboxMessageId: 1, eventKey: 'invoice-issued:10001', recipientEmail: 'customer2@example.com', subject: 'Hóa đơn tiền cọc INV-DEP-1', status: 'Sent', attemptCount: 1, createdAt: t(-1, 9), nextAttemptAt: t(-1, 9), sentAt: t(-1, 9), lastError: null },
    { emailOutboxMessageId: 2, eventKey: 'payment-received:10003', recipientEmail: 'customer1@example.com', subject: 'Biên nhận thanh toán INV-DEP-3', status: 'Sent', attemptCount: 1, createdAt: t(-7, 10), nextAttemptAt: t(-7, 10), sentAt: t(-7, 10), lastError: null },
    { emailOutboxMessageId: 3, eventKey: 'invoice-issued:30101', recipientEmail: 'customer4@example.com', subject: 'Hóa đơn tiền thuê tháng HD-DEMO-0005', status: 'Failed', attemptCount: 8, createdAt: t(-2, 8), nextAttemptAt: t(-1, 8), sentAt: null, lastError: '5.7.8 Username and Password not accepted (smtp.gmail.com)' },
    { emailOutboxMessageId: 4, eventKey: 'invoice-issued:10004', recipientEmail: 'customer1@example.com', subject: 'Hóa đơn tiền cọc INV-DEP-4', status: 'Pending', attemptCount: 2, createdAt: t(0, 7), nextAttemptAt: t(0, 23), sentAt: null, lastError: 'Mailbox temporarily unavailable' },
  ]
})())
/** Facility × unit type rows (OperationsReportsController.GetReportRowsAsync). */
function reportRows(query: URLSearchParams): OperationsReportRow[] {
  const { from, to } = dateRange(query)
  const fid = Number(query.get('facilityId')) || null, tid = Number(query.get('unitTypeId')) || null
  const cs = query.get('contractStatus') || null
  const rows: OperationsReportRow[] = []
  for (const f of [...db.facilities].sort((a, b) => a.facilityName.localeCompare(b.facilityName))) {
    if (fid && f.facilityId !== fid) continue
    for (const t of db.unitTypes) {
      if (tid && t.unitTypeId !== tid) continue
      const units = db.units.filter((u) => u.facilityId === f.facilityId && u.unitTypeId === t.unitTypeId)
      if (!units.length) continue
      const ids = new Set(units.map((u) => u.unitId))
      const cts = db.contracts.filter((c) => ids.has(c.unitId) && (!cs || c.status === cs))
      const n = (s: string) => units.filter((u) => u.status === s).length
      const k = (s: string) => cts.filter((c) => c.status === s).length
      const ctIds = new Set(cts.map((c) => c.contractId))
      const pays = allInvoices().filter((x) => x.invoice.contractId != null && ctIds.has(x.invoice.contractId)).flatMap((x) => x.invoice.payments)
        .filter((p) => p.paymentDate.slice(0, 10) >= from && p.paymentDate.slice(0, 10) <= to)
      const occupied = n('Rented') + n('OverdueLocked') + n('Reserved')
      rows.push({ fromDate: from, toDate: to, facilityId: f.facilityId, facilityName: f.facilityName, unitTypeId: t.unitTypeId, unitTypeName: t.typeName,
        totalUnits: units.length, availableUnits: n('Available'), reservedUnits: n('Reserved'), rentedUnits: n('Rented'), maintenanceUnits: n('UnderMaintenance'),
        overdueLockedUnits: n('OverdueLocked'), occupancyRatePercent: Math.round(occupied / units.length * 1000) / 10,
        activeContracts: k('Active'), overdueContracts: k('Overdue'), terminatedContracts: k('Terminated'), renewedContracts: k('Renewed'), liquidatedContracts: k('Liquidated'),
        netRevenue: pays.filter((p) => p.status === 'Success').reduce((s, p) => s + p.amountPaid, 0) - pays.filter((p) => p.status === 'Refunded').reduce((s, p) => s + p.amountPaid, 0) })
    }
  }
  return rows
}
const adminOnly = (token: string | null) => { const me = currentUser(token); requireRole(me, [Roles.Admin]); return me }

// ------------------------------------------------------------------ routes

type Body = Record<string, unknown>
type Handler = (m: RegExpMatchArray, ctx: { token: string | null; body: Body; query: URLSearchParams }) => unknown

const routes: [string, RegExp, Handler][] = [
  // ---- auth
  ['POST', /^\/api\/auth\/login$/, (_m, { body }) => {
    const u = db.users.find((x) => x.username === body.username)
    if (!u || u.password !== body.password || (u.status ?? 'Active') !== 'Active') throw new MockHttpError(401, 'Sai tên đăng nhập hoặc mật khẩu')
    const res: LoginResponse = { token: `mock.${u.userId}`, expiresAt: localIso(addDays(new Date(), 1)), user: toUserDto(u) }
    return res
  }],
  ['POST', /^\/api\/auth\/register$/, (_m, { body }) => {
    const f = body as Record<string, string>
    for (const k of ['username', 'password', 'fullName', 'email', 'phoneNumber', 'citizenId'])
      if (!f[k]?.trim()) throw bad('Vui lòng nhập đầy đủ thông tin')
    if (f.username.length < 3) throw bad('Tên đăng nhập cần ít nhất 3 ký tự')
    if (f.password.length < 8) throw bad('Mật khẩu cần ít nhất 8 ký tự')
    if (!/^\S+@\S+\.\S+$/.test(f.email)) throw bad('Email không hợp lệ')
    if (db.users.some((u) => u.username === f.username || u.email === f.email || u.citizenId === f.citizenId))
      throw conflict('Tên đăng nhập, email hoặc CCCD đã được sử dụng')
    const u: User = { userId: nextId(), username: f.username, password: f.password, fullName: f.fullName, email: f.email, phoneNumber: f.phoneNumber, citizenId: f.citizenId, role: Roles.Customer }
    db.users.push(u)
    return toUserDto(u)
  }],
  ['GET', /^\/api\/auth\/me$/, (_m, { token }) => toUserDto(currentUser(token))],

  ['POST', /^\/api\/auth\/forgot-password$/, (_m, { body }) => {
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Email không hợp lệ')
    const message = 'Nếu email đã đăng ký, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư.'
    const u = db.users.find((x) => x.email.toLowerCase() === email)
    if (!u) return { message }
    for (const [k, v] of resetTokens) if (v.userId === u.userId) resetTokens.delete(k)
    const token = Math.random().toString(36).slice(2, 10).toUpperCase()
    resetTokens.set(token, { userId: u.userId, password: u.password, expiresAt: Date.now() + 30 * 60000 })
    // No email in the demo: hand the code back so it can be shown on screen.
    return { message, demoToken: token }
  }],
  ['POST', /^\/api\/auth\/reset-password$/, (_m, { body }) => {
    const key = String(body.token ?? '').trim()
    const t = resetTokens.get(key)
    if (!t || t.expiresAt < Date.now()) throw bad('Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn')
    const pw = String(body.newPassword ?? '')
    if (pw.length < 8) throw bad('Mật khẩu cần ít nhất 8 ký tự')
    userById(t.userId).password = pw
    resetTokens.delete(key)
    return undefined
  }],

  // ---- catalog (public)
  ['GET', /^\/api\/facilities$/, () => db.facilities],
  ['GET', /^\/api\/unit-types$/, () => db.unitTypes],
  ['GET', /^\/api\/facilities\/(\d+)\/availability$/, (m) => {
    const fid = Number(m[1])
    const now = localIso(new Date())
    return db.unitTypes.map<Availability>((t) => {
      const free = db.units.filter((u) => u.facilityId === fid && u.unitTypeId === t.unitTypeId && u.status === 'Available').length
      const held = db.reservations.filter((r) => r.facilityId === fid && r.unitTypeId === t.unitTypeId
        && (r.status === 'Confirmed' || (r.status === 'PendingDeposit' && r.depositDeadline > now))).length
      return { unitTypeId: t.unitTypeId, typeName: t.typeName, baseMonthlyRate: t.baseMonthlyRate, availableUnits: Math.max(0, free - held) }
    })
  }],
  ['GET', /^\/api\/facilities\/(\d+)\/units$/, (m, { query }) => {
    const status = query.get('status')
    return db.units
      .filter((u) => u.facilityId === Number(m[1]) && (!status || u.status === status))
      .map<StorageUnit>((u) => ({ unitId: u.unitId, unitCode: u.unitCode, floorNumber: u.floorNumber, zoneArea: u.zoneArea, monthlyPrice: u.monthlyPrice, status: u.status, unitTypeId: u.unitTypeId, unitTypeName: typeById(u.unitTypeId).typeName }))
  }],

  // ---- reservations
  ['POST', /^\/api\/reservations$/, (_m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const facilityId = Number(body.facilityId), unitTypeId = Number(body.unitTypeId), months = Number(body.durationMonths)
    const start = String(body.expectedStartDate ?? '')
    if (!facilityById(facilityId)) throw notFound('Không tìm thấy cơ sở')
    const type = db.unitTypes.find((t) => t.unitTypeId === unitTypeId)
    if (!type) throw notFound('Không tìm thấy loại kho')
    if (!(months >= 1 && months <= 60)) throw bad('Thời gian thuê từ 1 đến 60 tháng')
    if (!start || start < today()) throw bad('Ngày bắt đầu không được ở quá khứ')
    const avail = (routes.find((r) => r[1].source.includes('availability'))![2](
      ['', String(facilityId)] as unknown as RegExpMatchArray, { token, body: {}, query: new URLSearchParams() }) as Availability[])
      .find((a) => a.unitTypeId === unitTypeId)!
    if (avail.availableUnits <= 0) throw conflict('Loại kho này đã hết chỗ trống tại cơ sở')
    const now = new Date()
    // Same promotion rules as ReservationsController.Create: active, in its date range, minimum months, first rental only.
    let promo: Promotion | undefined
    let discount = 0
    const code = String(body.promoCode ?? '').trim().toUpperCase()
    if (code) {
      promo = promotionsOf().find((p) => p.promoCode === code && p.isActive && p.startDate <= today() && p.endDate >= today())
      if (!promo) throw bad('Mã khuyến mãi không hợp lệ hoặc đã hết hạn')
      if (months < promo.minRentalMonths) throw bad(`Mã khuyến mãi yêu cầu thuê tối thiểu ${promo.minRentalMonths} tháng`)
      if (db.contracts.some((c) => c.customerId === me.userId)) throw conflict('Mã khuyến mãi chỉ dành cho lần đầu tiên thuê kho')
      discount = Math.round(type.baseMonthlyRate * promo.discountPercent) / 100
      if (promo.maxDiscountAmount != null) discount = Math.min(discount, promo.maxDiscountAmount)
    }
    const r: Rsv = {
      promoCode: promo?.promoCode ?? null,
      promotionDiscountAmount: discount,
      reservationId: nextId(),
      reservationCode: `RSV-${dateOnly(now).replaceAll('-', '')}-${Math.floor(100000 + Math.random() * 900000)}`,
      customerId: me.userId, facilityId, unitTypeId, assignedUnitId: null,
      expectedStartDate: start, durationMonths: months,
      depositAmount: type.baseMonthlyRate,
      estimatedTotalFee: type.baseMonthlyRate * months,
      status: 'PendingDeposit',
      depositDeadline: localIso(addDays(now, 1)),
      createdAt: localIso(now),
    }
    db.reservations.push(r)
    return reservationDto(r)
  }],
  ['GET', /^\/api\/reservations\/my$/, (_m, { token }) => {
    const me = currentUser(token)
    return db.reservations.filter((r) => r.customerId === me.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.reservationId - a.reservationId).map(reservationDto)
  }],
  ['GET', /^\/api\/facilities\/(\d+)\/reservations$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    ensureAssigned(me.userId, Number(m[1]))
    return db.reservations.filter((r) => r.facilityId === Number(m[1])).sort((a, b) => b.reservationId - a.reservationId).map(reservationDto)
  }],
  ['POST', /^\/api\/reservations\/(\d+)\/confirm-deposit$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const r = db.reservations.find((x) => x.reservationId === Number(m[1]))
    if (!r) throw notFound('Không tìm thấy đơn đặt kho')
    ensureAssigned(me.userId, r.facilityId)
    if (r.status !== 'PendingDeposit') throw conflict('Đơn không ở trạng thái chờ đặt cọc')
    if (r.depositDeadline <= localIso(new Date())) { r.status = 'Expired'; save(); throw conflict('Đơn đã quá hạn đặt cọc') }
    r.status = 'Confirmed'
    return reservationDto(r)
  }],
  ['PUT', /^\/api\/reservations\/(\d+)\/appointment$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const r = db.reservations.find((x) => x.reservationId === Number(m[1]) && x.customerId === me.userId)
    if (!r) throw notFound('Không tìm thấy đơn đặt kho')
    if (r.status !== 'Confirmed') throw conflict('Chỉ đơn đã xác nhận đặt cọc mới được đặt lịch nhận kho')
    const at = String(body.appointmentAt ?? '')
    if (!(new Date(at) > new Date()) || at.slice(0, 10) !== r.expectedStartDate)
      throw bad('Lịch nhận kho phải là thời điểm trong tương lai thuộc ngày bắt đầu đã chọn')
    r.checkInAppointmentAt = at
    return reservationDto(r)
  }],
  ['POST', /^\/api\/(?:reservations|admin\/contracts\/from-reservations)\/(\d+)\/check-in$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, [...STAFF, Roles.Admin])
    const r = db.reservations.find((x) => x.reservationId === Number(m[1]))
    if (!r) throw notFound('Không tìm thấy đơn đặt kho')
    if (me.role !== Roles.Admin) ensureAssigned(me.userId, r.facilityId)
    if (r.status !== 'Confirmed') throw conflict('Đơn chưa được xác nhận cọc')
    if (!r.checkInAppointmentAt) throw conflict('Khách hàng chưa đặt lịch nhận kho')
    if (new Date() < new Date(r.checkInAppointmentAt)) throw conflict('Chưa đến thời gian hẹn nhận kho')
    const unit = db.units.find((u) => u.unitId === Number(body.unitId))
    if (!unit || unit.facilityId !== r.facilityId || unit.unitTypeId !== r.unitTypeId) throw bad('Kho không đúng cơ sở hoặc loại kho đã đặt')
    if (unit.status !== 'Available') throw conflict('Kho này không còn trống')
    const start = r.expectedStartDate < today() ? today() : r.expectedStartDate
    const c: Ctr = {
      contractId: nextId(),
      contractNumber: `HD-${start.replaceAll('-', '')}-${r.reservationId}`,
      customerId: r.customerId, unitId: unit.unitId,
      startDate: start, endDate: dateOnly(addMonths(new Date(start + 'T00:00:00'), r.durationMonths)),
      monthlyRentFee: unit.monthlyPrice, depositPaid: r.depositAmount, status: 'Active',
    }
    db.contracts.push(c)
    unit.status = 'Rented'
    r.status = 'CheckedIn'
    r.assignedUnitId = unit.unitId
    return contractDto(c)
  }],

  // ---- my contracts
  ['GET', /^\/api\/contracts\/my$/, (_m, { token }) => {
    const me = currentUser(token)
    return db.contracts.filter((c) => c.customerId === me.userId).sort((a, b) => b.endDate.localeCompare(a.endDate)).map(contractDto)
  }],
  ['GET', /^\/api\/contracts\/(\d+)$/, (m, { token }) => {
    const c = ownContract(currentUser(token), Number(m[1]))
    const u = unitById(c.unitId)
    const f = facilityById(u.facilityId)!
    const o = db.overdues.filter((x) => x.contractId === c.contractId).sort((a, b) => b.overdueId - a.overdueId)[0]
    const accrued = o?.accumulatedLateFee ?? 0
    const d: ContractDetail = {
      contractId: c.contractId, contractNumber: c.contractNumber, facilityId: f.facilityId, facilityName: f.facilityName,
      unitId: u.unitId, unitCode: u.unitCode, unitStatus: u.status, startDate: c.startDate, endDate: c.endDate, status: c.status,
      monthlyRentFee: c.monthlyRentFee, depositPaid: c.depositPaid, accumulatedLateFee: accrued,
      depositBalance: Math.max(0, c.depositPaid - accrued), outstandingLateFee: Math.max(0, accrued - c.depositPaid),
      renewalAvailableFrom: `${dateOnly(addDays(new Date(`${c.endDate}T00:00:00`), -7))}T00:00:00`,
    }
    return d
  }],
  ['GET', /^\/api\/contracts\/(\d+)\/renewals$/, (m, { token }) => {
    const c = ownContract(currentUser(token), Number(m[1]))
    return db.renewals.filter((r) => r.contractId === c.contractId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).map(renewalDto)
  }],
  ['POST', /^\/api\/contracts\/(\d+)\/renewals$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const c = ownContract(me, Number(m[1]))
    const months = Number(body.extensionMonths)
    if (!(months >= 1 && months <= 60)) throw bad('Thời gian gia hạn từ 1 đến 60 tháng')
    const now = localIso(new Date())
    const opens = dateOnly(addDays(new Date(`${c.endDate}T00:00:00`), -7))
    if (c.status !== 'Active' || today() < opens || now >= returnAppointment(c))
      throw conflict('Chỉ có thể yêu cầu gia hạn trong 7 ngày trước ngày hết hạn, khi hợp đồng còn hiệu lực')
    if (db.renewals.some((r) => r.contractId === c.contractId && r.status === 'Pending'))
      throw conflict('Hợp đồng đã có yêu cầu gia hạn đang chờ xử lý')
    const r: Rnw = { renewalId: nextId(), contractId: c.contractId, oldEndDate: c.endDate, newEndDate: addMonthsIso(c.endDate, months), extensionMonths: months, renewalFee: c.monthlyRentFee * months, status: 'Pending', requestedAt: now }
    db.renewals.push(r)
    return renewalDto(r)
  }],
  ['GET', /^\/api\/contracts\/facilities\/(\d+)$/, (m, { token, query }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const fid = Number(m[1])
    ensureAssigned(me.userId, fid)
    const status = query.get('status')
    return db.contracts
      .filter((c) => unitById(c.unitId).facilityId === fid && (!status || c.status === status))
      .sort((a, b) => a.endDate.localeCompare(b.endDate))
      .map<StaffContract>((c) => {
        const u = unitById(c.unitId), cust = userById(c.customerId)
        return {
          contractId: c.contractId, contractNumber: c.contractNumber, customerName: cust.fullName, customerPhone: cust.phoneNumber,
          unitId: u.unitId, unitCode: u.unitCode, unitStatus: u.status, startDate: c.startDate, endDate: c.endDate,
          monthlyRentFee: c.monthlyRentFee, depositPaid: c.depositPaid, status: c.status,
          hasPendingRenewal: db.renewals.some((r) => r.contractId === c.contractId && r.status === 'Pending'),
          returnAppointment: returnAppointment(c),
        }
      })
  }],
  ['GET', /^\/api\/contracts\/facilities\/(\d+)\/renewals$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const fid = Number(m[1])
    ensureAssigned(me.userId, fid)
    return db.renewals
      .filter((r) => r.status === 'Pending' && unitById(db.contracts.find((c) => c.contractId === r.contractId)!.unitId).facilityId === fid)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)).map(renewalDto)
  }],
  ['POST', /^\/api\/contracts\/renewals\/(\d+)\/confirm-payment$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const { r, c } = staffRenewal(me, Number(m[1]))
    if (localIso(new Date()) >= `${r.oldEndDate}T20:00:00`) throw conflict('Đã quá hạn gia hạn; nhân viên không thể xác nhận yêu cầu này')
    if (r.status !== 'Pending' || c.status !== 'Active' || c.endDate !== r.oldEndDate) throw conflict('Yêu cầu gia hạn không còn chờ thanh toán')
    r.status = 'Paid'
    c.endDate = r.newEndDate
    unitById(c.unitId).status = 'Rented'
    return renewalDto(r)
  }],
  ['POST', /^\/api\/contracts\/renewals\/(\d+)\/reject$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const { r } = staffRenewal(me, Number(m[1]))
    if (r.status !== 'Pending') throw conflict('Yêu cầu gia hạn không còn chờ xử lý')
    r.status = 'Rejected'
    return undefined
  }],
  ['POST', /^\/api\/(?:admin\/)?contracts\/(\d+)\/return$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, [...STAFF, Roles.Admin])
    const c = db.contracts.find((x) => x.contractId === Number(m[1]))
    if (!c) throw notFound('Không tìm thấy hợp đồng')
    const unit = unitById(c.unitId)
    if (me.role !== Roles.Admin) ensureAssigned(me.userId, unit.facilityId)
    const now = localIso(new Date())
    if (now < returnAppointment(c)) throw conflict(`Lịch trả kho là 20:00 ngày ${c.endDate.split('-').reverse().join('/')}`)
    if (!body.allItemsRemoved) throw bad('Nhân viên cần xác nhận kho đã được dọn sạch trước khi hoàn tất trả kho')
    if (c.status !== 'Active' && c.status !== 'Overdue') throw conflict('Hợp đồng không ở trạng thái có thể trả kho')
    if (db.records.some((r) => r.contractId === c.contractId && r.result === 'Granted' && !r.exitTime))
      throw conflict('Cần xác nhận tất cả khách đã ra khỏi cơ sở trước khi trả kho')
    const o = openOverdue(c.contractId)
    const accumulated = o?.accumulatedLateFee ?? 0
    const deducted = Math.min(c.depositPaid, accumulated)
    const stillOwed = accumulated - deducted
    c.status = 'Terminated'
    unit.status = 'Available'
    if (o && stillOwed === 0) o.resolvedAt = now
    const res: ReturnUnitResult = { contractId: c.contractId, status: c.status, unitStatus: unit.status, depositPaid: c.depositPaid, lateFeesDeducted: deducted, depositRefundDue: c.depositPaid - deducted, lateFeesStillOwed: stillOwed, returnedAt: now }
    return res
  }],
  ['POST', /^\/api\/contracts\/(\d+)\/deposit-refunds$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const c = db.contracts.find((x) => x.contractId === Number(m[1]))
    if (!c) throw notFound('Không tìm thấy hợp đồng')
    ensureAssigned(me.userId, unitById(c.unitId).facilityId)
    const method = String(body.paymentMethod)
    const code = String(body.transactionCode ?? '').trim()
    if (method !== 'Cash' && method !== 'BankTransfer') throw bad('Phương thức hoàn cọc chỉ hỗ trợ tiền mặt hoặc chuyển khoản')
    if (method === 'BankTransfer' && !code) throw bad('Hoàn cọc qua chuyển khoản phải có mã giao dịch')
    if (c.status !== 'Terminated') throw conflict('Chỉ được hoàn cọc sau khi hợp đồng đã kết thúc và trả kho')
    const o = db.overdues.filter((x) => x.contractId === c.contractId).sort((a, b) => b.overdueId - a.overdueId)[0]
    db.refunds ??= []
    const already = db.refunds.filter((x) => x.contractId === c.contractId).reduce((s, x) => s + x.amount, 0)
    const remaining = Math.max(0, c.depositPaid - (o?.accumulatedLateFee ?? 0)) - already
    const amount = Number(body.amount)
    if (!(amount > 0) || amount > remaining) throw bad(`Số tiền hoàn cọc còn có thể hoàn là ${Math.max(0, remaining).toLocaleString('vi-VN')}đ`)
    const at = localIso(new Date())
    db.refunds.push({ contractId: c.contractId, amount, at })
    return { contractId: c.contractId, refundedAmount: amount, remainingRefund: remaining - amount, paymentMethod: method, transactionCode: code || null, refundedAt: at }
  }],
  ['GET', /^\/api\/contracts\/facilities\/(\d+)\/overdue$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const fid = Number(m[1])
    ensureAssigned(me.userId, fid)
    return db.overdues
      .filter((o) => !o.resolvedAt)
      .map((o) => ({ o, c: db.contracts.find((x) => x.contractId === o.contractId)! }))
      .filter(({ c }) => unitById(c.unitId).facilityId === fid)
      .map<OverdueSummary>(({ o, c }) => ({
        overdueId: o.overdueId, contractId: c.contractId, contractNumber: c.contractNumber, customerName: userById(c.customerId).fullName,
        unitCode: unitById(c.unitId).unitCode, endDate: c.endDate, contractStatus: c.status, unitStatus: unitById(c.unitId).status,
        daysOverdue: o.daysOverdue, accumulatedLateFee: o.accumulatedLateFee,
        depositBalance: Math.max(0, c.depositPaid - o.accumulatedLateFee), outstandingLateFee: Math.max(0, o.accumulatedLateFee - c.depositPaid),
        lockAppliedAt: o.lockAppliedAt,
      }))
  }],
  ['GET', /^\/api\/contracts\/(\d+)\/authorized-persons$/, (m, { token }) => {
    const c = ownContract(currentUser(token), Number(m[1]))
    return db.persons.filter((p) => p.contractId === c.contractId && p.status === 'Active').map(personDto)
  }],
  ['POST', /^\/api\/contracts\/(\d+)\/authorized-persons$/, (m, { token, body }) => {
    const c = ownContract(currentUser(token), Number(m[1]))
    const f = body as Record<string, string | null>
    if (!f.fullName?.trim() || !f.phoneNumber?.trim() || !f.citizenId?.trim()) throw bad('Vui lòng nhập họ tên, số điện thoại và CCCD')
    if (db.persons.some((p) => p.contractId === c.contractId && p.status === 'Active' && p.citizenId === f.citizenId!.trim()))
      throw conflict('Người này đã có trong danh sách ủy quyền')
    const p: AuthPerson = { authorizedPersonId: nextId(), contractId: c.contractId, fullName: f.fullName.trim(), phoneNumber: f.phoneNumber.trim(), citizenId: f.citizenId.trim(), relationship: f.relationship?.trim() || null, status: 'Active' }
    db.persons.push(p)
    return personDto(p)
  }],
  ['DELETE', /^\/api\/contracts\/(\d+)\/authorized-persons\/(\d+)$/, (m, { token }) => {
    const c = ownContract(currentUser(token), Number(m[1]))
    const p = db.persons.find((x) => x.authorizedPersonId === Number(m[2]) && x.contractId === c.contractId)
    if (!p) throw notFound('Không tìm thấy người được ủy quyền')
    p.status = 'Revoked'
    return undefined
  }],
  ['GET', /^\/api\/contracts\/(\d+)\/access-history$/, (m, { token }) => {
    const c = ownContract(currentUser(token), Number(m[1]))
    return db.records.filter((r) => r.contractId === c.contractId).sort((a, b) => b.accessRecordId - a.accessRecordId).slice(0, 100).map(recordDto)
  }],

  // ---- invoices (derived from deposits and renewals; online payment is not available in the demo)
  ['GET', /^\/api\/invoices\/my$/, (_m, { token }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    return allInvoices().filter((x) => x.customerId === me.userId).map((x) => x.invoice)
  }],
  ['GET', /^\/api\/invoices\/(\d+)$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const x = allInvoices().find((i) => i.customerId === me.userId && i.invoice.invoiceId === Number(m[1]))
    if (!x) throw new MockHttpError(404, 'Không tìm thấy hóa đơn')
    return x.invoice
  }],
  ['GET', /^\/api\/invoices\/facilities\/(\d+)$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    ensureAssigned(me.userId, Number(m[1]))
    return allInvoices().filter((x) => x.facilityId === Number(m[1])).map((x) => x.invoice)
  }],
  ['POST', /^\/api\/invoices\/(\d+)\/payments$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const found = allInvoices().find((x) => x.invoice.invoiceId === Number(m[1]))
    if (!found) throw notFound('Không tìm thấy hóa đơn')
    ensureAssigned(me.userId, found.facilityId)
    const method = String(body.paymentMethod)
    const code = String(body.transactionCode ?? '').trim()
    if (method !== 'Cash' && method !== 'BankTransfer') throw bad('Nhân viên chỉ được ghi nhận tiền mặt hoặc chuyển khoản đã nhận thực tế')
    if (method === 'BankTransfer' && !code) throw bad('Chuyển khoản phải có mã giao dịch để đối soát')
    const inv = found.invoice
    if (inv.status !== 'Unpaid' && inv.status !== 'Overdue') throw conflict('Hóa đơn không còn ở trạng thái chờ thanh toán')
    if (Number(body.amountPaid) !== inv.totalAmount) throw bad(`Số tiền cần thanh toán chính xác là ${inv.totalAmount.toLocaleString('vi-VN')}đ`)
    const now = localIso(new Date())
    const paid = { method, code: code || null, at: now, staffId: me.userId }
    if (inv.invoiceType === 'DEPOSIT') {
      const r = db.reservations.find((x) => x.reservationId === inv.reservationId)!
      if (r.status !== 'PendingDeposit' || r.depositDeadline <= now) throw conflict('Đơn đặt kho không còn chờ đặt cọc')
      r.status = 'Confirmed'
      ;(r as Rsv & { paid?: typeof paid }).paid = paid
    } else if (inv.invoiceType === 'MONTHLY_RENT') {
      db.rentPaid = { ...db.rentPaid, [`${inv.contractId}:${inv.billingPeriodStart}`]: paid }
    } else if (inv.invoiceType === 'EXTRA_CHARGE') {
      db.extraCharges!.find((x) => 40000 + x.id === inv.invoiceId)!.paid = paid
    } else {
      const rn = db.renewals.find((x) => 20000 + x.renewalId === inv.invoiceId)!
      const c = db.contracts.find((x) => x.contractId === rn.contractId)!
      if (rn.status !== 'Pending' || c.endDate !== rn.oldEndDate) throw conflict('Yêu cầu gia hạn không còn chờ thanh toán')
      rn.status = 'Paid'
      c.endDate = rn.newEndDate
      unitById(c.unitId).status = 'Rented'
      ;(rn as Rnw & { paid?: typeof paid }).paid = paid
    }
    return { paymentId: nextId(), paymentMethod: method, transactionCode: code || null, amountPaid: inv.totalAmount, paymentDate: now, status: 'Success', paymentNotes: (body.paymentNotes as string) || null, receivedByStaff: me.fullName }
  }],
  ['POST', /^\/api\/invoices\/(\d+)\/checkout\/(vnpay|momo)$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const found = allInvoices().find((x) => x.invoice.invoiceId === Number(m[1]) && x.customerId === me.userId)
    if (!found) throw notFound('Không tìm thấy hóa đơn')
    if (found.invoice.status !== 'Unpaid' && found.invoice.status !== 'Overdue') throw conflict('Hóa đơn không còn ở trạng thái chờ thanh toán')
    if (m[2] === 'vnpay') throw bad('Bản demo không kết nối cổng VNPay thật. Khi chạy với backend, nút này chuyển sang trang thanh toán VNPay.')
    // A stand-in for MoMo's answer: the QR content is not a real MoMo payment, scanning it only shows the text.
    const ref = `DEMO${found.invoice.invoiceId}${Date.now() % 100000}`
    return { provider: 'MoMo', paymentId: nextId(), transactionReference: ref, amount: found.invoice.totalAmount,
      paymentUrl: '', qrCodeUrl: `SafeKeep demo MoMo ${found.invoice.invoiceNumber} ${found.invoice.totalAmount} VND ${ref}`, deeplink: null, deeplinkWebInApp: null }
  }],

  // ---- support requests (same rules as SupportController)
  ['POST', /^\/api\/support-requests$/, (_m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const f = body as Record<string, string | number>
    if (!SUPPORT_CATEGORIES.includes(String(f.category))) throw bad('Loại yêu cầu hỗ trợ không hợp lệ')
    const priority = String(f.priority ?? 'Medium')
    if (!SUPPORT_PRIORITIES.includes(priority)) throw bad('Mức độ ưu tiên không hợp lệ')
    if (!String(f.title ?? '').trim() || !String(f.description ?? '').trim()) throw bad('Vui lòng nhập tiêu đề và mô tả')
    const c = db.contracts.find((x) => x.contractId === Number(f.contractId) && x.customerId === me.userId)
    if (!c) throw notFound('Không tìm thấy hợp đồng')
    if (c.status === 'Terminated' || c.status === 'Liquidated') throw conflict('Không thể gửi yêu cầu cho hợp đồng đã kết thúc')
    const now = new Date()
    const r: Sup = {
      requestId: nextId(), requestCode: `SUP-${dateOnly(now).replaceAll('-', '')}-${Math.floor(100000 + Math.random() * 900000)}`,
      customerId: me.userId, facilityId: unitById(c.unitId).facilityId, contractId: c.contractId, unitId: c.unitId, assignedStaffId: null,
      category: String(f.category), priority, title: String(f.title).trim(), description: String(f.description).trim(),
      status: 'Open', createdAt: localIso(now), resolvedAt: null,
    }
    checklistOf(r)
    db.supports.push(r)
    db.supportUpdates.push({ updateId: nextId(), requestId: r.requestId, updatedByUserId: me.userId, actionMessage: 'Khách hàng đã gửi yêu cầu hỗ trợ', previousStatus: null, newStatus: 'Open', createdAt: r.createdAt })
    return supportDto(r)
  }],
  ['GET', /^\/api\/support-requests\/my$/, (_m, { token }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    return db.supports.filter((r) => r.customerId === me.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(supportDto)
  }],
  ['GET', /^\/api\/support-requests\/(\d+)\/updates$/, (m, { token }) => {
    const me = currentUser(token)
    const r = db.supports.find((x) => x.requestId === Number(m[1]))
    if (!r) throw notFound('Không tìm thấy yêu cầu hỗ trợ')
    if (me.role === Roles.Customer) { if (r.customerId !== me.userId) throw notFound('Không tìm thấy yêu cầu hỗ trợ') }
    else { requireRole(me, STAFF); ensureAssigned(me.userId, r.facilityId) }
    return db.supportUpdates.filter((u) => u.requestId === r.requestId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.updateId - b.updateId)
      .map<SupportUpdate>((u) => ({ updateId: u.updateId, updatedBy: userById(u.updatedByUserId).fullName, actionMessage: u.actionMessage, previousStatus: u.previousStatus, newStatus: u.newStatus, createdAt: u.createdAt }))
  }],
  ['GET', /^\/api\/support-requests\/facilities\/(\d+)$/, (m, { token, query }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const fid = Number(m[1])
    ensureAssigned(me.userId, fid)
    const status = query.get('status')
    if (status && !SUPPORT_STATUSES.includes(status)) throw bad('Trạng thái yêu cầu không hợp lệ')
    return db.supports.filter((r) => r.facilityId === fid && (!status || r.status === status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(supportDto)
  }],
  ['GET', /^\/api\/support-requests\/(\d+)\/checklist$/, (m, { token }) => {
    const me = currentUser(token)
    const r = db.supports.find((x) => x.requestId === Number(m[1]))
    if (!r) throw notFound('Không tìm thấy yêu cầu hỗ trợ')
    if (me.role === Roles.Customer) { if (r.customerId !== me.userId) throw notFound('Không tìm thấy yêu cầu hỗ trợ') }
    else { requireRole(me, STAFF); ensureAssigned(me.userId, r.facilityId) }
    return checklistOf(r).map(checklistDto)
  }],
  ['PUT', /^\/api\/support-requests\/(\d+)\/checklist\/(\d+)$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const r = db.supports.find((x) => x.requestId === Number(m[1]))
    const item = r ? checklistOf(r).find((c) => c.checklistItemId === Number(m[2])) : undefined
    if (!r || !item) throw notFound('Không tìm thấy mục checklist')
    ensureAssigned(me.userId, r.facilityId)
    if (r.status !== 'InProgress') throw conflict('Chỉ được cập nhật checklist khi ticket đang được xử lý')
    if (r.assignedStaffId != null && r.assignedStaffId !== me.userId) throw conflict('Yêu cầu đã được nhân viên khác tiếp nhận')
    const done = !!body.isCompleted
    r.assignedStaffId = me.userId
    item.isCompleted = done
    item.completedByStaffId = done ? me.userId : null
    item.completedAt = done ? localIso(new Date()) : null
    item.notes = String(body.notes ?? '').trim() || null
    db.supportUpdates.push({ updateId: nextId(), requestId: r.requestId, updatedByUserId: me.userId, actionMessage: `Checklist ${done ? 'hoàn tất' : 'bỏ hoàn tất'}: ${item.description}`, previousStatus: r.status, newStatus: r.status, createdAt: localIso(new Date()) })
    return checklistDto(item)
  }],
  ['PUT', /^\/api\/support-requests\/(\d+)$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const status = String(body.status)
    if (!SUPPORT_STATUSES.includes(status)) throw bad('Trạng thái yêu cầu không hợp lệ')
    const msg = String(body.actionMessage ?? '').trim()
    if (!msg) throw bad('Vui lòng nhập nội dung cập nhật')
    const r = db.supports.find((x) => x.requestId === Number(m[1]))
    if (!r) throw notFound('Không tìm thấy yêu cầu hỗ trợ')
    ensureAssigned(me.userId, r.facilityId)
    if (r.assignedStaffId != null && r.assignedStaffId !== me.userId) throw conflict('Yêu cầu đã được nhân viên khác tiếp nhận')
    if (r.status === 'Closed' || (r.status === 'Resolved' && status !== 'Closed')) throw conflict('Yêu cầu đã kết thúc xử lý')
    const ok = r.status === 'Open' ? status === 'InProgress' : r.status === 'InProgress' ? status === 'InProgress' || status === 'Resolved' : r.status === 'Resolved' ? status === 'Closed' : false
    if (!ok) throw conflict(`Không thể chuyển yêu cầu từ ${r.status} sang ${status}`)
    if (status === 'Resolved' && checklistOf(r).some((c) => !c.isCompleted)) throw conflict('Cần hoàn tất toàn bộ checklist trước khi đánh dấu ticket đã xử lý')
    const prev = r.status
    r.assignedStaffId = me.userId
    r.status = status
    r.resolvedAt = status === 'Resolved' || status === 'Closed' ? localIso(new Date()) : null
    db.supportUpdates.push({ updateId: nextId(), requestId: r.requestId, updatedByUserId: me.userId, actionMessage: msg, previousStatus: prev, newStatus: status, createdAt: localIso(new Date()) })
    return supportDto(r)
  }],

  // ---- visit registrations (customer books entry/exit times; staff approves; the gate admits only approved ones)
  ['GET', /^\/api\/contracts\/(\d+)\/visit-registrations$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const c = ownContract(me, Number(m[1]))
    return visitsOf().filter((v) => v.contractId === c.contractId && v.customerId === me.userId)
      .sort((a, b) => b.scheduledEntryAt.localeCompare(a.scheduledEntryAt)).map(visitDto)
  }],
  ['POST', /^\/api\/contracts\/(\d+)\/visit-registrations$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const c = ownContract(me, Number(m[1]))
    if (c.status !== 'Active' || findIssues(c).length) throw conflict('Chỉ khách có hợp đồng đang hoạt động và kho không bị khóa mới đăng ký ra/vào')
    const apId = body.authorizedPersonId == null ? null : Number(body.authorizedPersonId)
    const expected = resolveVisitor(c, apId)
    if (!expected || String(body.citizenId ?? '').trim().toLowerCase() !== expected.trim().toLowerCase())
      throw bad('CCCD không khớp với khách thuê hoặc người được ủy quyền trên hợp đồng')
    const entry = String(body.scheduledEntryAt ?? ''), exit = String(body.scheduledExitAt ?? '')
    const e1 = new Date(entry).getTime(), e2 = new Date(exit).getTime()
    if (!(e1 > Date.now()) || !(e2 > e1)) throw bad('Giờ ra/vào phải hợp lệ và nằm trong tương lai')
    if (entry.slice(0, 10) < c.startDate || entry.slice(0, 10) > c.endDate || exit.slice(0, 10) > c.endDate
      || (exit.slice(0, 10) === c.endDate && exit.slice(11, 16) >= '20:00'))
      throw bad('Thời gian đăng ký phải nằm trong thời hạn hợp đồng')
    if (visitsOf().some((v) => v.contractId === c.contractId && v.customerId === me.userId && (v.status === 'Pending' || v.status === 'Approved')
      && new Date(v.scheduledEntryAt).getTime() < e2 && e1 < new Date(v.scheduledExitAt).getTime()))
      throw conflict('Bạn đã có lịch ra/vào đang chờ duyệt hoặc được duyệt trong khung giờ này')
    const purpose = String(body.purpose ?? '').trim()
    if (!purpose) throw bad('Vui lòng nhập mục đích vào kho')
    const v: Vreg = { visitRegistrationId: nextId(), contractId: c.contractId, customerId: me.userId, authorizedPersonId: apId, scheduledEntryAt: entry, scheduledExitAt: exit, purpose, status: 'Pending', requestedAt: localIso(new Date()), reviewedAt: null, reviewNotes: null }
    visitsOf().push(v)
    return visitDto(v)
  }],
  ['DELETE', /^\/api\/contracts\/(\d+)\/visit-registrations\/(\d+)$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const v = visitsOf().find((x) => x.visitRegistrationId === Number(m[2]) && x.contractId === Number(m[1]) && x.customerId === me.userId)
    if (!v) throw notFound('Không tìm thấy lịch ra/vào')
    if (v.status !== 'Pending') throw conflict('Chỉ có thể hủy lịch đang chờ staff duyệt')
    v.status = 'Cancelled'
    return visitDto(v)
  }],
  ['GET', /^\/api\/gate\/facilities\/(\d+)\/visit-registrations$/, (m, { token, query }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const fid = Number(m[1])
    ensureAssigned(me.userId, fid)
    const st = query.get('status')
    return visitsOf().filter((v) => unitById(db.contracts.find((c) => c.contractId === v.contractId)!.unitId).facilityId === fid && (!st || v.status === st))
      .sort((a, b) => a.scheduledEntryAt.localeCompare(b.scheduledEntryAt)).map(visitDto)
  }],
  ['POST', /^\/api\/gate\/facilities\/(\d+)\/visit-registrations\/(\d+)\/review$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const fid = Number(m[1])
    ensureAssigned(me.userId, fid)
    const v = visitsOf().find((x) => x.visitRegistrationId === Number(m[2]))
    if (!v) throw notFound('Không tìm thấy lịch ra/vào tại cơ sở này')
    if (v.status !== 'Pending') throw conflict('Lịch ra/vào này đã được staff xử lý')
    const approve = body.approve === true
    if (approve) {
      if (new Date(v.scheduledEntryAt).getTime() <= Date.now()) throw conflict('Không thể duyệt lịch đã qua giờ vào dự kiến')
      const c = db.contracts.find((x) => x.contractId === v.contractId)!
      if (c.status !== 'Active' || findIssues(c).length) throw conflict('Hợp đồng hoặc kho không còn đủ điều kiện ra/vào')
    }
    v.status = approve ? 'Approved' : 'Rejected'
    v.reviewedAt = localIso(new Date())
    v.reviewNotes = String(body.notes ?? '').trim() || null
    return visitDto(v)
  }],

  // ---- gate
  ['GET', /^\/api\/gate\/my-facilities$/, (_m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    return db.assignments.filter((a) => a.staffId === me.userId).map((a) => facilityById(a.facilityId)!)
  }],
  ['GET', /^\/api\/gate\/facilities\/(\d+)\/lookup$/, (m, { token, query }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const fid = Number(m[1])
    ensureAssigned(me.userId, fid)
    const q = (query.get('q') ?? '').trim()
    if (q.length < 2) throw bad('Nhập ít nhất 2 ký tự để tìm')
    const qu = q.toUpperCase()
    return db.contracts
      .filter((c) => unitById(c.unitId).facilityId === fid)
      .filter((c) => {
        const cust = userById(c.customerId)
        return unitById(c.unitId).unitCode.toUpperCase() === qu || c.contractNumber.toUpperCase() === qu
          || cust.citizenId === q || cust.phoneNumber === q
          || db.persons.some((p) => p.contractId === c.contractId && p.status === 'Active' && (p.citizenId === q || p.phoneNumber === q))
      })
      .sort((a, b) => b.endDate.localeCompare(a.endDate))
      .slice(0, 10)
      .map<VisitCandidate>((c) => {
        const cust = userById(c.customerId)
        const issues = findIssues(c)
        return {
          contractId: c.contractId, contractNumber: c.contractNumber, contractStatus: c.status,
          startDate: c.startDate, endDate: c.endDate, unitCode: unitById(c.unitId).unitCode, unitStatus: unitById(c.unitId).status,
          customer: { authorizedPersonId: null, fullName: cust.fullName, citizenId: cust.citizenId, phoneNumber: cust.phoneNumber, relationship: 'Chủ hợp đồng' },
          authorizedPersons: db.persons.filter((p) => p.contractId === c.contractId && p.status === 'Active').map(personDto),
          peopleInside: db.records.filter((r) => r.contractId === c.contractId && r.result === 'Granted' && !r.exitTime).map((r) => recordDto(r).visitorName),
          issues, hasApprovedVisitRegistration: approvedNow(c.contractId).length > 0,
          canEnter: issues.length === 0 && approvedNow(c.contractId).length > 0,
        }
      })
  }],
  ['POST', /^\/api\/gate\/facilities\/(\d+)\/entries$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const fid = Number(m[1])
    ensureAssigned(me.userId, fid)
    const c = loadContract(fid, Number(body.contractId))
    const issues = findIssues(c)
    if (issues.length) throw conflict(`Không thể cho vào: ${issues[0].message}. Hãy ghi nhận từ chối với lý do ${issues[0].code}.`)
    const apId = body.authorizedPersonId == null ? null : Number(body.authorizedPersonId)
    const expected = resolveVisitor(c, apId)
    const typed = String(body.citizenId ?? '').trim()
    if (!expected?.trim()) throw bad('Người này chưa có số CCCD trong hồ sơ, không thể xác thực. Hãy từ chối với lý do IdentityMismatch.')
    if (!typed) throw bad('Vui lòng nhập số CCCD trên thẻ của khách')
    if (typed.toLowerCase() !== expected.trim().toLowerCase()) throw bad('Số CCCD không khớp với hồ sơ. Hãy kiểm tra lại hoặc từ chối với lý do IdentityMismatch.')
    const reg = visitsOf().find((v) => v.visitRegistrationId === Number(body.visitRegistrationId) && v.contractId === c.contractId && v.status === 'Approved')
    if (!reg) throw conflict('Không tìm thấy lịch ra/vào đã được staff duyệt cho hợp đồng này')
    const now = Date.now()
    if (now < new Date(reg.scheduledEntryAt).getTime() || now > new Date(reg.scheduledExitAt).getTime())
      throw conflict('Chỉ được vào trong khung giờ đã đăng ký')
    if (reg.authorizedPersonId !== apId) throw forbidden()
    if (db.records.some((r) => (r as Rec & { visitRegistrationId?: number }).visitRegistrationId === reg.visitRegistrationId && r.result === 'Granted'))
      throw conflict('Lịch ra/vào này đã được sử dụng')
    if (db.records.some((r) => r.contractId === c.contractId && r.authorizedPersonId === apId && r.result === 'Granted' && !r.exitTime))
      throw conflict('Người này đang ở trong kho, hãy xác nhận ra trước')
    const rec: Rec & { visitRegistrationId?: number } = { accessRecordId: nextId(), contractId: c.contractId, facilityId: fid, unitId: c.unitId, authorizedPersonId: apId, verifiedByStaffId: me.userId, result: 'Granted', denyReason: null, purpose: (body.purpose as string) || reg.purpose, entryTime: localIso(new Date()), exitTime: null, visitRegistrationId: reg.visitRegistrationId }
    db.records.push(rec)
    return recordDto(rec)
  }],
  ['POST', /^\/api\/gate\/facilities\/(\d+)\/denials$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const fid = Number(m[1])
    ensureAssigned(me.userId, fid)
    const reasons = ['IdentityMismatch', 'NotAuthorized', 'ContractEnded', 'OverdueLocked', 'OutsideOperatingHours', 'UnitUnderMaintenance', 'Other']
    if (!reasons.includes(String(body.reason))) throw bad('Lý do không hợp lệ: ' + reasons.join(', '))
    const c = loadContract(fid, Number(body.contractId))
    const apId = body.authorizedPersonId == null ? null : Number(body.authorizedPersonId)
    if (apId != null) resolveVisitor(c, apId)
    const rec: Rec = { accessRecordId: nextId(), contractId: c.contractId, facilityId: fid, unitId: c.unitId, authorizedPersonId: apId, verifiedByStaffId: me.userId, result: 'Denied', denyReason: String(body.reason), purpose: null, entryTime: localIso(new Date()), exitTime: null }
    db.records.push(rec)
    return recordDto(rec)
  }],
  ['GET', /^\/api\/gate\/facilities\/(\d+)\/inside$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    ensureAssigned(me.userId, Number(m[1]))
    return db.records.filter((r) => r.facilityId === Number(m[1]) && r.result === 'Granted' && !r.exitTime)
      .sort((a, b) => a.entryTime.localeCompare(b.entryTime)).map(recordDto)
  }],
  ['GET', /^\/api\/gate\/facilities\/(\d+)\/today$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    ensureAssigned(me.userId, Number(m[1]))
    const t = today()
    return db.records.filter((r) => r.facilityId === Number(m[1]) && r.entryTime >= t)
      .sort((a, b) => b.entryTime.localeCompare(a.entryTime)).map(recordDto)
  }],
  ['POST', /^\/api\/gate\/access-records\/(\d+)\/exit$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const r = db.records.find((x) => x.accessRecordId === Number(m[1]))
    if (!r) throw notFound('Không tìm thấy lượt ra vào')
    ensureAssigned(me.userId, r.facilityId)
    if (r.result !== 'Granted' || r.exitTime) throw conflict('Lượt này không ở trạng thái đang ở trong kho')
    r.exitTime = localIso(new Date())
    return recordDto(r)
  }],
  // ---- system administrator
  ['GET', /^\/api\/admin\/roles$/, (_m, { token }) => { requireRole(currentUser(token), [Roles.Admin]); return ROLE_ROWS }],
  ['GET', /^\/api\/admin\/users$/, (_m, { token }) => {
    requireRole(currentUser(token), [Roles.Admin])
    return [...db.users].sort((a, b) => a.userId - b.userId).map(adminUserDto)
  }],
  ['POST', /^\/api\/admin\/users$/, (_m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Admin])
    const f = body as Record<string, string>
    for (const k of ['username', 'password', 'fullName', 'email', 'phoneNumber'])
      if (!String(f[k] ?? '').trim()) throw bad('Vui lòng nhập đầy đủ thông tin')
    if (f.username.trim().length < 3) throw bad('Tên đăng nhập cần ít nhất 3 ký tự')
    if (f.password.length < 8) throw bad('Mật khẩu cần ít nhất 8 ký tự')
    const role = roleRow(Number(body.roleId))
    if (!role) throw notFound('Không tìm thấy vai trò')
    const citizenId = String(f.citizenId ?? '').trim() || null
    if (db.users.some((u) => u.username === f.username.trim() || u.email === f.email.trim() || (citizenId && u.citizenId === citizenId)))
      throw conflict('Tên đăng nhập, email hoặc CCCD đã được sử dụng')
    const facilityIds = [...new Set((body.facilityIds as number[] | undefined) ?? [])]
    if (facilityIds.length && role.roleName !== Roles.Staff && role.roleName !== Roles.Manager)
      throw bad('Chỉ nhân viên cơ sở hoặc quản lý cơ sở mới được phân công theo cơ sở')
    if (facilityIds.some((id) => !facilityById(id))) throw bad('Danh sách có cơ sở không tồn tại')
    const u: User = { userId: nextId(), username: f.username.trim(), password: f.password, fullName: f.fullName.trim(), email: f.email.trim(), phoneNumber: f.phoneNumber.trim(), citizenId, role: role.roleName, status: 'Active' }
    db.users.push(u)
    for (const facilityId of facilityIds) db.assignments.push({ facilityId, staffId: u.userId })
    addLog(u.userId, 'AdminUserCreated', `Created account ${u.username} with role ${role.roleName}`)
    return adminUserDto(u)
  }],
  ['PUT', /^\/api\/admin\/users\/(\d+)\/role$/, (m, { token, body }) => {
    const { me, u } = adminTarget(token, Number(m[1]))
    const role = roleRow(Number(body.roleId))
    if (!role) throw notFound('Không tìm thấy vai trò')
    if (u.userId === me.userId && u.role !== role.roleName) throw conflict('Không thể tự đổi vai trò của chính mình')
    if (u.role === Roles.Admin && role.roleName !== Roles.Admin) ensureAnotherActiveAdmin(u.userId)
    const old = u.role
    u.role = role.roleName
    if (!STAFF.includes(role.roleName)) db.assignments = db.assignments.filter((a) => a.staffId !== u.userId)
    addLog(me.userId, 'AdminUserRoleChanged', `Changed user ${u.userId} role from ${old} to ${role.roleName}`)
    return adminUserDto(u)
  }],
  ['PUT', /^\/api\/admin\/users\/(\d+)\/status$/, (m, { token, body }) => {
    const status = String(body.status ?? '')
    if (!ACCOUNT_STATUSES.includes(status)) throw bad('Trạng thái tài khoản không hợp lệ')
    const { me, u } = adminTarget(token, Number(m[1]))
    if (u.userId === me.userId && status !== 'Active') throw conflict('Không thể tự vô hiệu hóa tài khoản quản trị của mình')
    if (u.role === Roles.Admin && status !== 'Active') ensureAnotherActiveAdmin(u.userId)
    u.status = status
    addLog(me.userId, 'AdminUserStatusChanged', `Changed user ${u.userId} status to ${status}`)
    return adminUserDto(u)
  }],
  ['GET', /^\/api\/admin\/users\/(\d+)\/activity$/, (m, { token }) => {
    const { u } = adminTarget(token, Number(m[1]))
    return (db.logs ?? []).filter((l) => l.userId === u.userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map<ActivityLog>(({ logId, action, details, ipAddress, createdAt }) => ({ logId, action, details, ipAddress, createdAt }))
  }],
  // ---- business operations manager (OperationsManagementController, OperationsReportsController)
  ['GET', /^\/api\/operations\/facilities$/, (_m, { token }) => {
    requireRole(currentUser(token), [Roles.OpsManager])
    return [...db.facilities].sort((a, b) => a.facilityName.localeCompare(b.facilityName))
  }],
  ['POST', /^\/api\/operations\/facilities$/, (_m, { token, body }) => {
    requireRole(currentUser(token), [Roles.OpsManager])
    const f = facilityFields(body)
    const facility: Facility = { facilityId: nextId(), ...f, operatingHours: f.operatingHours || '24/7 Access', status: 'Active' }
    db.facilities.push(facility)
    return facility
  }],
  ['PUT', /^\/api\/operations\/facilities\/(\d+)$/, (m, { token, body }) => {
    requireRole(currentUser(token), [Roles.OpsManager])
    const status = String(body.status ?? '')
    if (!['Active', 'Maintenance', 'Closed'].includes(status)) throw bad('Trạng thái cơ sở không hợp lệ')
    const facility = facilityById(Number(m[1]))
    if (!facility) throw notFound('Không tìm thấy cơ sở')
    const f = facilityFields(body)
    if (!f.operatingHours) throw bad('Vui lòng nhập đầy đủ thông tin cơ sở')
    Object.assign(facility, f, { status })
    return facility
  }],
  // ---- operations manager: unit-type pricing, rental policies, fee table, promotions
  ['GET', /^\/api\/operations\/unit-types$/, (_m, { token }) => { opsOnly(token); return [...db.unitTypes].sort((a, b) => a.baseMonthlyRate - b.baseMonthlyRate) }],
  ['PUT', /^\/api\/operations\/unit-types\/(\d+)\/pricing$/, (m, { token, body }) => {
    opsOnly(token)
    const t = db.unitTypes.find((x) => x.unitTypeId === Number(m[1]))
    if (!t) throw notFound('Không tìm thấy loại kho')
    const daily = Number(body.baseDailyRate), monthly = Number(body.baseMonthlyRate)
    if (!(daily >= 0) || !(monthly >= 0.01)) throw bad('Giá thuê không hợp lệ')
    t.baseDailyRate = daily
    t.baseMonthlyRate = monthly
    db.units.filter((u) => u.unitTypeId === t.unitTypeId).forEach((u) => { u.monthlyPrice = monthly })
    return t
  }],
  ['GET', /^\/api\/operations\/rental-policies$/, (_m, { token }) => { opsOnly(token); return [...policiesOf()].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)) }],
  ['POST', /^\/api\/operations\/rental-policies$/, (_m, { token, body }) => {
    opsOnly(token)
    const p = { ...checkPolicy(body), policyId: nextId() }
    policiesOf().push(p)
    return p
  }],
  ['PUT', /^\/api\/operations\/rental-policies\/(\d+)$/, (m, { token, body }) => {
    opsOnly(token)
    const p = policiesOf().find((x) => x.policyId === Number(m[1]))
    if (!p) throw notFound('Không tìm thấy chính sách thuê')
    return Object.assign(p, checkPolicy(body))
  }],
  ['GET', /^\/api\/operations\/fees$/, (_m, { token }) => { opsOnly(token); return [...feesOf()].sort((a, b) => a.feeCode.localeCompare(b.feeCode)) }],
  ['POST', /^\/api\/operations\/fees$/, (_m, { token, body }) => {
    opsOnly(token)
    const f = { ...checkFee(body, null), feeTypeId: nextId() }
    feesOf().push(f)
    return f
  }],
  ['PUT', /^\/api\/operations\/fees\/(\d+)$/, (m, { token, body }) => {
    opsOnly(token)
    const f = feesOf().find((x) => x.feeTypeId === Number(m[1]))
    if (!f) throw notFound('Không tìm thấy loại phí')
    return Object.assign(f, checkFee(body, f.feeTypeId))
  }],
  ['GET', /^\/api\/operations\/promotions$/, (_m, { token }) => { opsOnly(token); return [...promotionsOf()].sort((a, b) => b.startDate.localeCompare(a.startDate)) }],
  ['POST', /^\/api\/operations\/promotions$/, (_m, { token, body }) => {
    opsOnly(token)
    const p = { ...checkPromotion(body, null), promotionId: nextId() }
    promotionsOf().push(p)
    return p
  }],
  ['PUT', /^\/api\/operations\/promotions\/(\d+)$/, (m, { token, body }) => {
    opsOnly(token)
    const p = promotionsOf().find((x) => x.promotionId === Number(m[1]))
    if (!p) throw notFound('Không tìm thấy khuyến mãi')
    return Object.assign(p, checkPromotion(body, p.promotionId))
  }],

  // ---- Google sign-in: the demo has no Google, the stand-in token is "demo-google|<email>|..."
  ['POST', /^\/api\/auth\/google$/, (_m, { body }) => {
    const idToken = String(body.idToken ?? '')
    if (idToken.length < 100) throw bad('IdToken không hợp lệ')
    const [kind, email] = idToken.split('|')
    if (kind !== 'demo-google') throw new MockHttpError(401, 'Google ID token không hợp lệ hoặc đã hết hạn.')
    const u = db.users.find((x) => x.email.toLowerCase() === String(email).toLowerCase() && (x.status ?? 'Active') === 'Active')
    if (!u) throw new MockHttpError(401, 'Tài khoản Google không thể đăng nhập.')
    addLog(u.userId, 'GoogleLogin', 'Authenticated using a verified Google account')
    const res: LoginResponse = { token: `mock.${u.userId}`, expiresAt: localIso(addDays(new Date(), 1)), user: toUserDto(u) }
    return res
  }],

  // ---- reservation cancellation (ReservationsController)
  ['POST', /^\/api\/reservations\/(\d+)\/cancellation-requests$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    const r = db.reservations.find((x) => x.reservationId === Number(m[1]) && x.customerId === me.userId)
    if (!r) throw notFound('Không tìm thấy đơn đặt kho')
    if (r.status !== 'PendingDeposit' && r.status !== 'Confirmed') throw conflict('Chỉ có thể yêu cầu hủy đơn chưa nhận kho')
    if (r.status === 'Confirmed' && localIso(new Date()) >= `${r.expectedStartDate}T20:00:00`) throw conflict('Đơn đã qua thời hạn nhận kho; vui lòng liên hệ nhân viên cơ sở')
    if (cancellationsOf().some((c) => c.reservationId === r.reservationId && c.status === 'Pending')) throw conflict('Đơn này đang có yêu cầu hủy chờ xử lý')
    const reason = String(body.reason ?? '').trim()
    if (!reason) throw bad('Vui lòng nhập lý do hủy')
    if (reason.length > 1000) throw bad('Lý do tối đa 1000 ký tự')
    const c: Cnl = { cancellationRequestId: nextId(), reservationId: r.reservationId, customerId: me.userId, reason, status: 'Pending', requestedAt: localIso(new Date()), resolvedAt: null, resolvedByStaffId: null, resolutionNotes: null, approvedRefundAmount: null, refunds: [] }
    cancellationsOf().push(c)
    return cancellationDto(c)
  }],
  ['GET', /^\/api\/reservations\/(\d+)\/cancellation-requests\/my$/, (m, { token }) => {
    const me = currentUser(token)
    requireRole(me, [Roles.Customer])
    if (!db.reservations.some((x) => x.reservationId === Number(m[1]) && x.customerId === me.userId)) throw notFound('Không tìm thấy đơn đặt kho')
    return cancellationsOf().filter((c) => c.reservationId === Number(m[1])).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.cancellationRequestId - a.cancellationRequestId).map(cancellationDto)
  }],
  ['POST', /^\/api\/reservations\/(\d+)\/cancellation-refunds$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const method = String(body.paymentMethod ?? '')
    if (method !== 'Cash' && method !== 'BankTransfer') throw bad('Phương thức hoàn cọc chỉ hỗ trợ tiền mặt hoặc chuyển khoản')
    const code = String(body.transactionCode ?? '').trim() || null
    if (method === 'BankTransfer' && !code) throw bad('Hoàn cọc qua chuyển khoản phải có mã giao dịch')
    const r = db.reservations.find((x) => x.reservationId === Number(m[1]))
    if (!r) throw notFound('Không tìm thấy đơn đặt kho')
    ensureAssigned(me.userId, r.facilityId)
    const c = cancellationsOf().filter((x) => x.reservationId === r.reservationId && x.status === 'Approved').sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt)))[0]
    if (!c) throw conflict('Yêu cầu hủy chưa được duyệt')
    if (!r.depositWasPaid) throw conflict('Khoản cọc chưa được ghi nhận thanh toán')
    if (code && cancellationsOf().some((x) => x.refunds.some((f) => f.code === code))) throw conflict('Mã giao dịch đã được ghi nhận')
    const remaining = (c.approvedRefundAmount ?? 0) - c.refunds.reduce((n, f) => n + f.amount, 0)
    const amount = Number(body.amount)
    if (!(amount > 0) || amount > remaining) throw bad(`Số tiền hoàn còn được duyệt là ${Math.max(0, remaining).toLocaleString('vi-VN')}đ`)
    const at = localIso(new Date())
    c.refunds.push({ amount, method, code, at, staffId: me.userId })
    const res: CancellationRefund = { reservationId: r.reservationId, refundedAmount: amount, remainingRefund: remaining - amount, paymentMethod: method, transactionCode: code, refundedAt: at }
    return res
  }],

  // ---- facility operations (FacilityOperationsController)
  ['GET', /^\/api\/facilities\/(\d+)\/daily-operations$/, (m, { token, query }) => {
    const fid = Number(m[1])
    facilityStaff(token, fid)
    const date = query.get('date') || today()
    const checkIns = db.reservations.filter((r) => r.facilityId === fid && r.status === 'Confirmed'
      && (r.checkInAppointmentAt ? r.checkInAppointmentAt.slice(0, 10) === date : r.expectedStartDate === date))
      .sort((a, b) => String(a.checkInAppointmentAt ?? '').localeCompare(String(b.checkInAppointmentAt ?? ''))).map(reservationDto)
    const returns = db.contracts.filter((c) => unitById(c.unitId).facilityId === fid && c.endDate === date && (c.status === 'Active' || c.status === 'Overdue'))
      .sort((a, b) => a.contractNumber.localeCompare(b.contractNumber))
      .map<FacilityTaskContract>((c) => ({ contractId: c.contractId, contractNumber: c.contractNumber, customerName: userById(c.customerId).fullName, unitCode: unitById(c.unitId).unitCode, endDate: c.endDate, status: c.status, depositPaid: c.depositPaid, accumulatedLateFee: openOverdue(c.contractId)?.accumulatedLateFee ?? 0 }))
    const rank = (p: string) => (p === 'Urgent' ? 0 : p === 'High' ? 1 : 2)
    const supportRequests = db.supports.filter((r) => r.facilityId === fid && (r.status === 'Open' || r.status === 'InProgress'))
      .sort((a, b) => rank(a.priority) - rank(b.priority) || a.createdAt.localeCompare(b.createdAt)).map(supportDto)
    const res: FacilityWorkQueue = { date, checkIns, returns, supportRequests }
    return res
  }],
  ['GET', /^\/api\/facilities\/(\d+)\/contracts$/, (m, { token, query }) => {
    const fid = Number(m[1])
    facilityStaff(token, fid)
    const status = query.get('status')
    if (status && !['Active', 'Overdue', 'Terminated', 'Renewed', 'Liquidated'].includes(status)) throw bad('Trạng thái hợp đồng không hợp lệ')
    return db.contracts.filter((c) => unitById(c.unitId).facilityId === fid && (!status || c.status === status))
      .sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 500).map(contractDto)
  }],
  ['GET', /^\/api\/facilities\/(\d+)\/cancellation-requests$/, (m, { token, query }) => {
    const fid = Number(m[1])
    facilityStaff(token, fid)
    const status = query.get('status')
    return cancellationsOf().filter((c) => db.reservations.find((r) => r.reservationId === c.reservationId)!.facilityId === fid && (!status || c.status === status))
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)).map(cancellationDto)
  }],
  ['POST', /^\/api\/facilities\/(\d+)\/cancellation-requests\/(\d+)\/resolve$/, (m, { token, body }) => {
    const fid = Number(m[1])
    const me = facilityStaff(token, fid)
    const c = cancellationsOf().find((x) => x.cancellationRequestId === Number(m[2]) && db.reservations.find((r) => r.reservationId === x.reservationId)!.facilityId === fid)
    if (!c) throw notFound('Không tìm thấy yêu cầu hủy')
    if (c.status !== 'Pending') throw conflict('Yêu cầu hủy đã được xử lý')
    const r = db.reservations.find((x) => x.reservationId === c.reservationId)!
    const approve = body.approve === true
    if (approve && r.status !== 'PendingDeposit' && r.status !== 'Confirmed') throw conflict('Đơn đặt kho không còn ở trạng thái có thể hủy')
    if (approve) {
      const paid = r.status === 'Confirmed' ? r.depositAmount : 0
      const policy = policiesOf().find((p) => p.isActive && (p.facilityId === fid || p.facilityId == null))
      const fee = Math.round(paid * (policy?.cancellationFeePercent ?? 0)) / 100
      c.approvedRefundAmount = Math.max(0, paid - fee)
      r.depositWasPaid = paid > 0
      r.status = 'Cancelled'
    }
    c.status = approve ? 'Approved' : 'Rejected'
    c.resolvedByStaffId = me.userId
    c.resolvedAt = localIso(new Date())
    c.resolutionNotes = String(body.notes ?? '').trim() || null
    addLog(me.userId, approve ? 'ReservationCancellationApproved' : 'ReservationCancellationRejected', `Reservation ${r.reservationCode}; approved refund ${(c.approvedRefundAmount ?? 0).toLocaleString('vi-VN')}`)
    return cancellationDto(c)
  }],
  ['GET', /^\/api\/facilities\/(\d+)\/dashboard$/, (m, { token, query }) => {
    const fid = Number(m[1])
    const me = currentUser(token)
    requireRole(me, [Roles.Manager, Roles.OpsManager])
    if (me.role === Roles.Manager) ensureAssigned(me.userId, fid)
    if (!facilityById(fid)) throw notFound('Không tìm thấy cơ sở')
    const { from, to } = dateRange(query)
    return facilityKpis(fid, from, to)
  }],

  // ---- facility management (FacilityManagementController)
  ['GET', /^\/api\/facility-management\/facilities\/(\d+)\/units$/, (m, { token }) => {
    const fid = Number(m[1])
    facilityStaff(token, fid, [Roles.Manager])
    return db.units.filter((u) => u.facilityId === fid).sort((a, b) => a.floorNumber - b.floorNumber || a.unitCode.localeCompare(b.unitCode)).map(unitDto)
  }],
  ['POST', /^\/api\/facility-management\/facilities\/(\d+)\/units$/, (m, { token, body }) => {
    const fid = Number(m[1])
    facilityStaff(token, fid, [Roles.Manager])
    if (facilityById(fid)!.status !== 'Active') throw conflict('Chỉ được tạo kho tại cơ sở đang hoạt động')
    const { type, code, floor, zone } = unitFields(body)
    if (db.units.some((u) => u.facilityId === fid && u.unitCode === code)) throw conflict('Mã kho này đã tồn tại tại cơ sở')
    const u: Unit = { unitId: nextId(), facilityId: fid, unitTypeId: type.unitTypeId, unitCode: code, floorNumber: floor, zoneArea: zone, monthlyPrice: type.baseMonthlyRate, status: 'Available' }
    db.units.push(u)
    return unitDto(u)
  }],
  ['PUT', /^\/api\/facility-management\/facilities\/(\d+)\/units\/(\d+)$/, (m, { token, body }) => {
    const fid = Number(m[1])
    facilityStaff(token, fid, [Roles.Manager])
    const u = db.units.find((x) => x.unitId === Number(m[2]) && x.facilityId === fid)
    if (!u) throw notFound('Không tìm thấy kho tại cơ sở')
    if (['Rented', 'OverdueLocked', 'Reserved'].includes(u.status)) throw conflict('Không thể sửa thông tin loại/vị trí kho khi kho đang được thuê hoặc giữ chỗ')
    if (db.contracts.some((c) => c.unitId === u.unitId && (c.status === 'Active' || c.status === 'Overdue'))) throw conflict('Không thể sửa kho đang có hợp đồng hiệu lực')
    const { type, code, floor, zone } = unitFields(body)
    if (u.status === 'Available' && u.unitTypeId !== type.unitTypeId && spareUnits(fid, u.unitTypeId) - 1 < 0)
      throw conflict('Không thể đổi loại kho vì sẽ làm thiếu chỗ cho các đơn đã đặt')
    if (db.units.some((x) => x.facilityId === fid && x.unitId !== u.unitId && x.unitCode === code)) throw conflict('Mã kho này đã tồn tại tại cơ sở')
    Object.assign(u, { unitTypeId: type.unitTypeId, unitCode: code, floorNumber: floor, zoneArea: zone, monthlyPrice: type.baseMonthlyRate })
    return unitDto(u)
  }],
  ['PUT', /^\/api\/facility-management\/facilities\/(\d+)\/units\/(\d+)\/status$/, (m, { token, body }) => {
    const fid = Number(m[1])
    const me = facilityStaff(token, fid)
    const status = String(body.status ?? '')
    if (status !== 'Available' && status !== 'UnderMaintenance') throw bad('Trạng thái kho chỉ có thể chuyển thủ công giữa Available và UnderMaintenance')
    const u = db.units.find((x) => x.unitId === Number(m[2]) && x.facilityId === fid)
    if (!u) throw notFound('Không tìm thấy kho tại cơ sở')
    if (db.contracts.some((c) => c.unitId === u.unitId && (c.status === 'Active' || c.status === 'Overdue'))) throw conflict('Không thể đổi trạng thái kho đang có hợp đồng hiệu lực')
    if (status === 'UnderMaintenance' && u.status === 'Available' && spareUnits(fid, u.unitTypeId) - 1 < 0)
      throw conflict('Không thể đưa kho vào bảo trì vì sẽ làm thiếu chỗ cho các đơn đã đặt')
    addLog(me.userId, 'StorageUnitStatusChanged', `Unit ${u.unitCode}: ${u.status} -> ${status}`)
    u.status = status
    return unitDto(u)
  }],
  ['GET', /^\/api\/facility-management\/facilities\/(\d+)\/staff$/, (m, { token }) => {
    const fid = Number(m[1])
    facilityStaff(token, fid, [Roles.Manager])
    return db.assignments.filter((a) => a.facilityId === fid).map((a) => ({ a, u: userById(a.staffId) }))
      .filter(({ u }) => u.role === Roles.Staff).sort((x, y) => x.u.fullName.localeCompare(y.u.fullName))
      .map<FacilityStaff>(({ a, u }) => ({ userId: u.userId, username: u.username, fullName: u.fullName, email: u.email, status: u.status ?? 'Active', assignedDate: a.assignedDate ?? '2026-01-05' }))
  }],
  ['POST', /^\/api\/facility-management\/facilities\/(\d+)\/staff$/, (m, { token, body }) => {
    const fid = Number(m[1])
    const me = facilityStaff(token, fid, [Roles.Manager])
    const u = db.users.find((x) => x.userId === Number(body.staffUserId))
    if (!u) throw notFound('Không tìm thấy tài khoản nhân viên')
    if (u.role !== Roles.Staff || (u.status ?? 'Active') !== 'Active') throw bad('Chỉ có thể phân công tài khoản Facility Staff đang hoạt động')
    if (db.assignments.some((a) => a.facilityId === fid && a.staffId === u.userId)) throw conflict('Nhân viên đã được phân công tại cơ sở này')
    const a = { facilityId: fid, staffId: u.userId, assignedDate: today() }
    db.assignments.push(a)
    addLog(me.userId, 'FacilityStaffAssigned', `Assigned staff user ${u.userId} to facility ${fid}`)
    const res: FacilityStaff = { userId: u.userId, username: u.username, fullName: u.fullName, email: u.email, status: u.status ?? 'Active', assignedDate: a.assignedDate }
    return res
  }],
  ['DELETE', /^\/api\/facility-management\/facilities\/(\d+)\/staff\/(\d+)$/, (m, { token }) => {
    const fid = Number(m[1])
    const me = facilityStaff(token, fid, [Roles.Manager])
    const i = db.assignments.findIndex((a) => a.facilityId === fid && a.staffId === Number(m[2]) && userById(a.staffId).role === Roles.Staff)
    if (i < 0) throw notFound('Không tìm thấy phân công đang hoạt động')
    db.assignments.splice(i, 1)
    addLog(me.userId, 'FacilityStaffRemoved', `Removed staff user ${m[2]} from facility ${fid}`)
    return undefined
  }],
  ['POST', /^\/api\/facility-management\/facilities\/(\d+)\/contracts\/(\d+)\/extra-charges$/, (m, { token, body }) => {
    const fid = Number(m[1])
    const me = facilityStaff(token, fid)
    const c = db.contracts.find((x) => x.contractId === Number(m[2]) && unitById(x.unitId).facilityId === fid)
    if (!c) throw notFound('Không tìm thấy hợp đồng tại cơ sở')
    if (c.status !== 'Active' && c.status !== 'Overdue') throw conflict('Chỉ được lập phụ thu cho hợp đồng đang hoạt động')
    const feeCode = SQL_FEE_CODES[Number(body.feeTypeId) - 1]
    const fee = feesOf().find((f) => f.feeCode === feeCode)
    if (!fee) throw notFound('Không tìm thấy loại phí')
    const unitPrice = fee.calculationMethod === 'Percentage' ? Math.round(c.monthlyRentFee * fee.defaultAmount) / 100 : fee.defaultAmount
    if (!(unitPrice > 0)) throw conflict('Loại phí chưa có đơn giá lớn hơn 0')
    const quantity = Number(body.quantity)
    if (!(Number.isInteger(quantity) && quantity >= 1 && quantity <= 365)) throw bad('Số lượng từ 1 đến 365')
    const dueDate = String(body.dueDate || today())
    if (dueDate < today()) throw bad('Ngày đến hạn phụ thu không được ở quá khứ')
    const notes = String(body.notes ?? '').trim() || null
    const x: Xtra = { id: nextId(), contractId: c.contractId, feeCode: fee.feeCode, feeName: fee.feeName, unitPrice, quantity, notes, dueDate, createdAt: localIso(new Date()) }
    ;(db.extraCharges ??= []).push(x)
    addLog(me.userId, 'ExtraChargeInvoiceCreated', `Created ${fee.feeCode} charge invoice for contract ${c.contractNumber}`)
    const res: ExtraChargeInvoice = { invoiceId: 40000 + x.id, invoiceNumber: `INV-EXT-${x.id}`, invoiceType: 'EXTRA_CHARGE', totalAmount: unitPrice * quantity, dueDate, status: 'Unpaid', contractId: c.contractId }
    return res
  }],

  // ---- system administrator: contracts (AdminContractsController)
  ['GET', /^\/api\/admin\/contracts$/, (_m, { token, query }) => {
    adminOnly(token)
    const { skip, size } = paging(query)
    const status = query.get('status'), fid = Number(query.get('facilityId')) || null, term = (query.get('search') ?? '').trim().toLowerCase()
    if (status && !['Active', 'Overdue', 'Renewed', 'Terminated', 'Liquidated'].includes(status)) throw bad('Trạng thái hợp đồng không hợp lệ')
    return db.contracts.map(adminContractDto)
      .filter((c) => (!status || c.status === status) && (!fid || c.facilityId === fid)
        && (!term || [c.contractNumber, c.customerName, c.customerEmail, c.unitCode].some((v) => v.toLowerCase().includes(term))))
      .sort((a, b) => b.signedDate.localeCompare(a.signedDate) || b.contractId - a.contractId).slice(skip, skip + size)
  }],
  ['GET', /^\/api\/admin\/contracts\/(\d+)$/, (m, { token }) => {
    adminOnly(token)
    const c = db.contracts.find((x) => x.contractId === Number(m[1]))
    if (!c) throw notFound('Không tìm thấy hợp đồng')
    return adminContractDto(c)
  }],
  ['PUT', /^\/api\/admin\/contracts\/(\d+)$/, (m, { token, body }) => {
    const me = adminOnly(token)
    const c = db.contracts.find((x) => x.contractId === Number(m[1]))
    if (!c) throw notFound('Không tìm thấy hợp đồng')
    if (c.status !== 'Active') throw conflict('Chỉ được chỉnh sửa hợp đồng đang hoạt động; hợp đồng quá hạn cần xử lý theo luồng quá hạn')
    const end = String(body.endDate ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= c.startDate || end < today()) throw bad('Ngày kết thúc mới phải sau ngày bắt đầu và không ở quá khứ')
    if (end !== c.endDate && db.renewals.some((r) => r.contractId === c.contractId && (r.status === 'Pending' || r.status === 'Paid')))
      throw conflict('Không thể sửa ngày kết thúc khi hợp đồng có yêu cầu gia hạn đang chờ hoặc đã thanh toán')
    const terms = String(body.termsConditions ?? '').trim()
    if (terms.length > 4000) throw bad('Điều khoản tối đa 4000 ký tự')
    addLog(me.userId, 'AdminContractUpdated', `Contract ${c.contractNumber}; EndDate ${c.endDate} -> ${end}`)
    c.endDate = end
    c.termsConditions = terms || null
    return adminContractDto(c)
  }],
  ['PUT', /^\/api\/admin\/users\/(\d+)\/profile$/, (m, { token, body }) => {
    const { me, u } = adminTarget(token, Number(m[1]))
    const fullName = String(body.fullName ?? '').trim(), email = String(body.email ?? '').trim(), phone = String(body.phoneNumber ?? '').trim()
    const cccd = String(body.citizenId ?? '').trim() || null
    if (!fullName || !phone) throw bad('Họ tên và số điện thoại không được để trống')
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Email không hợp lệ')
    if (db.users.some((x) => x.userId !== u.userId && (x.email.toLowerCase() === email.toLowerCase() || (cccd && x.citizenId === cccd))))
      throw conflict('Email hoặc CCCD đã được sử dụng')
    Object.assign(u, { fullName, email, phoneNumber: phone, citizenId: cccd })
    addLog(me.userId, 'AdminUserProfileUpdated', `Updated profile fields for user ${u.userId}`)
    return adminUserDto(u)
  }],
  // ---- system administrator: invoice/receipt email outbox
  ['GET', /^\/api\/admin\/email-outbox$/, (_m, { token, query }) => {
    adminOnly(token)
    const { skip, size } = paging(query)
    const status = query.get('status')
    if (status && !['Pending', 'Processing', 'Sent', 'Failed'].includes(status)) throw bad('Trạng thái email không hợp lệ')
    return emailsOf().filter((e) => !status || e.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(skip, skip + size)
  }],
  ['POST', /^\/api\/admin\/email-outbox\/(\d+)\/retry$/, (m, { token }) => {
    adminOnly(token)
    const e = emailsOf().find((x) => x.emailOutboxMessageId === Number(m[1]))
    if (!e) throw notFound('Không tìm thấy email trong hàng đợi')
    if (e.status !== 'Failed') throw conflict('Chỉ có thể gửi lại email ở trạng thái Failed')
    Object.assign(e, { status: 'Pending', attemptCount: 0, nextAttemptAt: localIso(new Date()), lastError: null })
    return e
  }],
  // ---- report details (OperationsReportsController)
  ['GET', /^\/api\/operations\/reports\/details$/, (_m, { token, query }) => {
    requireRole(currentUser(token), [Roles.OpsManager, Roles.Admin])
    return reportRows(query)
  }],
  ['GET', /^\/api\/operations\/reports\/details\.csv$/, (_m, { token, query }) => {
    requireRole(currentUser(token), [Roles.OpsManager, Roles.Admin])
    const head = 'FacilityId,FacilityName,UnitTypeId,UnitTypeName,FromDate,ToDate,TotalUnits,AvailableUnits,ReservedUnits,RentedUnits,MaintenanceUnits,OverdueLockedUnits,OccupancyRatePercent,ActiveContracts,OverdueContracts,TerminatedContracts,RenewedContracts,LiquidatedContracts,NetRevenueVND'
    const q = (v: string) => `"${v.replaceAll('"', '""')}"`
    return '﻿' + [head, ...reportRows(query).map((r) => [r.facilityId, q(r.facilityName), r.unitTypeId, q(r.unitTypeName), r.fromDate, r.toDate, r.totalUnits, r.availableUnits,
      r.reservedUnits, r.rentedUnits, r.maintenanceUnits, r.overdueLockedUnits, r.occupancyRatePercent, r.activeContracts, r.overdueContracts, r.terminatedContracts,
      r.renewedContracts, r.liquidatedContracts, r.netRevenue].join(','))].join('\r\n')
  }],
  ['GET', /^\/api\/operations\/reports\/facilities$/, (_m, { token, query }) => {
    requireRole(currentUser(token), [Roles.OpsManager, Roles.Admin])
    const { from, to } = dateRange(query)
    const reports = [...db.facilities].sort((a, b) => a.facilityName.localeCompare(b.facilityName)).map((f) => facilityKpis(f.facilityId, from, to))
    const sum = (k: keyof FacilityReport) => reports.reduce((n, r) => n + (r[k] as number), 0)
    const result: OperationsReport = {
      fromDate: from, toDate: to, facilityCount: reports.length, totalUnits: sum('totalUnits'), availableUnits: sum('availableUnits'),
      rentedUnits: sum('rentedUnits'), maintenanceUnits: sum('maintenanceUnits'), overdueLockedUnits: sum('overdueLockedUnits'),
      activeContracts: sum('activeContracts'), overdueContracts: sum('overdueContracts'), openSupportRequests: sum('openSupportRequests'),
      netRevenue: sum('netRevenue'), facilities: reports,
    }
    return result
  }],
]

/** Handles one API call the way the real backend would. Throws MockHttpError for non-2xx answers. */
export async function mockRequest(method: string, url: string, body: unknown, token: string | null): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 120))   // feel like a network call
  const [path, qs = ''] = url.split('?')
  for (const [verb, re, handler] of routes) {
    if (verb !== method) continue
    const m = path.match(re)
    if (!m) continue
    // Work on a copy so a failed request leaves no half-applied change behind.
    const snapshot = JSON.stringify(db)
    try {
      const result = handler(m, { token, body: (body ?? {}) as Body, query: new URLSearchParams(qs) })
      save()
      return structuredClone(result)
    } catch (e) {
      if (!(e instanceof MockHttpError && e.message === 'Đơn đã quá hạn đặt cọc')) db = JSON.parse(snapshot) as Db
      throw e
    }
  }
  throw notFound(`Bản demo chưa hỗ trợ ${method} ${path}`)
}
