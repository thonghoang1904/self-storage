/**
 * Demo mode only (VITE_MOCK=true): an in-browser stand-in for the ASP.NET Core API so the frontend
 * can be tried without .NET or SQL Server. It follows the same rules as the real backend
 * (AccessService, ReservationsController, ...) and seeds the same demo data as DevSeeder.
 * Data lives in localStorage of this browser only; "Đặt lại dữ liệu demo" wipes it.
 */
import type {
  AccessIssue, AccessRecord, Availability, Contract, ContractDetail, Facility, Invoice, LoginResponse,
  OverdueSummary, Person, Renewal, SupportChecklistItem, SupportRequest, SupportUpdate, Reservation, ReturnUnitResult, StaffContract, StorageUnit, UnitType, UserDto, VisitCandidate,
} from '../types'
import { Roles } from '../types'

export const DEMO_PASSWORD = 'Demo@12345'
const DB_KEY = 'ss_mock_db_v6'

// ------------------------------------------------------------------ data model

interface User { userId: number; username: string; password: string; fullName: string; email: string; phoneNumber: string; citizenId: string; role: string }
interface Unit { unitId: number; facilityId: number; unitTypeId: number; unitCode: string; floorNumber: number; zoneArea: string; monthlyPrice: number; status: string }
interface Rsv { reservationId: number; reservationCode: string; customerId: number; facilityId: number; unitTypeId: number; assignedUnitId: number | null; expectedStartDate: string; durationMonths: number; depositAmount: number; estimatedTotalFee: number; status: string; depositDeadline: string; createdAt: string }
interface Ctr { contractId: number; contractNumber: string; customerId: number; unitId: number; startDate: string; endDate: string; monthlyRentFee: number; depositPaid: number; status: string }
interface Rnw { renewalId: number; contractId: number; oldEndDate: string; newEndDate: string; extensionMonths: number; renewalFee: number; status: string; requestedAt: string }
interface Sup { requestId: number; requestCode: string; customerId: number; facilityId: number; contractId: number; unitId: number; assignedStaffId: number | null; category: string; priority: string; title: string; description: string; status: string; createdAt: string; resolvedAt: string | null; checklist?: Chk[] }
interface Chk { checklistItemId: number; sortOrder: number; description: string; isCompleted: boolean; completedAt: string | null; completedByStaffId: number | null; notes: string | null }
interface SupUpd { updateId: number; requestId: number; updatedByUserId: number; actionMessage: string; previousStatus: string | null; newStatus: string | null; createdAt: string }
interface Ovd { overdueId: number; contractId: number; daysOverdue: number; accumulatedLateFee: number; lockAppliedAt: string; resolvedAt: string | null }
interface AuthPerson { authorizedPersonId: number; contractId: number; fullName: string; phoneNumber: string; citizenId: string; relationship: string | null; status: string }
interface Rec { accessRecordId: number; contractId: number; facilityId: number; unitId: number; authorizedPersonId: number | null; verifiedByStaffId: number; result: 'Granted' | 'Denied'; denyReason: string | null; purpose: string | null; entryTime: string; exitTime: string | null }

interface Db {
  seq: number
  users: User[]
  facilities: Facility[]
  assignments: { facilityId: number; staffId: number }[]
  unitTypes: UnitType[]
  units: Unit[]
  reservations: Rsv[]
  contracts: Ctr[]
  persons: AuthPerson[]
  records: Rec[]
  renewals: Rnw[]
  overdues: Ovd[]
  supports: Sup[]
  supportUpdates: SupUpd[]
  refunds?: { contractId: number; amount: number; at: string }[]
}

// ------------------------------------------------------------------ time helpers (server local time, like SYSDATETIME)

