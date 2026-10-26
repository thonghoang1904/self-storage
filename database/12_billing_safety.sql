-- Add after database/11_normalize_contacts.sql. Safe to run more than once.
-- 1. RentalPolicies.DepositPaymentHours: how long a new reservation waits for its deposit
--    (previously CancellationGraceHours was used for this as well as for free cancellation).
-- 2. Payments.PaymentMethod 'DepositOffset': unpaid rent/extra charges settled from the deposit at return.
-- 3. Payments.Status 'RefundDue' / 'Reversed': money taken by VNPay/MoMo for an invoice that could no longer
--    accept it (cancelled, expired, already paid); staff refunds it and the payment becomes 'Reversed'.
-- 4. Contracts.PrepaidRentCredit: rent paid ahead for periods after an early return, paid back with the deposit.

IF COL_LENGTH('RentalPolicies', 'DepositPaymentHours') IS NULL
    ALTER TABLE RentalPolicies ADD DepositPaymentHours INT NOT NULL
        CONSTRAINT DF_RentalPolicies_DepositHours DEFAULT 24;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_RentalPolicies_DepositHours')
    ALTER TABLE RentalPolicies ADD CONSTRAINT CK_RentalPolicies_DepositHours CHECK (DepositPaymentHours > 0);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_Payments_Method' AND definition LIKE N'%DepositOffset%')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Payments_Method')
        ALTER TABLE Payments DROP CONSTRAINT CK_Payments_Method;
    ALTER TABLE Payments ADD CONSTRAINT CK_Payments_Method
        CHECK (PaymentMethod IN ('VNPay', 'MoMo', 'BankTransfer', 'Cash', 'CreditCard', 'DepositOffset'));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_Payments_Status' AND definition LIKE N'%RefundDue%')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Payments_Status')
        ALTER TABLE Payments DROP CONSTRAINT CK_Payments_Status;
    ALTER TABLE Payments ADD CONSTRAINT CK_Payments_Status
        CHECK (Status IN ('Pending', 'Success', 'Failed', 'Refunded', 'RefundDue', 'Reversed'));
END
GO

IF COL_LENGTH('Contracts', 'PrepaidRentCredit') IS NULL
    ALTER TABLE Contracts ADD PrepaidRentCredit DECIMAL(18,2) NOT NULL
        CONSTRAINT DF_Contracts_PrepaidRentCredit DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Contracts_PrepaidRentCredit')
    ALTER TABLE Contracts ADD CONSTRAINT CK_Contracts_PrepaidRentCredit CHECK (PrepaidRentCredit >= 0);
GO
