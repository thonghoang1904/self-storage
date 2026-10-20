SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('VisitRegistrations', 'U') IS NULL
BEGIN
    CREATE TABLE VisitRegistrations (
        VisitRegistrationID BIGINT IDENTITY(1,1) CONSTRAINT PK_VisitRegistrations PRIMARY KEY,
        ContractID INT NOT NULL,
        CustomerID INT NOT NULL,
        AuthorizedPersonID INT NULL,
        ScheduledEntryAt DATETIMEOFFSET NOT NULL,
        ScheduledExitAt DATETIMEOFFSET NOT NULL,
        Purpose NVARCHAR(255) NOT NULL,
        Status VARCHAR(20) NOT NULL CONSTRAINT DF_VisitRegistrations_Status DEFAULT 'Pending',
        RequestedAt DATETIME2 NOT NULL CONSTRAINT DF_VisitRegistrations_RequestedAt DEFAULT SYSDATETIME(),
        ReviewedByStaffID INT NULL,
        ReviewedAt DATETIME2 NULL,
        ReviewNotes NVARCHAR(500) NULL,
        CONSTRAINT FK_VisitRegistrations_Contracts FOREIGN KEY (ContractID) REFERENCES Contracts(ContractID),
        CONSTRAINT FK_VisitRegistrations_Customers FOREIGN KEY (CustomerID) REFERENCES Users(UserID),
        CONSTRAINT FK_VisitRegistrations_AuthorizedPersons FOREIGN KEY (AuthorizedPersonID)
            REFERENCES AuthorizedPersons(AuthorizedPersonID),
        CONSTRAINT FK_VisitRegistrations_Staff FOREIGN KEY (ReviewedByStaffID) REFERENCES Users(UserID),
        CONSTRAINT CK_VisitRegistrations_Time CHECK (ScheduledExitAt > ScheduledEntryAt),
        CONSTRAINT CK_VisitRegistrations_Status
            CHECK (Status IN ('Pending', 'Approved', 'Rejected', 'Cancelled'))
    );
END;

IF COL_LENGTH('AccessRecords', 'VisitRegistrationID') IS NULL
BEGIN
    ALTER TABLE AccessRecords ADD VisitRegistrationID BIGINT NULL;
    ALTER TABLE AccessRecords ADD CONSTRAINT FK_AccessRecords_VisitRegistrations
        FOREIGN KEY (VisitRegistrationID) REFERENCES VisitRegistrations(VisitRegistrationID);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VisitRegistrations_ContractID_ScheduledEntryAt')
    CREATE INDEX IX_VisitRegistrations_ContractID_ScheduledEntryAt
        ON VisitRegistrations(ContractID, ScheduledEntryAt);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VisitRegistrations_Status_ScheduledEntryAt')
    CREATE INDEX IX_VisitRegistrations_Status_ScheduledEntryAt
        ON VisitRegistrations(Status, ScheduledEntryAt);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccessRecords_VisitRegistrationID')
    CREATE INDEX IX_AccessRecords_VisitRegistrationID ON AccessRecords(VisitRegistrationID);

COMMIT TRANSACTION;
GO
