-- Add after database/18_renewal_max_months.sql. Safe to run more than once.
-- Tracks the single active login session per account so a new login invalidates older tokens.

IF COL_LENGTH('dbo.Users', 'ActiveSessionId') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD ActiveSessionId VARCHAR(64) NULL;
END;
GO

IF COL_LENGTH('dbo.Users', 'SessionIssuedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD SessionIssuedAt DATETIME2 NULL;
END;
GO

