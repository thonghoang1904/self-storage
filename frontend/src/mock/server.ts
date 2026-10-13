/**
 * Demo mode only (VITE_MOCK=true): an in-browser stand-in for the ASP.NET Core API so the frontend
 * can be tried without .NET or SQL Server. It follows the same rules as the real backend
 * (AccessService, ReservationsController, ...) and seeds the same demo data as DevSeeder.
 * Data lives in localStorage of this browser only; "Đặt lại dữ liệu demo" wipes it.
 */
import type {
  AccessIssue, AccessRecord, Availability, Contract, Facility, LoginResponse, Person, Reservation,
  StorageUnit, UnitType, UserDto, VisitCandidate,
} from '../types'
import { Roles } from '../types'

export const DEMO_PASSWORD = 'Demo@12345'
const DB_KEY = 'ss_mock_db_v1'

// ------------------------------------------------------------------ data model

interface User { userId: number; username: string; password: string; fullName: string; email: string; phoneNumber: string; citizenId: string; role: string }
interface Unit { unitId: number; facilityId: number; unitTypeId: number; unitCode: string; floorNumber: number; zoneArea: string; monthlyPrice: number; status: string }
interface Rsv { reservationId: number; reservationCode: string; customerId: number; facilityId: number; unitTypeId: number; assignedUnitId: number | null; expectedStartDate: string; durationMonths: number; depositAmount: number; estimatedTotalFee: number; status: string; depositDeadline: string; createdAt: string }
interface Ctr { contractId: number; contractNumber: string; customerId: number; unitId: number; startDate: string; endDate: string; monthlyRentFee: number; status: string }
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
    { contractId: 1, contractNumber: 'HD-DEMO-0001', customerId: 4, unitId: unit(1, 'B-01').unitId, startDate: dateOnly(addDays(now, -7)), endDate: dateOnly(addMonths(now, 6)), monthlyRentFee: 1200000, status: 'Active' },
    { contractId: 2, contractNumber: 'HD-DEMO-0002', customerId: 4, unitId: unit(1, 'A-02').unitId, startDate: dateOnly(addMonths(now, -2)), endDate: dateOnly(addMonths(now, 1)), monthlyRentFee: 300000, status: 'Active' },
    { contractId: 3, contractNumber: 'HD-DEMO-0003', customerId: 5, unitId: unit(1, 'C-01').unitId, startDate: dateOnly(addMonths(now, -3)), endDate: dateOnly(addMonths(now, 9)), monthlyRentFee: 2400000, status: 'Active' },
    { contractId: 4, contractNumber: 'HD-DEMO-0004', customerId: 6, unitId: unit(1, 'C-02').unitId, startDate: dateOnly(addMonths(now, -4)), endDate: dateOnly(addMonths(now, 2)), monthlyRentFee: 2400000, status: 'Overdue' },
    { contractId: 5, contractNumber: 'HD-DEMO-0005', customerId: 7, unitId: unit(1, 'D-01').unitId, startDate: dateOnly(addMonths(now, -1)), endDate: dateOnly(addMonths(now, 11)), monthlyRentFee: 4800000, status: 'Active' },
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
      monthlyRentFee: unit.monthlyPrice, status: 'Active',
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
