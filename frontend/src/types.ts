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
  role === Roles.Manager ? '/facility' : GATE_ROLES.includes(role) ? '/gate' : role === Roles.Customer ? '/my-units' : role === Roles.Admin ? '/admin/users' : role === Roles.OpsManager ? '/ops/facilities' : '/'

export const RoleLabels: Record<string, string> = {
  [Roles.Customer]: 'Khách hàng',
  [Roles.Staff]: 'Nhân viên cơ sở',
  [Roles.Manager]: 'Quản lý cơ sở',
  [Roles.OpsManager]: 'Quản lý vận hành',
  [Roles.Admin]: 'Quản trị hệ thống',
}
export const roleLabel = (role: string) => RoleLabels[role] ?? role

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

/** An account as the system administrator sees it (GET /api/admin/users). */
export interface AdminUser {
  userId: number
  username: string
  fullName: string
  email: string
  phoneNumber: string
  citizenId: string | null
  /** Active | Inactive | Suspended */
  status: string
  roleId: number
  roleName: string
}

export interface RoleInfo {
  roleId: number
  roleName: string
  description: string | null
}

export interface ActivityLog {
  logId: number
  action: string
  details: string | null
  ipAddress: string | null
  createdAt: string
}

/** One facility in the operations report (GET /api/operations/reports/facilities). */
export interface FacilityReport {
  facilityId: number
  facilityName: string
  fromDate: string
  toDate: string
  totalUnits: number
  availableUnits: number
  rentedUnits: number
  maintenanceUnits: number
  overdueLockedUnits: number
  activeContracts: number
  overdueContracts: number
  openSupportRequests: number
  /** Payments received minus refunds between fromDate and toDate (last 30 days by default). */
  netRevenue: number
}

export interface OperationsReport {
  fromDate: string
  toDate: string
  facilityCount: number
  totalUnits: number
  availableUnits: number
  rentedUnits: number
  maintenanceUnits: number
  overdueLockedUnits: number
  activeContracts: number
  overdueContracts: number
  openSupportRequests: number
  netRevenue: number
  facilities: FacilityReport[]
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
  /** Pick-up time the customer booked (ISO-8601 with offset); staff can hand over only from this time. */
  checkInAppointmentAt?: string | null
  durationMonths: number
  depositAmount: number
  estimatedTotalFee: number
  status: string
  depositDeadline: string
  customerName: string
  /** Promotion code applied when booking, and the discount it gave (taken off the first month). */
  promoCode?: string | null
  promotionDiscountAmount?: number
  depositInvoiceId?: number | null
}

/** Customer asks to cancel a reservation not yet handed over; staff approve (refund deposit minus the cancellation fee) or reject. */
export interface CancellationRequest {
  cancellationRequestId: number
  reservationId: number
  reservationCode: string
  customerName: string
  reason: string
  /** Pending | Approved | Rejected */
  status: string
  requestedAt: string
  resolvedAt: string | null
  resolutionNotes: string | null
  approvedRefundAmount: number | null
}

export interface CancellationRefund {
  reservationId: number
  refundedAmount: number
  remainingRefund: number
  paymentMethod: string
  transactionCode: string | null
  refundedAt: string
}

export const CancellationStatuses: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }> = {
  Pending: { label: 'Chờ duyệt hủy', tone: 'warn' },
  Approved: { label: 'Đã duyệt hủy', tone: 'ok' },
  Rejected: { label: 'Từ chối hủy', tone: 'muted' },
}

// ---- facility manager (FacilityOperationsController, FacilityManagementController)

/** Work for one day at a facility (GET /api/facilities/{id}/daily-operations). */
export interface FacilityWorkQueue {
  date: string
  checkIns: Reservation[]
  returns: FacilityTaskContract[]
  supportRequests: SupportRequest[]
}

export interface FacilityTaskContract {
  contractId: number
  contractNumber: string
  customerName: string
  unitCode: string
  endDate: string
  status: string
  depositPaid: number
  accumulatedLateFee: number
}

/** Facility KPIs over a date range (GET /api/facilities/{id}/dashboard), manager only. */
export type FacilityDashboard = FacilityReport

