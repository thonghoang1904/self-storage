-- CCCD is optional for staff accounts. A UNIQUE constraint in SQL Server lets only ONE row be NULL,
-- so the second account saved without a CCCD failed with "Số CCCD đã được đăng ký cho tài khoản khác".
-- Replace it with a unique index that only covers rows that have a CCCD (same as UX_Users_GoogleSubject).
-- This migration is safe to run more than once.
IF EXISTS (
    SELECT 1
    FROM sys.key_constraints
    WHERE name = N'UQ_Users_CitizenID'
      AND parent_object_id = OBJECT_ID(N'dbo.Users'))
BEGIN
    ALTER TABLE dbo.Users DROP CONSTRAINT UQ_Users_CitizenID;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_Users_CitizenID'
      AND object_id = OBJECT_ID(N'dbo.Users'))
BEGIN
    CREATE UNIQUE INDEX UX_Users_CitizenID
        ON dbo.Users(CitizenID)
        WHERE CitizenID IS NOT NULL;
END;
GO
