SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- Number of people who came in together with the verified visitor (not counting the visitor).
IF COL_LENGTH('AccessRecords', 'CompanionCount') IS NULL
    ALTER TABLE AccessRecords ADD CompanionCount INT NOT NULL
        CONSTRAINT DF_AccessRec_Companions DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_AccessRec_Companions' AND parent_object_id = OBJECT_ID('AccessRecords'))
    ALTER TABLE AccessRecords ADD CONSTRAINT CK_AccessRec_Companions
        CHECK (CompanionCount BETWEEN 0 AND 50);

COMMIT TRANSACTION;
GO
