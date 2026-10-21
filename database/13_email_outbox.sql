SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.EmailOutboxMessages', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmailOutboxMessages (
        EmailOutboxMessageID BIGINT IDENTITY(1,1) CONSTRAINT PK_EmailOutboxMessages PRIMARY KEY,
        EventKey VARCHAR(150) NOT NULL,
        RecipientEmail VARCHAR(254) NOT NULL,
        RecipientName NVARCHAR(200) NOT NULL,
        Subject NVARCHAR(200) NOT NULL,
        HtmlBody NVARCHAR(MAX) NOT NULL,
        TextBody NVARCHAR(MAX) NOT NULL,
        Status VARCHAR(20) NOT NULL CONSTRAINT DF_EmailOutboxMessages_Status DEFAULT 'Pending',
        AttemptCount INT NOT NULL CONSTRAINT DF_EmailOutboxMessages_AttemptCount DEFAULT 0,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_EmailOutboxMessages_CreatedAt DEFAULT SYSDATETIME(),
        NextAttemptAt DATETIME2 NOT NULL CONSTRAINT DF_EmailOutboxMessages_NextAttemptAt DEFAULT SYSDATETIME(),
        LockedUntil DATETIME2 NULL,
        SentAt DATETIME2 NULL,
        LastError NVARCHAR(2000) NULL,
        CONSTRAINT UQ_EmailOutboxMessages_EventKey UNIQUE (EventKey),
        CONSTRAINT CK_EmailOutboxMessages_Status
            CHECK (Status IN ('Pending', 'Processing', 'Sent', 'Failed')),
        CONSTRAINT CK_EmailOutboxMessages_AttemptCount CHECK (AttemptCount >= 0)
    );

    CREATE INDEX IX_EmailOutboxMessages_Status_NextAttemptAt
        ON dbo.EmailOutboxMessages(Status, NextAttemptAt, EmailOutboxMessageID);
END;

COMMIT TRANSACTION;
GO