export interface FacilityStaff {
  userId: number
  username: string
  fullName: string
  email: string
  status: string
  assignedDate: string
}

export interface ExtraChargeInvoice {
  invoiceId: number
  invoiceNumber: string
  invoiceType: string
  totalAmount: number
  dueDate: string
  status: string
  contractId: number
}

/**
 * Fee types a facility can bill as an extra charge. Staff cannot read the fee table (operations manager only),
 * so these are the rows 01_schema.sql inserts, in insert order (FeeTypeID 1..5).
 */
export const ExtraChargeFees = [
  { feeTypeId: 1, feeCode: 'LATE_FEE_DAILY', feeName: 'Phí phạt quá hạn mỗi ngày', defaultAmount: 100000, perDay: true },
  { feeTypeId: 2, feeCode: 'LOST_KEY_FEE', feeName: 'Phí cấp lại chìa khóa cơ', defaultAmount: 150000, perDay: false },
  { feeTypeId: 3, feeCode: 'LOST_CARD_FEE', feeName: 'Phí cấp lại thẻ từ truy cập', defaultAmount: 100000, perDay: false },
  { feeTypeId: 4, feeCode: 'CLEANING_FEE', feeName: 'Phí vệ sinh sau trả kho', defaultAmount: 200000, perDay: false },
  { feeTypeId: 5, feeCode: 'LOCK_REPLACE_FEE', feeName: 'Phí thay mới ổ khóa thông minh', defaultAmount: 500000, perDay: false },
]

export interface Invoice {
  invoiceId: number
  invoiceNumber: string
  contractId: number | null
  reservationId: number | null
  invoiceType: string
  subTotal: number
  discountAmount: number
  totalAmount: number
  dueDate: string
  status: string
  createdAt: string
  /** Monthly rent invoices only: the month this invoice bills. */
  billingPeriodStart?: string | null
  billingPeriodEnd?: string | null
  details: { detailId: number; description: string; quantity: number; unitPrice: number; lineTotal: number }[]
  payments: {
    paymentId: number
    paymentMethod: string
    transactionCode: string | null
    amountPaid: number
    paymentDate: string
    status: string
    paymentNotes: string | null
    receivedByStaff: string | null
  }[]
}

export interface CheckoutResponse {
  provider: string
  paymentId: number
  transactionReference: string
  amount: number
  paymentUrl: string
  /** MoMo only: text to show as a QR code for the MoMo app to scan, and links that open the app. */
  qrCodeUrl?: string | null
  deeplink?: string | null
  deeplinkWebInApp?: string | null
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

export interface ContractDetail {
  contractId: number
  contractNumber: string
  facilityId: number
  facilityName: string
  unitId: number
  unitCode: string
  unitStatus: string
  startDate: string
  endDate: string
  status: string
  monthlyRentFee: number
  depositPaid: number
  accumulatedLateFee: number
  depositBalance: number
  outstandingLateFee: number
  /** Renewal requests open 7 days before the end date. */
  renewalAvailableFrom: string
}

export interface Renewal {
  renewalId: number
  contractId: number
  oldEndDate: string
  newEndDate: string
  extensionMonths: number
  renewalFee: number
  status: string
  requestedAt: string
}

/** A contract in the staff list of one facility. */
export interface StaffContract {
  contractId: number
  contractNumber: string
  customerName: string
  customerPhone: string
  unitId: number
  unitCode: string
  unitStatus: string
  startDate: string
  endDate: string
  monthlyRentFee: number
  depositPaid: number
  status: string
  hasPendingRenewal: boolean
  /** 20:00 on the end date: the unit can be returned from then. */
  returnAppointment: string
}

export interface OverdueSummary {
  overdueId: number
  contractId: number
  contractNumber: string
  customerName: string
  unitCode: string
  endDate: string
  contractStatus: string
  unitStatus: string
  daysOverdue: number
  accumulatedLateFee: number
  depositBalance: number
  outstandingLateFee: number
  lockAppliedAt: string | null
}

export interface ReturnUnitResult {
  contractId: number
  status: string
  unitStatus: string
  depositPaid: number
  lateFeesDeducted: number
  depositRefundDue: number
  lateFeesStillOwed: number
  returnedAt: string
}

export interface SupportRequest {
  requestId: number
  requestCode: string
  contractId: number
  unitCode: string
  category: string
  priority: string
  title: string
  description: string
  status: string
  createdAt: string
  assignedStaffName: string | null
}

export interface SupportUpdate {
  updateId: number
  updatedBy: string
  actionMessage: string
  previousStatus: string | null
  newStatus: string | null
  createdAt: string
}

export interface SupportChecklistItem {
  checklistItemId: number
  sortOrder: number
  description: string
  isCompleted: boolean
  completedAt: string | null
  completedByStaff: string | null
  notes: string | null
}

export const SupportCategories: Record<string, string> = {
  LockIssue: 'Khóa kho bị lỗi',
  AccessCodeIssue: 'Thẻ / mã ra vào',
  DamagedUnit: 'Kho hư hỏng, dột, ẩm',
  PaymentIssue: 'Thanh toán, hóa đơn',
  StoredItemsIssue: 'Đồ đạc trong kho',
  Other: 'Khác',
}

export const SupportPriorities: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }> = {
  Low: { label: 'Thấp', tone: 'muted' },
  Medium: { label: 'Trung bình', tone: 'info' },
  High: { label: 'Cao', tone: 'warn' },
  Urgent: { label: 'Khẩn cấp', tone: 'bad' },
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
  /** Someone on this contract has a staff-approved visit registration covering now. */
  hasApprovedVisitRegistration?: boolean
  canEnter: boolean
}

