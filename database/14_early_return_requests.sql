SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- Early returns: a customer's request to hand the unit back before the end date, and the record of every
-- early return staff complete (with or without a request). EarlyReturnFee is deducted from the deposit.
IF OBJECT_ID('EarlyReturnRequests', 'U') IS NULL
BEGIN
    CREATE TABLE EarlyReturnRequests (
        RequestID INT IDENTITY(1,1) CONSTRAINT PK_EarlyReturnRequests PRIMARY KEY,
        ContractID INT NOT NULL,
        CustomerID INT NOT NULL,
        ReturnDate DATE NOT NULL,
        Reason NVARCHAR(500) NOT NULL,
        EarlyReturnFee DECIMAL(18,2) NOT NULL CONSTRAINT DF_EarlyReturnRequests_Fee DEFAULT 0,
        Status VARCHAR(20) NOT NULL CONSTRAINT DF_EarlyReturnRequests_Status DEFAULT 'Pending',
        RequestedAt DATETIME2 NOT NULL CONSTRAINT DF_EarlyReturnRequests_RequestedAt DEFAULT SYSDATETIME(),
        CompletedByStaffID INT NULL,
        CompletedAt DATETIME2 NULL,
        CONSTRAINT FK_EarlyReturnRequests_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
        CONSTRAINT FK_EarlyReturnRequests_Customers FOREIGN KEY (CustomerID) REFERENCES Users(UserID),
        CONSTRAINT FK_EarlyReturnRequests_Staff FOREIGN KEY (CompletedByStaffID) REFERENCES Users(UserID),
        CONSTRAINT CK_EarlyReturnRequests_Fee CHECK (EarlyReturnFee >= 0),
        CONSTRAINT CK_EarlyReturnRequests_Status CHECK (Status IN ('Pending', 'Completed', 'Cancelled'))
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EarlyReturnRequests_ContractID_Status')
    CREATE INDEX IX_EarlyReturnRequests_ContractID_Status ON EarlyReturnRequests(ContractID, Status);

-- One pending request per contract.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_EarlyReturnRequests_PendingContract')
    CREATE UNIQUE INDEX UX_EarlyReturnRequests_PendingContract
        ON EarlyReturnRequests(ContractID) WHERE Status = 'Pending';

IF NOT EXISTS (SELECT 1 FROM FeeConfigurations WHERE FeeCode = 'EARLY_RETURN_FEE')
    INSERT INTO FeeConfigurations (FeeCode, FeeName, DefaultAmount, CalculationMethod, Description)
    VALUES ('EARLY_RETURN_FEE', N'Phí trả kho sớm', 200000.00, 'Fixed',
            N'Thu khi khách trả kho trước ngày hết hạn hợp đồng; trừ vào tiền cọc');

COMMIT TRANSACTION;
GO