const pad = (n: number) => String(n).padStart(2, '0')
const localIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const dateOnly = (d: Date) => localIso(d).slice(0, 10)
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }
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
    { accessRecordId: 5, contractId: 5, facilityId: 1, unitId: unit(1, 'D-01').unitId, authorizedPersonId: 2, verifiedByStaffId: 3, result: 'Granted', denyReason: null, purpose: 'Nhập hàng', entryTime: localIso(atToday(6, 50)), exitTime: null },
  ]

  const rsvBase = { facilityId: 1, assignedUnitId: null, durationMonths: 6, createdAt: localIso(now) }
  const reservations: Rsv[] = [
    { ...rsvBase, reservationId: 1, reservationCode: 'RSV-DEMO-100231', customerId: 5, unitTypeId: 2, expectedStartDate: dateOnly(addDays(now, 2)), depositAmount: 1200000, estimatedTotalFee: 7200000, status: 'PendingDeposit', depositDeadline: localIso(addDays(now, 1)) },
    { ...rsvBase, reservationId: 2, reservationCode: 'RSV-DEMO-100198', customerId: 7, unitTypeId: 3, durationMonths: 3, expectedStartDate: dateOnly(now), depositAmount: 2400000, estimatedTotalFee: 7200000, status: 'Confirmed', depositDeadline: localIso(addDays(now, 1)) },
    { ...rsvBase, reservationId: 3, reservationCode: 'RSV-DEMO-099870', customerId: 4, unitTypeId: 2, durationMonths: 6, assignedUnitId: unit(1, 'B-01').unitId, expectedStartDate: dateOnly(addDays(now, -7)), depositAmount: 1200000, estimatedTotalFee: 7200000, status: 'CheckedIn', depositDeadline: localIso(addDays(now, -8)) },
  ]

  return {
    seq: 1000,
    users,
    facilities,
    assignments: [{ facilityId: 1, staffId: 2 }, { facilityId: 1, staffId: 3 }],
    unitTypes, units, reservations, contracts, persons, records,
    renewals: [],
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

function recordDto(r: Rec): AccessRecord {
  const c = db.contracts.find((x) => x.contractId === r.contractId)!
  const p = r.authorizedPersonId ? db.persons.find((x) => x.authorizedPersonId === r.authorizedPersonId) : null
  return {
    accessRecordId: r.accessRecordId,
    unitCode: unitById(r.unitId).unitCode,
    contractNumber: c.contractNumber,
    visitorName: p ? p.fullName : userById(c.customerId).fullName,
    result: r.result,
    denyReason: r.denyReason,
    purpose: r.purpose,
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
    durationMonths: r.durationMonths,
    depositAmount: r.depositAmount,
    estimatedTotalFee: r.estimatedTotalFee,
    status: r.status,
    depositDeadline: r.depositDeadline,
    customerName: userById(r.customerId).fullName,
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
    const status = r.status === 'PendingDeposit' ? (r.depositDeadline <= now ? 'Overdue' : 'Unpaid') : r.status === 'Confirmed' || r.status === 'CheckedIn' ? 'Paid' : 'Cancelled'
    const invoice: Invoice = { invoiceId: 10000 + r.reservationId, invoiceNumber: `INV-DEP-${r.reservationId}`, contractId: null, reservationId: r.reservationId, invoiceType: 'DEPOSIT', subTotal: r.depositAmount, discountAmount: 0, totalAmount: r.depositAmount, dueDate: r.depositDeadline.slice(0, 10), status, createdAt: r.createdAt,
      details: [{ detailId: 1, description: `Tiền cọc 1 tháng cho đơn ${r.reservationCode}`, quantity: 1, unitPrice: r.depositAmount, lineTotal: r.depositAmount }],
      payments: status === 'Paid' ? payments(1, r.depositAmount, p, r.createdAt, 'Nhân viên xác nhận đã nhận tiền cọc') : [] }
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
  return [...fromRsv, ...fromRenewals].sort((a, b) => b.invoice.createdAt.localeCompare(a.invoice.createdAt))
}


// Reset tokens for the forgot-password flow: token -> { userId, password at issue time, expiry }.
const resetTokens = new Map<string, { userId: number; password: string; expiresAt: number }>()

// ------------------------------------------------------------------ routes

type Body = Record<string, unknown>
type Handler = (m: RegExpMatchArray, ctx: { token: string | null; body: Body; query: URLSearchParams }) => unknown

const routes: [string, RegExp, Handler][] = [
  // ---- auth
  ['POST', /^\/api\/auth\/login$/, (_m, { body }) => {
    const u = db.users.find((x) => x.username === body.username)
    if (!u || u.password !== body.password) throw new MockHttpError(401, 'Sai tên đăng nhập hoặc mật khẩu')
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
    const r: Rsv = {
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
  ['POST', /^\/api\/reservations\/(\d+)\/check-in$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const r = db.reservations.find((x) => x.reservationId === Number(m[1]))
    if (!r) throw notFound('Không tìm thấy đơn đặt kho')
    ensureAssigned(me.userId, r.facilityId)
    if (r.status !== 'Confirmed') throw conflict('Đơn chưa được xác nhận cọc')
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
  ['POST', /^\/api\/contracts\/(\d+)\/return$/, (m, { token, body }) => {
    const me = currentUser(token)
    requireRole(me, STAFF)
    const c = db.contracts.find((x) => x.contractId === Number(m[1]))
    if (!c) throw notFound('Không tìm thấy hợp đồng')
    const unit = unitById(c.unitId)
    ensureAssigned(me.userId, unit.facilityId)
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
  ['POST', /^\/api\/invoices\/(\d+)\/checkout\/(vnpay|momo)$/, () => {
    throw bad('Bản demo không kết nối cổng thanh toán VNPay/MoMo thật. Khi chạy với backend, nút này chuyển sang trang thanh toán.')
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
          issues, canEnter: issues.length === 0,
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
    if (db.records.some((r) => r.contractId === c.contractId && r.authorizedPersonId === apId && r.result === 'Granted' && !r.exitTime))
      throw conflict('Người này đang ở trong kho, hãy xác nhận ra trước')
    const rec: Rec = { accessRecordId: nextId(), contractId: c.contractId, facilityId: fid, unitId: c.unitId, authorizedPersonId: apId, verifiedByStaffId: me.userId, result: 'Granted', denyReason: null, purpose: (body.purpose as string) || null, entryTime: localIso(new Date()), exitTime: null }
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