export interface AccessRecord {
  accessRecordId: number
  visitRegistrationId?: number | null
  unitCode: string
  contractNumber: string
  visitorName: string
  result: 'Granted' | 'Denied'
  denyReason: string | null
  purpose: string | null
  /** People who came in with the visitor, not counting the visitor. */
  companionCount?: number
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
  // renewals
  Pending: { label: 'Chờ thanh toán', tone: 'warn' },
  Approved: { label: 'Đã duyệt', tone: 'info' },
  Paid: { label: 'Đã thanh toán', tone: 'ok' },
  // invoices
  Unpaid: { label: 'Chưa thanh toán', tone: 'warn' },
  Rejected: { label: 'Bị từ chối', tone: 'muted' },
  // support requests
  Open: { label: 'Mới gửi', tone: 'warn' },
  InProgress: { label: 'Đang xử lý', tone: 'info' },
  Resolved: { label: 'Đã xử lý', tone: 'ok' },
  Closed: { label: 'Đã đóng', tone: 'muted' },
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

/** A customer's booked entry/exit window for their unit, approved by facility staff (VisitRegistrationDto). */
export interface VisitRegistration {
  visitRegistrationId: number
  contractId: number
  contractNumber: string
  facilityId: number
  unitCode: string
  /** null = the contract holder comes in person. */
  authorizedPersonId: number | null
  visitorName: string
  scheduledEntryAt: string
  scheduledExitAt: string
  purpose: string
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | string
  requestedAt: string
  reviewedAt: string | null
  reviewNotes: string | null
}

export const VisitPurposes = ['Gửi đồ vào kho', 'Lấy đồ ra', 'Sắp xếp lại đồ', 'Tham quan và kiểm tra kho', 'Khác']

// ---- operations manager: rental policies, fee table, promotions (OperationsManagementController)

export interface RentalPolicy {
  policyId: number
  policyName: string
  /** null = applies to every facility. */
  facilityId: number | null
  depositPercent: number
  cancellationGraceHours: number
  cancellationFeePercent: number
  renewalNoticeDays: number
  maxOverdueDaysBeforeLock: number
  isActive: boolean
  effectiveDate: string
}

export interface FeeConfiguration {
  feeTypeId: number
  feeCode: string
  feeName: string
  defaultAmount: number
  calculationMethod: 'Fixed' | 'DailyRate' | 'Percentage' | string
  description: string | null
}

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

export const FeeMethods: Record<string, string> = { Fixed: 'Cố định', DailyRate: 'Theo ngày', Percentage: 'Theo %' }
