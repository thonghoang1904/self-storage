// Shapes returned by the ASP.NET Core API (see Swagger at /swagger).

export const Roles = {
  Customer: 'Storage Customer',
  Staff: 'Facility Staff',
  Manager: 'Facility Manager',
  OpsManager: 'Business Operations Manager',
  Admin: 'System Administrator',
} as const

/** Roles that work the gate (verify identity, confirm exit). */
export const GATE_ROLES: string[] = [Roles.Staff, Roles.Manager]

export const homeFor = (role: string) =>
  GATE_ROLES.includes(role) ? '/gate' : role === Roles.Customer ? '/my-units' : '/'

export interface UserDto {
  userId: number
  username: string
  fullName: string
  role: string
}

export interface LoginResponse {
  token: string
  expiresAt: string
  user: UserDto
}

export interface Facility {
  facilityId: number
  facilityName: string
  address: string
  city: string
  district: string
  hotline: string
  operatingHours: string
  status: string
}

export interface UnitType {
  unitTypeId: number
  typeName: string
  lengthMeters: number
  widthMeters: number
  heightMeters: number
  volumeCubicMeters: number
  hasClimateControl: boolean
  baseDailyRate: number
  baseMonthlyRate: number
  description: string | null
}

export interface Availability {
  unitTypeId: number
  typeName: string
  baseMonthlyRate: number
  availableUnits: number
}

export interface StorageUnit {
  unitId: number
  unitCode: string
  floorNumber: number
  zoneArea: string | null
  monthlyPrice: number
  status: string
  unitTypeId: number
  unitTypeName: string
}

export interface Reservation {
  reservationId: number
  reservationCode: string
  facilityName: string
  unitTypeName: string
  assignedUnitCode: string | null
  expectedStartDate: string
  durationMonths: number
  depositAmount: number
  estimatedTotalFee: number
  status: string
  depositDeadline: string
  customerName: string
}

export interface Contract {
  contractId: number
  contractNumber: string
  facilityId: number
  facilityName: string
  unitCode: string
  startDate: string
  endDate: string
  monthlyRentFee: number
  status: string
}

export interface Person {
  authorizedPersonId: number | null
  fullName: string
  citizenId: string | null
  phoneNumber: string | null
  relationship: string | null
}

export interface AccessIssue {
  code: string
  message: string
}

/** A contract the visitor may be coming for, found by the staff lookup at the gate. */
export interface VisitCandidate {
  contractId: number
  contractNumber: string
  contractStatus: string
  startDate: string
  endDate: string
  unitCode: string
  unitStatus: string
  customer: Person
  authorizedPersons: Person[]
  peopleInside: string[]
  issues: AccessIssue[]
  canEnter: boolean
}

export interface AccessRecord {
  accessRecordId: number
  unitCode: string
  contractNumber: string
  visitorName: string
  result: 'Granted' | 'Denied'
  denyReason: string | null
  purpose: string | null
  entryTime: string
  exitTime: string | null
  verifiedBy: string
}

/** Vietnamese labels and badge tone for the status codes the API returns. */
export const StatusLabels: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }> = {
  // contracts
  Active: { label: 'Đang sử dụng', tone: 'ok' },
  Renewed: { label: 'Đã gia hạn', tone: 'ok' },
  Terminated: { label: 'Đã chấm dứt', tone: 'muted' },
  Overdue: { label: 'Quá hạn', tone: 'bad' },
  Liquidated: { label: 'Đã thanh lý', tone: 'muted' },
  // reservations
  PendingDeposit: { label: 'Chờ đặt cọc', tone: 'warn' },
  Confirmed: { label: 'Đã nhận cọc', tone: 'info' },
  CheckedIn: { label: 'Đã bàn giao', tone: 'ok' },
  Cancelled: { label: 'Đã hủy', tone: 'muted' },
  Expired: { label: 'Hết hạn cọc', tone: 'muted' },
  // units
  Available: { label: 'Còn trống', tone: 'ok' },
  Reserved: { label: 'Đã giữ chỗ', tone: 'info' },
  Rented: { label: 'Đang cho thuê', tone: 'info' },
  UnderMaintenance: { label: 'Đang bảo trì', tone: 'warn' },
  OverdueLocked: { label: 'Khóa do quá hạn', tone: 'bad' },
}

export const statusOf = (code: string) => StatusLabels[code] ?? { label: code, tone: 'muted' as const }

export const DenyReasons: Record<string, string> = {
  IdentityMismatch: 'CCCD không khớp',
  NotAuthorized: 'Không có quyền vào kho',
  ContractEnded: 'Hợp đồng đã kết thúc',
  OverdueLocked: 'Quá hạn thanh toán',
  OutsideOperatingHours: 'Ngoài giờ hoạt động',
  UnitUnderMaintenance: 'Kho đang bảo trì',
  Other: 'Lý do khác',
}
