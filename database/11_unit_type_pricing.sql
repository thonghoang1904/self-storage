SET XACT_ABORT ON;
BEGIN TRANSACTION;

UPDATE unit
SET MonthlyPrice = unitType.BaseMonthlyRate
FROM dbo.StorageUnits AS unit
INNER JOIN dbo.UnitTypes AS unitType ON unitType.UnitTypeID = unit.UnitTypeID
WHERE unit.MonthlyPrice <> unitType.BaseMonthlyRate;

COMMIT TRANSACTION;
GO
