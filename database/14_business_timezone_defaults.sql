SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Users_CreatedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.Users DROP CONSTRAINT DF_Users_CreatedAt;
    ALTER TABLE dbo.Users ADD CONSTRAINT DF_Users_CreatedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_ActivityLogs_CreatedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.ActivityLogs DROP CONSTRAINT DF_ActivityLogs_CreatedAt;
    ALTER TABLE dbo.ActivityLogs ADD CONSTRAINT DF_ActivityLogs_CreatedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Facilities_CreatedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.Facilities DROP CONSTRAINT DF_Facilities_CreatedAt;
    ALTER TABLE dbo.Facilities ADD CONSTRAINT DF_Facilities_CreatedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_StaffAssign_Date' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.FacilityStaffAssignments DROP CONSTRAINT DF_StaffAssign_Date;
    ALTER TABLE dbo.FacilityStaffAssignments ADD CONSTRAINT DF_StaffAssign_Date DEFAULT CONVERT(date, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR AssignedDate;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_StorageUnits_CreatedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.StorageUnits DROP CONSTRAINT DF_StorageUnits_CreatedAt;
    ALTER TABLE dbo.StorageUnits ADD CONSTRAINT DF_StorageUnits_CreatedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Reservations_CreatedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.Reservations DROP CONSTRAINT DF_Reservations_CreatedAt;
    ALTER TABLE dbo.Reservations ADD CONSTRAINT DF_Reservations_CreatedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_CancellationRequests_RequestedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.ReservationCancellationRequests DROP CONSTRAINT DF_CancellationRequests_RequestedAt;
    ALTER TABLE dbo.ReservationCancellationRequests ADD CONSTRAINT DF_CancellationRequests_RequestedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR RequestedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Contracts_SignedDate' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.Contracts DROP CONSTRAINT DF_Contracts_SignedDate;
    ALTER TABLE dbo.Contracts ADD CONSTRAINT DF_Contracts_SignedDate DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR SignedDate;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Handover_Time' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.HandoverRecords DROP CONSTRAINT DF_Handover_Time;
    ALTER TABLE dbo.HandoverRecords ADD CONSTRAINT DF_Handover_Time DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR HandoverDateTime;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Renewals_ReqAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.ContractRenewals DROP CONSTRAINT DF_Renewals_ReqAt;
    ALTER TABLE dbo.ContractRenewals ADD CONSTRAINT DF_Renewals_ReqAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR RequestedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_AuthPersons_CreatedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.AuthorizedPersons DROP CONSTRAINT DF_AuthPersons_CreatedAt;
    ALTER TABLE dbo.AuthorizedPersons ADD CONSTRAINT DF_AuthPersons_CreatedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_AccessRec_Entry' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.AccessRecords DROP CONSTRAINT DF_AccessRec_Entry;
    ALTER TABLE dbo.AccessRecords ADD CONSTRAINT DF_AccessRec_Entry DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR EntryTime;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Invoices_CreatedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.Invoices DROP CONSTRAINT DF_Invoices_CreatedAt;
    ALTER TABLE dbo.Invoices ADD CONSTRAINT DF_Invoices_CreatedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Payments_Date' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.Payments DROP CONSTRAINT DF_Payments_Date;
    ALTER TABLE dbo.Payments ADD CONSTRAINT DF_Payments_Date DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR PaymentDate;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Support_CreatedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.SupportRequests DROP CONSTRAINT DF_Support_CreatedAt;
    ALTER TABLE dbo.SupportRequests ADD CONSTRAINT DF_Support_CreatedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_SupportUpdates_Time' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.SupportUpdates DROP CONSTRAINT DF_SupportUpdates_Time;
    ALTER TABLE dbo.SupportUpdates ADD CONSTRAINT DF_SupportUpdates_Time DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_VisitRegistrations_RequestedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.VisitRegistrations DROP CONSTRAINT DF_VisitRegistrations_RequestedAt;
    ALTER TABLE dbo.VisitRegistrations ADD CONSTRAINT DF_VisitRegistrations_RequestedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR RequestedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_EmailOutboxMessages_CreatedAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.EmailOutboxMessages DROP CONSTRAINT DF_EmailOutboxMessages_CreatedAt;
    ALTER TABLE dbo.EmailOutboxMessages ADD CONSTRAINT DF_EmailOutboxMessages_CreatedAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR CreatedAt;
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_EmailOutboxMessages_NextAttemptAt' AND definition NOT LIKE '%SE Asia Standard Time%')
BEGIN
    ALTER TABLE dbo.EmailOutboxMessages DROP CONSTRAINT DF_EmailOutboxMessages_NextAttemptAt;
    ALTER TABLE dbo.EmailOutboxMessages ADD CONSTRAINT DF_EmailOutboxMessages_NextAttemptAt DEFAULT CONVERT(datetime2, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') FOR NextAttemptAt;
END;

COMMIT TRANSACTION;
GO
