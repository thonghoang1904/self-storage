SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH('dbo.Payments', 'GatewayPaymentUrl') IS NULL
    ALTER TABLE dbo.Payments ADD GatewayPaymentUrl NVARCHAR(2048) NULL;

IF COL_LENGTH('dbo.Payments', 'GatewayQrCodeUrl') IS NULL
    ALTER TABLE dbo.Payments ADD GatewayQrCodeUrl NVARCHAR(4000) NULL;

IF COL_LENGTH('dbo.Payments', 'GatewayDeepLink') IS NULL
    ALTER TABLE dbo.Payments ADD GatewayDeepLink NVARCHAR(2048) NULL;

IF COL_LENGTH('dbo.Payments', 'GatewayDeepLinkWebInApp') IS NULL
    ALTER TABLE dbo.Payments ADD GatewayDeepLinkWebInApp NVARCHAR(2048) NULL;

COMMIT TRANSACTION;
GO
