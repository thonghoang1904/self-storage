SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH('Reservations', 'PromotionID') IS NULL
    ALTER TABLE Reservations ADD PromotionID INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_Reservations_Promotions')
BEGIN
    ALTER TABLE Reservations ADD CONSTRAINT FK_Reservations_Promotions
        FOREIGN KEY (PromotionID) REFERENCES Promotions(PromotionID);
END;
GO

IF COL_LENGTH('Reservations', 'PromotionDiscountAmount') IS NULL
    ALTER TABLE Reservations ADD PromotionDiscountAmount DECIMAL(18,2) NOT NULL
        CONSTRAINT DF_Reservations_PromotionDiscount DEFAULT 0;
GO

IF COL_LENGTH('Contracts', 'PromotionID') IS NULL
    ALTER TABLE Contracts ADD PromotionID INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_Contracts_Promotions')
BEGIN
    ALTER TABLE Contracts ADD CONSTRAINT FK_Contracts_Promotions
        FOREIGN KEY (PromotionID) REFERENCES Promotions(PromotionID);
END;
GO

IF OBJECT_ID('ReservationCancellationRequests', 'U') IS NULL
BEGIN
    CREATE TABLE ReservationCancellationRequests (
        CancellationRequestID INT IDENTITY(1,1) CONSTRAINT PK_ReservationCancellationRequests PRIMARY KEY,
        ReservationID INT NOT NULL,
        CustomerID INT NOT NULL,
        Reason NVARCHAR(1000) NOT NULL,
        Status VARCHAR(20) NOT NULL CONSTRAINT DF_CancellationRequests_Status DEFAULT 'Pending',
        RequestedAt DATETIME2 NOT NULL CONSTRAINT DF_CancellationRequests_RequestedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time'),
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
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
    WHERE name = 'UX_CancellationRequests_Reservation_Pending'
    AND object_id = OBJECT_ID('ReservationCancellationRequests'))
    CREATE UNIQUE INDEX UX_CancellationRequests_Reservation_Pending
        ON ReservationCancellationRequests(ReservationID) WHERE Status = 'Pending';

IF NOT EXISTS (SELECT 1 FROM sys.indexes
    WHERE name = 'UX_Contracts_Customer_FirstPromotion' AND object_id = OBJECT_ID('Contracts'))
    CREATE UNIQUE INDEX UX_Contracts_Customer_FirstPromotion
        ON Contracts(CustomerID) WHERE PromotionID IS NOT NULL;

COMMIT TRANSACTION;
GO
