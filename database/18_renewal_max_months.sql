-- Add after database/17_deposit_payment_hours.sql. Safe to run more than once.
-- Limits each contract renewal request (ContractRenewals.ExtensionMonths) to 1..12 months.

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_Renewals_Months' AND parent_object_id = OBJECT_ID(N'dbo.ContractRenewals')
      AND definition LIKE N'%12%')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints
        WHERE name = N'CK_Renewals_Months' AND parent_object_id = OBJECT_ID(N'dbo.ContractRenewals'))
        ALTER TABLE dbo.ContractRenewals DROP CONSTRAINT CK_Renewals_Months;
    ALTER TABLE dbo.ContractRenewals WITH NOCHECK ADD CONSTRAINT CK_Renewals_Months
        CHECK (ExtensionMonths BETWEEN 1 AND 12);
END
GO

