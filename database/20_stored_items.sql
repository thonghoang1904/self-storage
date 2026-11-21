SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('StoredItems', 'U') IS NULL
BEGIN
    CREATE TABLE StoredItems (
        StoredItemID BIGINT IDENTITY(1,1) CONSTRAINT PK_StoredItems PRIMARY KEY,
        ContractID INT NOT NULL,
        VisitRegistrationID BIGINT NULL,
        ItemName NVARCHAR(100) NOT NULL,
        Category NVARCHAR(80) NULL,
        Quantity INT NOT NULL CONSTRAINT CK_StoredItems_Quantity CHECK (Quantity BETWEEN 1 AND 999),
        LengthCm DECIMAL(7,2) NOT NULL CONSTRAINT CK_StoredItems_Length CHECK (LengthCm >= 0.1 AND LengthCm <= 2000),
        WidthCm DECIMAL(7,2) NOT NULL CONSTRAINT CK_StoredItems_Width CHECK (WidthCm >= 0.1 AND WidthCm <= 2000),
        HeightCm DECIMAL(7,2) NOT NULL CONSTRAINT CK_StoredItems_Height CHECK (HeightCm >= 0.1 AND HeightCm <= 2000),
        UnitVolumeM3 AS CAST((LengthCm * WidthCm * HeightCm) / 1000000.0 AS DECIMAL(12,6)) PERSISTED,
        TotalVolumeM3 AS CAST(((LengthCm * WidthCm * HeightCm) / 1000000.0) * Quantity AS DECIMAL(14,6)) PERSISTED,
        Status VARCHAR(20) NOT NULL CONSTRAINT DF_StoredItems_Status DEFAULT 'PendingMoveIn',
        Notes NVARCHAR(300) NULL,
        ImageUrl NVARCHAR(500) NULL,
        CreatedByUserID INT NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_StoredItems_CreatedAt DEFAULT SYSDATETIME(),
        MovedInAt DATETIME2 NULL,
        RemovedAt DATETIME2 NULL,
        UpdatedAt DATETIME2 NULL,
        CONSTRAINT FK_StoredItems_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
        CONSTRAINT FK_StoredItems_VisitRegistrations FOREIGN KEY (VisitRegistrationID)
            REFERENCES VisitRegistrations(VisitRegistrationID),
        CONSTRAINT FK_StoredItems_Users FOREIGN KEY (CreatedByUserID) REFERENCES Users(UserID),
        CONSTRAINT CK_StoredItems_Status
            CHECK (Status IN ('PendingMoveIn', 'Stored', 'Removed', 'Cancelled'))
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StoredItems_ContractID_Status')
    CREATE INDEX IX_StoredItems_ContractID_Status
        ON StoredItems(ContractID, Status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StoredItems_VisitRegistrationID')
    CREATE INDEX IX_StoredItems_VisitRegistrationID
        ON StoredItems(VisitRegistrationID)
        WHERE VisitRegistrationID IS NOT NULL;

COMMIT TRANSACTION;
GO
