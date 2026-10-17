USE SelfStorageDB;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_Reservations_InventoryHolds'
      AND object_id = OBJECT_ID(N'dbo.Reservations'))
BEGIN
    CREATE INDEX IX_Reservations_InventoryHolds
        ON dbo.Reservations(FacilityID, UnitTypeID, Status, DepositDeadline);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_AccessRecords_OneActiveVisit'
      AND object_id = OBJECT_ID(N'dbo.AccessRecords'))
BEGIN
    CREATE UNIQUE INDEX UX_AccessRecords_OneActiveVisit
        ON dbo.AccessRecords(ContractID, AuthorizedPersonID)
        WHERE Result = 'Granted' AND ExitTime IS NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_Payments_TransactionCode'
      AND object_id = OBJECT_ID(N'dbo.Payments'))
BEGIN
    CREATE UNIQUE INDEX UX_Payments_TransactionCode
        ON dbo.Payments(TransactionCode)
        WHERE TransactionCode IS NOT NULL;
END
GO
