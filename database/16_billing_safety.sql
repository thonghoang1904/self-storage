-- Add after database/15_normalize_contacts.sql. Safe to run more than once.
-- 1. Payments.Status 'RefundDue' / 'Reversed': money taken by VNPay/MoMo for an invoice that could no longer
--    accept it (cancelled, expired, already paid); staff refunds it and the payment becomes 'Reversed'.
-- 2. Payments.PaymentMethod 'DepositOffset': unpaid rent/extra charges settled from the deposit at return.

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_Payments_Method' AND parent_object_id = OBJECT_ID(N'dbo.Payments')
      AND definition LIKE N'%DepositOffset%')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints
        WHERE name = N'CK_Payments_Method' AND parent_object_id = OBJECT_ID(N'dbo.Payments'))
        ALTER TABLE dbo.Payments DROP CONSTRAINT CK_Payments_Method;
    ALTER TABLE dbo.Payments ADD CONSTRAINT CK_Payments_Method
        CHECK (PaymentMethod IN ('VNPay', 'MoMo', 'BankTransfer', 'Cash', 'CreditCard', 'DepositOffset'));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_Payments_Status' AND parent_object_id = OBJECT_ID(N'dbo.Payments')
      AND definition LIKE N'%RefundDue%')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints
        WHERE name = N'CK_Payments_Status' AND parent_object_id = OBJECT_ID(N'dbo.Payments'))
        ALTER TABLE dbo.Payments DROP CONSTRAINT CK_Payments_Status;
    ALTER TABLE dbo.Payments ADD CONSTRAINT CK_Payments_Status
        CHECK (Status IN ('Pending', 'Success', 'Failed', 'Refunded', 'RefundDue', 'Reversed'));
END
GO
