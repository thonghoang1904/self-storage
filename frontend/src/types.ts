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
  hasPin: boolean
  pinLockedUntil: string | null
}

export interface Person {
  authorizedPersonId: number | null
  fullName: string
  citizenId: string | null
  phoneNumber: string | null
  relationship: string | null
}

export interface PendingAccess {
  requestId: number
  pinEnteredAt: string
  unitCode: string
  contractNumber: string
  contractEndDate: string
  customer: Person
  authorizedPersons: Person[]
}

export interface AccessRecord {
  requestId: number
  unitCode: string
  contractNumber: string
  visitorName: string
  result: 'Pending' | 'Granted' | 'Denied'
  denyReason: string | null
  purpose: string | null
  pinEnteredAt: string | null
  entryTime: string
  exitTime: string | null
  verifiedBy: string | null
}

export interface KioskStatus {
  requestId: number
  unitCode: string
  status: 'Pending' | 'Granted' | 'Denied'
  message: string
}

export const DenyReasons: Record<string, string> = {
  IdentityMismatch: 'Giấy tờ không khớp',
  NotAuthorized: 'Không có quyền vào kho',
  ContractEnded: 'Hợp đồng đã kết thúc',
  OverdueLocked: 'Quá hạn thanh toán',
  OutsideOperatingHours: 'Ngoài giờ hoạt động',
  UnitUnderMaintenance: 'Kho đang bảo trì',
  Other: 'Lý do khác',
}
