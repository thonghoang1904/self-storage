-- Add after database/16_billing_safety.sql. Safe to run more than once.
-- RentalPolicies.DepositPaymentHours: how long a new reservation waits for its deposit before it expires.
-- CancellationGraceHours was used for this before; it now only means the free-cancellation window
-- (counted from booking). Existing policies keep their deposit window: the old value is copied once,
-- when the column is added.

IF COL_LENGTH('dbo.RentalPolicies', 'DepositPaymentHours') IS NULL
BEGIN
    ALTER TABLE dbo.RentalPolicies ADD DepositPaymentHours INT NOT NULL
        CONSTRAINT DF_RentalPolicies_DepositHours DEFAULT 24;
    EXEC sp_executesql N'UPDATE dbo.RentalPolicies SET DepositPaymentHours = CancellationGraceHours
        WHERE CancellationGraceHours BETWEEN 1 AND 720;';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_RentalPolicies_DepositHours' AND parent_object_id = OBJECT_ID(N'dbo.RentalPolicies'))
    ALTER TABLE dbo.RentalPolicies ADD CONSTRAINT CK_RentalPolicies_DepositHours CHECK (DepositPaymentHours > 0);
GO
