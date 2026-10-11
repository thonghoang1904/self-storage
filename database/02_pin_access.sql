-- =========================================================================
-- PATCH: Entry/exit by PIN code + staff identity confirmation
-- Run AFTER 01_schema.sql (the original sqlquery.txt).
--
-- Flow:
--   1. Visitor types UnitCode + PIN on the gate kiosk.
--   2. System checks the PIN against the active contract -> creates an
--      AccessRecords row with Result = 'Pending' (nobody verified yet).
--   3. Staff on duty sees the pending request, checks the visitor's ID card
--      against the customer / authorized persons, then Approves (Granted)
--      or Denies (Denied).
--   4. When the visitor leaves, staff confirms exit (ExitTime).
-- =========================================================================

USE SelfStorageDB;
GO

-- -------------------------------------------------------------------------
-- 1. PIN stored on the contract (hashed, never plain text)
-- -------------------------------------------------------------------------
ALTER TABLE Contracts ADD
    AccessPinHash VARCHAR(255) NULL,
    PinFailedAttempts INT NOT NULL CONSTRAINT DF_Contracts_PinFailed DEFAULT 0,
    PinLockedUntil DATETIME2 NULL,
    PinUpdatedAt DATETIME2 NULL;
GO

-- -------------------------------------------------------------------------
-- 2. AccessRecords: allow a 'Pending' state between PIN entry and staff check
-- -------------------------------------------------------------------------
ALTER TABLE AccessRecords DROP CONSTRAINT CK_AccessRec_DenyReason;
ALTER TABLE AccessRecords DROP CONSTRAINT CK_AccessRec_Result;
ALTER TABLE AccessRecords DROP CONSTRAINT FK_AccessRec_VerifyStaff;
GO

ALTER TABLE AccessRecords ALTER COLUMN VerifiedByStaffID INT NULL;
GO

ALTER TABLE AccessRecords ADD
    PinEnteredAt DATETIME2 NULL,   -- when the PIN was accepted at the kiosk
    VerifiedAt DATETIME2 NULL;     -- when staff approved / denied
GO

ALTER TABLE AccessRecords ADD
    CONSTRAINT FK_AccessRec_VerifyStaff FOREIGN KEY (VerifiedByStaffID) REFERENCES Users(UserID),
    CONSTRAINT CK_AccessRec_Result CHECK (Result IN ('Pending', 'Granted', 'Denied')),
    CONSTRAINT CK_AccessRec_DenyReason CHECK (
        (Result = 'Pending' AND DenyReason IS NULL AND VerifiedByStaffID IS NULL AND ExitTime IS NULL) OR
        (Result = 'Granted' AND DenyReason IS NULL AND VerifiedByStaffID IS NOT NULL) OR
        (Result = 'Denied' AND ExitTime IS NULL AND DenyReason IN (
            'IdentityMismatch', 'NotAuthorized', 'ContractEnded', 'OverdueLocked',
            'OutsideOperatingHours', 'UnitUnderMaintenance', 'Expired', 'Other')
            -- 'Expired' = nobody checked the visitor in time; set by the system, no staff
            AND (VerifiedByStaffID IS NOT NULL OR DenyReason = 'Expired')));
GO

-- At most one pending request per contract at a time
CREATE UNIQUE NONCLUSTERED INDEX UX_AccessRecords_OnePendingPerContract
    ON AccessRecords(ContractID) WHERE Result = 'Pending';

-- Staff gate screen: pending requests per facility
CREATE NONCLUSTERED INDEX IX_AccessRecords_Facility_Pending
    ON AccessRecords(FacilityID, PinEnteredAt) WHERE Result = 'Pending';
GO
