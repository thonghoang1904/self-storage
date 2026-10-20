-- Add after database/06_rental_policy_rules.sql.
-- This migration is safe to run more than once.
IF COL_LENGTH('dbo.Invoices', 'BillingPeriodStart') IS NULL
BEGIN
    ALTER TABLE dbo.Invoices ADD BillingPeriodStart DATE NULL;
END;
GO

IF COL_LENGTH('dbo.Invoices', 'BillingPeriodEnd') IS NULL
BEGIN
    ALTER TABLE dbo.Invoices ADD BillingPeriodEnd DATE NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_Invoices_MonthlyRentPeriod'
      AND object_id = OBJECT_ID(N'dbo.Invoices'))
BEGIN
    CREATE UNIQUE INDEX UX_Invoices_MonthlyRentPeriod
        ON dbo.Invoices(ContractID, BillingPeriodStart)
        WHERE InvoiceType = 'MONTHLY_RENT'
          AND ContractID IS NOT NULL
          AND BillingPeriodStart IS NOT NULL;
END;
GO
