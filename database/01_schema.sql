-- =========================================================================
-- SYSTEM: SELF-STORAGE FACILITY RENTAL AND MANAGEMENT SYSTEM
-- SCRIPT: Complete Database Schema (DDL) for Microsoft SQL Server
-- =========================================================================

USE master;
GO

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'SelfStorageDB')
BEGIN
    CREATE DATABASE SelfStorageDB COLLATE Vietnamese_CI_AS;
END
GO

USE SelfStorageDB;
GO

-- =========================================================================
-- DROP EXISTING TABLES (Reverse Dependency Order)
-- =========================================================================
DROP TABLE IF EXISTS AccessRecords;
DROP TABLE IF EXISTS AuthorizedPersons;
DROP TABLE IF EXISTS SupportUpdates;
DROP TABLE IF EXISTS SupportRequests;
DROP TABLE IF EXISTS MaintenanceRecords;
DROP TABLE IF EXISTS Payments;
DROP TABLE IF EXISTS InvoiceDetails;
DROP TABLE IF EXISTS Invoices;
DROP TABLE IF EXISTS OverdueRecords;
DROP TABLE IF EXISTS ContractRenewals;
DROP TABLE IF EXISTS HandoverRecords;
DROP TABLE IF EXISTS Contracts;
DROP TABLE IF EXISTS Reservations;
DROP TABLE IF EXISTS StorageUnits;
DROP TABLE IF EXISTS UnitTypes;
DROP TABLE IF EXISTS FacilityStaffAssignments;
DROP TABLE IF EXISTS ActivityLogs;
DROP TABLE IF EXISTS Promotions;
DROP TABLE IF EXISTS FeeConfigurations;
DROP TABLE IF EXISTS RentalPolicies;
DROP TABLE IF EXISTS Facilities;
DROP TABLE IF EXISTS Users;
DROP TABLE IF EXISTS Roles;
GO

-- =========================================================================
-- 1. USERS & ACCESS CONTROL TABLES
-- =========================================================================

CREATE TABLE Roles (
    RoleID INT IDENTITY(1,1) CONSTRAINT PK_Roles PRIMARY KEY,
    RoleName NVARCHAR(50) NOT NULL CONSTRAINT UQ_Roles_RoleName UNIQUE,
    Description NVARCHAR(255) NULL
);
GO

CREATE TABLE Users (
    UserID INT IDENTITY(1,1) CONSTRAINT PK_Users PRIMARY KEY,
    RoleID INT NOT NULL,
    Username VARCHAR(50) NOT NULL CONSTRAINT UQ_Users_Username UNIQUE,
    PasswordHash VARCHAR(255) NOT NULL,
    GoogleSubject VARCHAR(255) NULL,
    FullName NVARCHAR(100) NOT NULL,
    Email VARCHAR(100) NOT NULL CONSTRAINT UQ_Users_Email UNIQUE,
    PhoneNumber VARCHAR(20) NOT NULL,
    CitizenID VARCHAR(25) NULL CONSTRAINT UQ_Users_CitizenID UNIQUE,
    Address NVARCHAR(255) NULL,
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_Users_Status DEFAULT 'Active',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_Users_Roles FOREIGN KEY (RoleID) REFERENCES Roles(RoleID),
    CONSTRAINT CK_Users_Status CHECK (Status IN ('Active', 'Inactive', 'Suspended'))
);
GO

CREATE UNIQUE INDEX UX_Users_GoogleSubject
    ON Users(GoogleSubject)
    WHERE GoogleSubject IS NOT NULL;
GO

CREATE TABLE ActivityLogs (
    LogID BIGINT IDENTITY(1,1) CONSTRAINT PK_ActivityLogs PRIMARY KEY,
    UserID INT NULL,
    Action NVARCHAR(100) NOT NULL,
    IPAddress VARCHAR(45) NULL,
    Details NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ActivityLogs_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_ActivityLogs_Users FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE SET NULL
);
GO

-- =========================================================================
-- 2. FACILITIES & STORAGE UNITS
-- =========================================================================

CREATE TABLE Facilities (
    FacilityID INT IDENTITY(1,1) CONSTRAINT PK_Facilities PRIMARY KEY,
    FacilityName NVARCHAR(150) NOT NULL,
    Address NVARCHAR(255) NOT NULL,
    City NVARCHAR(100) NOT NULL,
    District NVARCHAR(100) NOT NULL,
    Hotline VARCHAR(20) NOT NULL,
    OperatingHours NVARCHAR(100) NOT NULL CONSTRAINT DF_Facilities_OperatingHours DEFAULT N'24/7 Access',
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_Facilities_Status DEFAULT 'Active',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Facilities_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT CK_Facilities_Status CHECK (Status IN ('Active', 'Maintenance', 'Closed'))
);
GO

