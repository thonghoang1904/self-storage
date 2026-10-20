-- Add after database/04_support_checklists.sql.
-- This migration is safe to run more than once.
IF COL_LENGTH('dbo.Users', 'GoogleSubject') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD GoogleSubject VARCHAR(255) NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_Users_GoogleSubject'
      AND object_id = OBJECT_ID(N'dbo.Users'))
BEGIN
    CREATE UNIQUE INDEX UX_Users_GoogleSubject
        ON dbo.Users(GoogleSubject)
        WHERE GoogleSubject IS NOT NULL;
END;
GO
