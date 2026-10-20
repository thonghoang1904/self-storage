-- Align the seeded global policy with the agreed one-day lock grace period.
UPDATE RentalPolicies
SET MaxOverdueDaysBeforeLock = 1
WHERE FacilityID IS NULL
  AND IsActive = 1
  AND MaxOverdueDaysBeforeLock = 3;
GO