CREATE TABLE FacilityStaffAssignments (
    AssignmentID INT IDENTITY(1,1) CONSTRAINT PK_FacilityStaffAssignments PRIMARY KEY,
    FacilityID INT NOT NULL,
    StaffID INT NOT NULL,
    AssignedDate DATE NOT NULL CONSTRAINT DF_StaffAssign_Date DEFAULT CAST(SYSDATETIME() AS DATE),
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_StaffAssign_Status DEFAULT 'Active',
    CONSTRAINT FK_StaffAssign_Facilities FOREIGN KEY (FacilityID) REFERENCES Facilities(FacilityID),
    CONSTRAINT FK_StaffAssign_Users FOREIGN KEY (StaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_StaffAssign_Status CHECK (Status IN ('Active', 'Transferred', 'Ended')),
    CONSTRAINT UQ_Staff_Facility UNIQUE (FacilityID, StaffID)
);
GO

CREATE TABLE UnitTypes (
    UnitTypeID INT IDENTITY(1,1) CONSTRAINT PK_UnitTypes PRIMARY KEY,
    TypeName NVARCHAR(100) NOT NULL,
    LengthMeters DECIMAL(5,2) NOT NULL,
    WidthMeters DECIMAL(5,2) NOT NULL,
    HeightMeters DECIMAL(5,2) NOT NULL,
    VolumeCubicMeters AS (LengthMeters * WidthMeters * HeightMeters) PERSISTED,
    HasClimateControl BIT NOT NULL CONSTRAINT DF_UnitTypes_Climate DEFAULT 0,
    BaseDailyRate DECIMAL(18,2) NOT NULL CONSTRAINT CK_UnitTypes_DailyRate CHECK (BaseDailyRate >= 0),
    BaseMonthlyRate DECIMAL(18,2) NOT NULL CONSTRAINT CK_UnitTypes_MonthlyRate CHECK (BaseMonthlyRate >= 0),
    Description NVARCHAR(500) NULL
);
GO

CREATE TABLE StorageUnits (
    UnitID INT IDENTITY(1,1) CONSTRAINT PK_StorageUnits PRIMARY KEY,
    FacilityID INT NOT NULL,
    UnitTypeID INT NOT NULL,
    UnitCode VARCHAR(30) NOT NULL,
    FloorNumber INT NOT NULL CONSTRAINT DF_StorageUnits_Floor DEFAULT 1,
    ZoneArea VARCHAR(30) NULL,
    MonthlyPrice DECIMAL(18,2) NOT NULL CONSTRAINT CK_StorageUnits_MonthlyPrice CHECK (MonthlyPrice >= 0),
    SmartLockCode VARCHAR(100) NULL,
    Status VARCHAR(30) NOT NULL CONSTRAINT DF_StorageUnits_Status DEFAULT 'Available',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_StorageUnits_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_StorageUnits_Facilities FOREIGN KEY (FacilityID) REFERENCES Facilities(FacilityID),
    CONSTRAINT FK_StorageUnits_UnitTypes FOREIGN KEY (UnitTypeID) REFERENCES UnitTypes(UnitTypeID),
    CONSTRAINT UQ_Facility_UnitCode UNIQUE (FacilityID, UnitCode),
    CONSTRAINT CK_StorageUnits_Status CHECK (Status IN ('Available', 'Reserved', 'Rented', 'UnderMaintenance', 'OverdueLocked'))
);
GO

-- =========================================================================
-- 3. BUSINESS POLICIES & FEE STRUCTURE
-- =========================================================================

CREATE TABLE RentalPolicies (
    PolicyID INT IDENTITY(1,1) CONSTRAINT PK_RentalPolicies PRIMARY KEY,
    PolicyName NVARCHAR(100) NOT NULL,
    FacilityID INT NULL,
    DepositPercent DECIMAL(5,2) NOT NULL CONSTRAINT DF_RentalPolicies_Deposit DEFAULT 100.00,
    CancellationGraceHours INT NOT NULL CONSTRAINT DF_RentalPolicies_GraceHours DEFAULT 24,
    CancellationFeePercent DECIMAL(5,2) NOT NULL CONSTRAINT DF_RentalPolicies_CancelFee DEFAULT 10.00,
    RenewalNoticeDays INT NOT NULL CONSTRAINT DF_RentalPolicies_Notice DEFAULT 7,
    MaxOverdueDaysBeforeLock INT NOT NULL CONSTRAINT DF_RentalPolicies_LockDays DEFAULT 3,
    IsActive BIT NOT NULL CONSTRAINT DF_RentalPolicies_IsActive DEFAULT 1,
    EffectiveDate DATE NOT NULL,
    DepositPaymentHours INT NOT NULL CONSTRAINT DF_RentalPolicies_DepositHours DEFAULT 24,
    CONSTRAINT FK_RentalPolicies_Facilities FOREIGN KEY (FacilityID) REFERENCES Facilities(FacilityID),
    CONSTRAINT CK_RentalPolicies_DepositHours CHECK (DepositPaymentHours > 0)
);
GO

CREATE TABLE FeeConfigurations (
    FeeTypeID INT IDENTITY(1,1) CONSTRAINT PK_FeeConfigurations PRIMARY KEY,
    FeeCode VARCHAR(50) NOT NULL CONSTRAINT UQ_FeeConfig_FeeCode UNIQUE,
    FeeName NVARCHAR(100) NOT NULL,
    DefaultAmount DECIMAL(18,2) NOT NULL CONSTRAINT CK_FeeConfig_Amount CHECK (DefaultAmount >= 0),
    CalculationMethod VARCHAR(20) NOT NULL CONSTRAINT DF_FeeConfig_Calc DEFAULT 'Fixed',
    Description NVARCHAR(255) NULL,
    CONSTRAINT CK_FeeConfig_Calc CHECK (CalculationMethod IN ('Fixed', 'DailyRate', 'Percentage'))
);
GO

CREATE TABLE Promotions (
    PromotionID INT IDENTITY(1,1) CONSTRAINT PK_Promotions PRIMARY KEY,
    PromoCode VARCHAR(30) NOT NULL CONSTRAINT UQ_Promotions_Code UNIQUE,
    Title NVARCHAR(150) NOT NULL,
    DiscountPercent DECIMAL(5,2) NOT NULL CONSTRAINT CK_Promotions_Percent CHECK (DiscountPercent BETWEEN 0 AND 100),
    MaxDiscountAmount DECIMAL(18,2) NULL,
    MinRentalMonths INT NOT NULL CONSTRAINT DF_Promotions_MinMonths DEFAULT 1,
    StartDate DATE NOT NULL,
    EndDate DATE NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Promotions_Active DEFAULT 1,
    CONSTRAINT CK_Promotions_Dates CHECK (EndDate >= StartDate)
);
GO

-- =========================================================================
-- 4. RESERVATIONS, CONTRACTS & HANDOVERS
-- =========================================================================

CREATE TABLE Reservations (
    ReservationID INT IDENTITY(1,1) CONSTRAINT PK_Reservations PRIMARY KEY,
    ReservationCode VARCHAR(30) NOT NULL CONSTRAINT UQ_Reservations_Code UNIQUE,
    CustomerID INT NOT NULL,
    FacilityID INT NOT NULL,
    UnitTypeID INT NOT NULL,
    AssignedUnitID INT NULL,
    PromotionID INT NULL,
    PromotionDiscountAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_Reservations_PromotionDiscount DEFAULT 0,
    ExpectedStartDate DATE NOT NULL,
    CheckInAppointmentAt DATETIMEOFFSET NULL,
    DurationMonths INT NOT NULL CONSTRAINT CK_Reservations_Duration CHECK (DurationMonths > 0),
    DepositAmount DECIMAL(18,2) NOT NULL CONSTRAINT CK_Reservations_Deposit CHECK (DepositAmount >= 0),
    EstimatedTotalFee DECIMAL(18,2) NOT NULL,
    Status VARCHAR(25) NOT NULL CONSTRAINT DF_Reservations_Status DEFAULT 'PendingDeposit',
    DepositDeadline DATETIME2 NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Reservations_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Reservations_Customers FOREIGN KEY (CustomerID) REFERENCES Users(UserID),
    CONSTRAINT FK_Reservations_Facilities FOREIGN KEY (FacilityID) REFERENCES Facilities(FacilityID),
    CONSTRAINT FK_Reservations_UnitTypes FOREIGN KEY (UnitTypeID) REFERENCES UnitTypes(UnitTypeID),
    CONSTRAINT FK_Reservations_StorageUnits FOREIGN KEY (AssignedUnitID) REFERENCES StorageUnits(UnitID),
    CONSTRAINT FK_Reservations_Promotions FOREIGN KEY (PromotionID) REFERENCES Promotions(PromotionID),
    CONSTRAINT CK_Reservations_PromotionDiscount CHECK (PromotionDiscountAmount >= 0),
    CONSTRAINT CK_Reservations_Status CHECK (Status IN ('PendingDeposit', 'Confirmed', 'CheckedIn', 'Cancelled', 'Expired'))
);
GO

CREATE TABLE ReservationCancellationRequests (
    CancellationRequestID INT IDENTITY(1,1) CONSTRAINT PK_ReservationCancellationRequests PRIMARY KEY,
    ReservationID INT NOT NULL,
    CustomerID INT NOT NULL,
    Reason NVARCHAR(1000) NOT NULL,
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_CancellationRequests_Status DEFAULT 'Pending',
    RequestedAt DATETIME2 NOT NULL CONSTRAINT DF_CancellationRequests_RequestedAt DEFAULT SYSDATETIME(),
    ResolvedByStaffID INT NULL,
    ResolvedAt DATETIME2 NULL,
    ResolutionNotes NVARCHAR(1000) NULL,
    ApprovedRefundAmount DECIMAL(18,2) NULL,
    CONSTRAINT FK_CancellationRequests_Reservations FOREIGN KEY (ReservationID) REFERENCES Reservations(ReservationID),
    CONSTRAINT FK_CancellationRequests_Customers FOREIGN KEY (CustomerID) REFERENCES Users(UserID),
    CONSTRAINT FK_CancellationRequests_Staff FOREIGN KEY (ResolvedByStaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_CancellationRequests_Status CHECK (Status IN ('Pending', 'Approved', 'Rejected')),
    CONSTRAINT CK_CancellationRequests_Refund CHECK (ApprovedRefundAmount IS NULL OR ApprovedRefundAmount >= 0)
);
CREATE UNIQUE INDEX UX_CancellationRequests_Reservation_Pending
    ON ReservationCancellationRequests(ReservationID) WHERE Status = 'Pending';
GO

CREATE TABLE Contracts (
    ContractID INT IDENTITY(1,1) CONSTRAINT PK_Contracts PRIMARY KEY,
    ContractNumber VARCHAR(30) NOT NULL CONSTRAINT UQ_Contracts_Number UNIQUE,
    ReservationID INT NULL CONSTRAINT UQ_Contracts_Reservation UNIQUE,
    CustomerID INT NOT NULL,
    UnitID INT NOT NULL,
    StaffCreatedID INT NOT NULL,
    PromotionID INT NULL,
    StartDate DATE NOT NULL,
    EndDate DATE NOT NULL,
    MonthlyRentFee DECIMAL(18,2) NOT NULL CONSTRAINT CK_Contracts_MonthlyRent CHECK (MonthlyRentFee >= 0),
    DepositPaid DECIMAL(18,2) NOT NULL CONSTRAINT CK_Contracts_Deposit CHECK (DepositPaid >= 0),
    Status VARCHAR(25) NOT NULL CONSTRAINT DF_Contracts_Status DEFAULT 'Active',
    SignedDate DATETIME2 NOT NULL CONSTRAINT DF_Contracts_SignedDate DEFAULT SYSDATETIME(),
    TermsConditions NVARCHAR(MAX) NULL,
    PrepaidRentCredit DECIMAL(18,2) NOT NULL CONSTRAINT DF_Contracts_PrepaidRentCredit DEFAULT 0
        CONSTRAINT CK_Contracts_PrepaidRentCredit CHECK (PrepaidRentCredit >= 0),
    CONSTRAINT FK_Contracts_Reservations FOREIGN KEY (ReservationID) REFERENCES Reservations(ReservationID),
    CONSTRAINT FK_Contracts_Customers FOREIGN KEY (CustomerID) REFERENCES Users(UserID),
    CONSTRAINT FK_Contracts_StorageUnits FOREIGN KEY (UnitID) REFERENCES StorageUnits(UnitID),
    CONSTRAINT FK_Contracts_Staff FOREIGN KEY (StaffCreatedID) REFERENCES Users(UserID),
    CONSTRAINT FK_Contracts_Promotions FOREIGN KEY (PromotionID) REFERENCES Promotions(PromotionID),
    CONSTRAINT CK_Contracts_Dates CHECK (EndDate > StartDate),
    CONSTRAINT CK_Contracts_Status CHECK (Status IN ('Active', 'Renewed', 'Terminated', 'Overdue', 'Liquidated'))
);
CREATE UNIQUE INDEX UX_Contracts_Customer_FirstPromotion
    ON Contracts(CustomerID) WHERE PromotionID IS NOT NULL;
GO

CREATE TABLE HandoverRecords (
    HandoverID INT IDENTITY(1,1) CONSTRAINT PK_HandoverRecords PRIMARY KEY,
    ContractID INT NOT NULL,
    StaffID INT NOT NULL,
    HandoverType VARCHAR(20) NOT NULL,
    HandoverDateTime DATETIME2 NOT NULL CONSTRAINT DF_Handover_Time DEFAULT SYSDATETIME(),
    PhysicalKeyCount INT NOT NULL CONSTRAINT DF_Handover_Keys DEFAULT 1,
    AccessCardCode VARCHAR(50) NULL,
    PasscodeActivated VARCHAR(50) NULL,
    UnitConditionNotes NVARCHAR(1000) NOT NULL,
    CustomerSignatureConfirmed BIT NOT NULL CONSTRAINT DF_Handover_CustomerSign DEFAULT 1,
    StaffNotes NVARCHAR(500) NULL,
    CONSTRAINT FK_Handover_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
    CONSTRAINT FK_Handover_Staff FOREIGN KEY (StaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_Handover_Type CHECK (HandoverType IN ('CHECK_IN', 'CHECK_OUT'))
);
GO

CREATE TABLE ContractRenewals (
    RenewalID INT IDENTITY(1,1) CONSTRAINT PK_ContractRenewals PRIMARY KEY,
    ContractID INT NOT NULL,
    ApprovedByStaffID INT NULL,
    OldEndDate DATE NOT NULL,
    NewEndDate DATE NOT NULL,
    ExtensionMonths INT NOT NULL CONSTRAINT CK_Renewals_Months CHECK (ExtensionMonths > 0),
    RenewalFee DECIMAL(18,2) NOT NULL CONSTRAINT CK_Renewals_Fee CHECK (RenewalFee >= 0),
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_Renewals_Status DEFAULT 'Pending',
    RequestedAt DATETIME2 NOT NULL CONSTRAINT DF_Renewals_ReqAt DEFAULT SYSDATETIME(),
    ProcessedAt DATETIME2 NULL,
    CONSTRAINT FK_Renewals_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
    CONSTRAINT FK_Renewals_Staff FOREIGN KEY (ApprovedByStaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_Renewals_Dates CHECK (NewEndDate > OldEndDate),
    CONSTRAINT CK_Renewals_Status CHECK (Status IN ('Pending', 'Approved', 'Paid', 'Rejected'))
);
GO

CREATE TABLE OverdueRecords (
    OverdueID INT IDENTITY(1,1) CONSTRAINT PK_OverdueRecords PRIMARY KEY,
    ContractID INT NOT NULL,
    HandledByStaffID INT NULL,
    DaysOverdue INT NOT NULL CONSTRAINT CK_Overdue_Days CHECK (DaysOverdue >= 0),
    AccumulatedLateFee DECIMAL(18,2) NOT NULL CONSTRAINT DF_Overdue_Fee DEFAULT 0.00,
    LockAppliedDate DATETIME2 NULL,
    NoticeSentDate DATETIME2 NULL,
    ActionTaken VARCHAR(30) NOT NULL CONSTRAINT DF_Overdue_Action DEFAULT 'NoticeSent',
    ResolvedDate DATETIME2 NULL,
    Notes NVARCHAR(1000) NULL,
    CONSTRAINT FK_Overdue_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
    CONSTRAINT FK_Overdue_Staff FOREIGN KEY (HandledByStaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_Overdue_Action CHECK (ActionTaken IN ('NoticeSent', 'UnitLocked', 'AuctionWarning', 'Liquidated', 'Resolved'))
);
GO

-- =========================================================================
-- 5. UNIT ACCESS CONTROL (CUSTOMER ENTRY / EXIT, VERIFIED BY STAFF)
-- =========================================================================

-- People the customer allows to enter the unit on his/her behalf
CREATE TABLE AuthorizedPersons (
    AuthorizedPersonID INT IDENTITY(1,1) CONSTRAINT PK_AuthorizedPersons PRIMARY KEY,
    ContractID INT NOT NULL,
    FullName NVARCHAR(100) NOT NULL,
    PhoneNumber VARCHAR(20) NOT NULL,
    CitizenID VARCHAR(25) NOT NULL,          -- staff checks this ID at the facility
    Relationship NVARCHAR(50) NULL,
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_AuthPersons_Status DEFAULT 'Active',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AuthPersons_CreatedAt DEFAULT SYSDATETIME(),
    RevokedAt DATETIME2 NULL,
    CONSTRAINT FK_AuthPersons_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
    CONSTRAINT CK_AuthPersons_Status CHECK (Status IN ('Active', 'Revoked')),
    CONSTRAINT UQ_AuthPersons_Contract_Citizen UNIQUE (ContractID, CitizenID)
);
GO

-- One row per visit: the customer (or an authorized person) comes to the facility,
-- staff verifies identity + contract, then grants or denies entry and later confirms exit.
CREATE TABLE AccessRecords (
    AccessRecordID BIGINT IDENTITY(1,1) CONSTRAINT PK_AccessRecords PRIMARY KEY,
    ContractID INT NOT NULL,
    FacilityID INT NOT NULL,
    UnitID INT NOT NULL,
    AuthorizedPersonID INT NULL,             -- NULL = the contract's customer in person
    VerifiedByStaffID INT NOT NULL,          -- staff who verified the visitor
    VerificationMethod VARCHAR(20) NOT NULL CONSTRAINT DF_AccessRec_Method DEFAULT 'CitizenID',
    Result VARCHAR(10) NOT NULL,
    DenyReason VARCHAR(30) NULL,
    Purpose NVARCHAR(255) NULL,              -- e.g. store items, take items out, inspect
    EntryTime DATETIME2 NOT NULL CONSTRAINT DF_AccessRec_Entry DEFAULT SYSDATETIME(),
    ExitTime DATETIME2 NULL,                 -- NULL = visitor is still inside
    ExitConfirmedByStaffID INT NULL,
    Notes NVARCHAR(500) NULL,
    CONSTRAINT FK_AccessRec_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
    CONSTRAINT FK_AccessRec_Facilities FOREIGN KEY (FacilityID) REFERENCES Facilities(FacilityID),
    CONSTRAINT FK_AccessRec_StorageUnits FOREIGN KEY (UnitID) REFERENCES StorageUnits(UnitID),
    CONSTRAINT FK_AccessRec_AuthPersons FOREIGN KEY (AuthorizedPersonID) REFERENCES AuthorizedPersons(AuthorizedPersonID),
    CONSTRAINT FK_AccessRec_VerifyStaff FOREIGN KEY (VerifiedByStaffID) REFERENCES Users(UserID),
    CONSTRAINT FK_AccessRec_ExitStaff FOREIGN KEY (ExitConfirmedByStaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_AccessRec_Method CHECK (VerificationMethod IN ('CitizenID', 'Passport', 'DriverLicense')),
    CONSTRAINT CK_AccessRec_Result CHECK (Result IN ('Granted', 'Denied')),
    CONSTRAINT CK_AccessRec_DenyReason CHECK (
        (Result = 'Granted' AND DenyReason IS NULL) OR
        (Result = 'Denied' AND ExitTime IS NULL AND DenyReason IN ('IdentityMismatch', 'NotAuthorized',
            'ContractEnded', 'OverdueLocked', 'OutsideOperatingHours', 'UnitUnderMaintenance', 'Other'))),
    CONSTRAINT CK_AccessRec_Exit CHECK (
        (ExitTime IS NULL AND ExitConfirmedByStaffID IS NULL) OR
        (ExitTime >= EntryTime AND ExitConfirmedByStaffID IS NOT NULL))
);
GO

-- =========================================================================
-- 6. BILLING & PAYMENTS
-- =========================================================================

CREATE TABLE Invoices (
    InvoiceID INT IDENTITY(1,1) CONSTRAINT PK_Invoices PRIMARY KEY,
    InvoiceNumber VARCHAR(35) NOT NULL CONSTRAINT UQ_Invoices_Number UNIQUE,
    ContractID INT NULL,
    CustomerID INT NOT NULL,
    InvoiceType VARCHAR(30) NOT NULL,
    SubTotal DECIMAL(18,2) NOT NULL CONSTRAINT CK_Invoices_SubTotal CHECK (SubTotal >= 0),
    DiscountAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_Invoices_Discount DEFAULT 0.00,
    TotalAmount AS (SubTotal - DiscountAmount) PERSISTED,
    DueDate DATE NOT NULL,
    BillingPeriodStart DATE NULL,
    BillingPeriodEnd DATE NULL,
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_Invoices_Status DEFAULT 'Unpaid',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Invoices_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Invoices_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
    CONSTRAINT FK_Invoices_Customers FOREIGN KEY (CustomerID) REFERENCES Users(UserID),
    CONSTRAINT CK_Invoices_Type CHECK (InvoiceType IN ('DEPOSIT', 'MONTHLY_RENT', 'RENEWAL', 'OVERDUE_FINE', 'EXTRA_CHARGE')),
    CONSTRAINT CK_Invoices_Status CHECK (Status IN ('Unpaid', 'Paid', 'Overdue', 'Cancelled'))
);
GO

CREATE UNIQUE INDEX UX_Invoices_MonthlyRentPeriod
    ON Invoices(ContractID, BillingPeriodStart)
    WHERE InvoiceType = 'MONTHLY_RENT' AND ContractID IS NOT NULL AND BillingPeriodStart IS NOT NULL;
GO

CREATE TABLE InvoiceDetails (
    DetailID INT IDENTITY(1,1) CONSTRAINT PK_InvoiceDetails PRIMARY KEY,
    InvoiceID INT NOT NULL,
    FeeTypeID INT NULL,
    Description NVARCHAR(255) NOT NULL,
    Quantity INT NOT NULL CONSTRAINT DF_InvDetail_Qty DEFAULT 1,
    UnitPrice DECIMAL(18,2) NOT NULL CONSTRAINT CK_InvDetail_UnitPrice CHECK (UnitPrice >= 0),
    LineTotal AS (Quantity * UnitPrice) PERSISTED,
    CONSTRAINT FK_InvDetail_Invoices FOREIGN KEY (InvoiceID) REFERENCES Invoices(InvoiceID) ON DELETE CASCADE,
    CONSTRAINT FK_InvDetail_FeeTypes FOREIGN KEY (FeeTypeID) REFERENCES FeeConfigurations(FeeTypeID)
);
GO

CREATE TABLE Payments (
    PaymentID INT IDENTITY(1,1) CONSTRAINT PK_Payments PRIMARY KEY,
    InvoiceID INT NOT NULL,
    ReceivedByStaffID INT NULL,
    PaymentMethod VARCHAR(30) NOT NULL,
    TransactionCode VARCHAR(100) NULL,
    AmountPaid DECIMAL(18,2) NOT NULL CONSTRAINT CK_Payments_Amount CHECK (AmountPaid > 0),
    PaymentDate DATETIME2 NOT NULL CONSTRAINT DF_Payments_Date DEFAULT SYSDATETIME(),
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_Payments_Status DEFAULT 'Success',
    PaymentNotes NVARCHAR(255) NULL,
    CONSTRAINT FK_Payments_Invoices FOREIGN KEY (InvoiceID) REFERENCES Invoices(InvoiceID),
    CONSTRAINT FK_Payments_Staff FOREIGN KEY (ReceivedByStaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_Payments_Method CHECK (PaymentMethod IN ('VNPay', 'MoMo', 'BankTransfer', 'Cash', 'CreditCard', 'DepositOffset')),
    CONSTRAINT CK_Payments_Status CHECK (Status IN ('Pending', 'Success', 'Failed', 'Refunded', 'RefundDue', 'Reversed'))
);
GO

-- =========================================================================
-- 7. MAINTENANCE & SUPPORT TICKETING
-- =========================================================================

CREATE TABLE MaintenanceRecords (
    MaintenanceID INT IDENTITY(1,1) CONSTRAINT PK_MaintenanceRecords PRIMARY KEY,
    UnitID INT NOT NULL,
    AssignedStaffID INT NOT NULL,
    MaintenanceType NVARCHAR(100) NOT NULL,
    Description NVARCHAR(1000) NOT NULL,
    Cost DECIMAL(18,2) NOT NULL CONSTRAINT DF_Maintenance_Cost DEFAULT 0.00,
    Status VARCHAR(25) NOT NULL CONSTRAINT DF_Maintenance_Status DEFAULT 'Scheduled',
    ScheduledDate DATE NOT NULL,
    CompletedDate DATETIME2 NULL,
    Notes NVARCHAR(500) NULL,
    CONSTRAINT FK_Maintenance_StorageUnits FOREIGN KEY (UnitID) REFERENCES StorageUnits(UnitID),
    CONSTRAINT FK_Maintenance_Staff FOREIGN KEY (AssignedStaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_Maintenance_Status CHECK (Status IN ('Scheduled', 'InProgress', 'Completed', 'Cancelled'))
);
GO

CREATE TABLE SupportRequests (
    RequestID INT IDENTITY(1,1) CONSTRAINT PK_SupportRequests PRIMARY KEY,
    RequestCode VARCHAR(30) NOT NULL CONSTRAINT UQ_Support_Code UNIQUE,
    CustomerID INT NOT NULL,
    FacilityID INT NOT NULL,
    ContractID INT NULL,
    UnitID INT NULL,
    AssignedStaffID INT NULL,
    Category VARCHAR(50) NOT NULL,
    Priority VARCHAR(20) NOT NULL CONSTRAINT DF_Support_Priority DEFAULT 'Medium',
    Title NVARCHAR(200) NOT NULL,
    Description NVARCHAR(MAX) NOT NULL,
    Status VARCHAR(25) NOT NULL CONSTRAINT DF_Support_Status DEFAULT 'Open',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Support_CreatedAt DEFAULT SYSDATETIME(),
    ResolvedAt DATETIME2 NULL,
    CONSTRAINT FK_Support_Customers FOREIGN KEY (CustomerID) REFERENCES Users(UserID),
    CONSTRAINT FK_Support_Facilities FOREIGN KEY (FacilityID) REFERENCES Facilities(FacilityID),
    CONSTRAINT FK_Support_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
    CONSTRAINT FK_Support_StorageUnits FOREIGN KEY (UnitID) REFERENCES StorageUnits(UnitID),
    CONSTRAINT FK_Support_Staff FOREIGN KEY (AssignedStaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_Support_Category CHECK (Category IN ('LockIssue', 'AccessCodeIssue', 'DamagedUnit', 'PaymentIssue', 'StoredItemsIssue', 'Other')),
    CONSTRAINT CK_Support_Priority CHECK (Priority IN ('Low', 'Medium', 'High', 'Urgent')),
    CONSTRAINT CK_Support_Status CHECK (Status IN ('Open', 'InProgress', 'Resolved', 'Closed'))
);
GO

CREATE TABLE SupportUpdates (
    UpdateID INT IDENTITY(1,1) CONSTRAINT PK_SupportUpdates PRIMARY KEY,
    RequestID INT NOT NULL,
    UpdatedByUserID INT NOT NULL,
    ActionMessage NVARCHAR(MAX) NOT NULL,
    PreviousStatus VARCHAR(25) NULL,
    NewStatus VARCHAR(25) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_SupportUpdates_Time DEFAULT SYSDATETIME(),
    CONSTRAINT FK_SupportUpdates_Requests FOREIGN KEY (RequestID) REFERENCES SupportRequests(RequestID) ON DELETE CASCADE,
    CONSTRAINT FK_SupportUpdates_Users FOREIGN KEY (UpdatedByUserID) REFERENCES Users(UserID)
);
GO

-- =========================================================================
-- 8. PERFORMANCE INDEXES
-- =========================================================================

CREATE NONCLUSTERED INDEX IX_StorageUnits_Facility_Status 
    ON StorageUnits(FacilityID, Status);

CREATE NONCLUSTERED INDEX IX_Contracts_Customer_Status 
    ON Contracts(CustomerID, Status);

CREATE NONCLUSTERED INDEX IX_Invoices_Customer_Status 
    ON Invoices(CustomerID, Status);

CREATE NONCLUSTERED INDEX IX_SupportRequests_Facility_Status 
    ON SupportRequests(FacilityID, Status);

CREATE NONCLUSTERED INDEX IX_AuthorizedPersons_Contract_Status 
    ON AuthorizedPersons(ContractID, Status);

CREATE NONCLUSTERED INDEX IX_AccessRecords_Contract_Entry 
    ON AccessRecords(ContractID, EntryTime DESC);

CREATE NONCLUSTERED INDEX IX_AccessRecords_Facility_Entry 
    ON AccessRecords(FacilityID, EntryTime DESC) INCLUDE (UnitID, Result, ExitTime);

-- Visitors currently inside the facility (entered, not yet exited)
CREATE NONCLUSTERED INDEX IX_AccessRecords_Inside 
    ON AccessRecords(FacilityID, UnitID) WHERE Result = 'Granted' AND ExitTime IS NULL;
GO

-- =========================================================================
-- 9. SEED DATA (LOOKUP & INITIAL CONFIGURATION)
-- =========================================================================

INSERT INTO Roles (RoleName, Description) VALUES
(N'Storage Customer', N'Khách hàng thuê và sử dụng kho tự quản'),
(N'Facility Staff', N'Nhân viên hỗ trợ bàn giao, kiểm tra và bảo trì tại chi nhánh'),
(N'Facility Manager', N'Quản lý chi nhánh kho, phân bổ nhân sự và giám sát hợp đồng'),
(N'Business Operations Manager', N'Quản trị viên vận hành kinh doanh, quản lý giá và toàn chuỗi'),
(N'System Administrator', N'Quản trị hệ thống, tài khoản và an ninh dữ liệu');

INSERT INTO FeeConfigurations (FeeCode, FeeName, DefaultAmount, CalculationMethod, Description) VALUES
('LATE_FEE_DAILY', N'Phí phạt quá hạn mỗi ngày', 100000.00, 'DailyRate', N'Tính lũy tiến cho mỗi ngày trễ hạn bàn giao hoặc thanh toán'),
('LOST_KEY_FEE', N'Phí cấp lại chìa khóa cơ', 150000.00, 'Fixed', N'Áp dụng khi khách hàng làm mất chìa khóa cơ vật lý'),
('LOST_CARD_FEE', N'Phí cấp lại thẻ từ truy cập', 100000.00, 'Fixed', N'Phí cấp mới thẻ từ mở cửa kho/thang máy'),
('CLEANING_FEE', N'Phí vệ sinh sau trả kho', 200000.00, 'Fixed', N'Áp dụng nếu kho bị bẩn hoặc để lại rác thải khi check-out'),
('LOCK_REPLACE_FEE', N'Phí thay mới ổ khóa thông minh', 500000.00, 'Fixed', N'Áp dụng trong trường hợp ổ khóa bị hỏng hóc do lỗi người dùng');

INSERT INTO UnitTypes (TypeName, LengthMeters, WidthMeters, HeightMeters, HasClimateControl, BaseDailyRate, BaseMonthlyRate, Description) VALUES
(N'Locker Mini (0.5m x 0.5m)', 0.5, 0.5, 0.5, 0, 15000.00, 300000.00, N'Phù hợp lưu trữ giấy tờ, hồ sơ, tư trang cá nhân nhỏ gọn'),
(N'Kho Nhỏ S (1.5m x 1.5m)', 1.5, 1.5, 2.5, 0, 50000.00, 1200000.00, N'Phù hợp đồ đạc sinh viên, vali, đồ dùng chuyển trọ'),
(N'Kho Tiêu Chuẩn M (2.0m x 2.5m)', 2.0, 2.5, 2.8, 0, 95000.00, 2400000.00, N'Lưu trữ nội thất gia đình 1 phòng ngủ hoặc kho hàng online'),
(N'Kho Lớn L - Điều Hòa (3.0m x 4.0m)', 3.0, 4.0, 3.0, 1, 180000.00, 4800000.00, N'Hệ thống điều hòa kiểm soát độ ẩm và nhiệt độ cho đồ điện tử, mỹ phẩm');

INSERT INTO RentalPolicies (PolicyName, FacilityID, DepositPercent, CancellationGraceHours, CancellationFeePercent, RenewalNoticeDays, MaxOverdueDaysBeforeLock, IsActive, EffectiveDate) VALUES
(N'Chính sách thuê kho tiêu chuẩn 2026', NULL, 100.00, 24, 10.00, 7, 1, 1, '2026-01-01');
GO