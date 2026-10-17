USE SelfStorageDB;
GO

IF COL_LENGTH(N'dbo.Invoices', N'ReservationID') IS NULL
BEGIN
    ALTER TABLE dbo.Invoices ADD ReservationID INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Invoices_Reservations')
BEGIN
    ALTER TABLE dbo.Invoices
        ADD CONSTRAINT FK_Invoices_Reservations
        FOREIGN KEY (ReservationID) REFERENCES dbo.Reservations(ReservationID);
END
GO

IF COL_LENGTH(N'dbo.ContractRenewals', N'InvoiceID') IS NULL
BEGIN
    ALTER TABLE dbo.ContractRenewals ADD InvoiceID INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Renewals_Invoices')
BEGIN
    ALTER TABLE dbo.ContractRenewals
        ADD CONSTRAINT FK_Renewals_Invoices
        FOREIGN KEY (InvoiceID) REFERENCES dbo.Invoices(InvoiceID);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ContractRenewals_InvoiceID'
    AND object_id = OBJECT_ID(N'dbo.ContractRenewals'))
BEGIN
    CREATE UNIQUE INDEX UX_ContractRenewals_InvoiceID
        ON dbo.ContractRenewals(InvoiceID) WHERE InvoiceID IS NOT NULL;
END
GO
