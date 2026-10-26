-- =========================================================================
-- Chuẩn hóa CCCD, số điện thoại và email đã có trong database
-- (bỏ dấu cách/dấu chấm/gạch, +84 -> 0, email chữ thường)
-- để khớp với cách backend lưu và so sánh từ nay về sau.
-- Không đổi cấu trúc bảng. Chạy lại nhiều lần vẫn an toàn (đã có trong upgrade_existing.sql).
-- Nếu chuẩn hóa làm hai dòng bị trùng (vi phạm UNIQUE), script dừng và liệt kê
-- các dòng đó để xử lý tay trước.
-- =========================================================================

SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @Users TABLE (UserID INT PRIMARY KEY, CitizenID VARCHAR(25) NULL, PhoneNumber VARCHAR(20), Email VARCHAR(100));
INSERT INTO @Users
SELECT UserID,
       NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CitizenID, ' ', ''), '.', ''), '-', ''), '(', ''), ')', ''), CHAR(9), ''), ''),
       PhoneNumber,
       LOWER(LTRIM(RTRIM(Email)))
FROM Users;

DECLARE @People TABLE (AuthorizedPersonID INT PRIMARY KEY, ContractID INT, CitizenID VARCHAR(25), PhoneNumber VARCHAR(20));
INSERT INTO @People
SELECT AuthorizedPersonID, ContractID,
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CitizenID, ' ', ''), '.', ''), '-', ''), '(', ''), ')', ''), CHAR(9), ''),
       PhoneNumber
FROM AuthorizedPersons;

-- Phone: drop separators, then +84xxxxxxxxx / 84xxxxxxxxx -> 0xxxxxxxxx
UPDATE @Users SET PhoneNumber = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(PhoneNumber, ' ', ''), '.', ''), '-', ''), '(', ''), ')', ''), CHAR(9), '');
UPDATE @Users SET PhoneNumber = '0' + SUBSTRING(PhoneNumber, 4, 20) WHERE PhoneNumber LIKE '+84%';
UPDATE @Users SET PhoneNumber = '0' + SUBSTRING(PhoneNumber, 3, 20) WHERE PhoneNumber LIKE '84%' AND LEN(PhoneNumber) = 11;
UPDATE @People SET PhoneNumber = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(PhoneNumber, ' ', ''), '.', ''), '-', ''), '(', ''), ')', ''), CHAR(9), '');
UPDATE @People SET PhoneNumber = '0' + SUBSTRING(PhoneNumber, 4, 20) WHERE PhoneNumber LIKE '+84%';
UPDATE @People SET PhoneNumber = '0' + SUBSTRING(PhoneNumber, 3, 20) WHERE PhoneNumber LIKE '84%' AND LEN(PhoneNumber) = 11;

-- Duplicates that the normalization would create
DECLARE @Conflicts TABLE (TableName VARCHAR(30), Field VARCHAR(20), Value VARCHAR(100), Ids VARCHAR(400));
INSERT INTO @Conflicts
SELECT 'Users', 'CitizenID', CitizenID, STRING_AGG(CAST(UserID AS VARCHAR(10)), ', ')
FROM @Users WHERE CitizenID IS NOT NULL GROUP BY CitizenID HAVING COUNT(*) > 1
UNION ALL
SELECT 'Users', 'Email', Email, STRING_AGG(CAST(UserID AS VARCHAR(10)), ', ')
FROM @Users GROUP BY Email HAVING COUNT(*) > 1
UNION ALL
SELECT 'AuthorizedPersons', 'CitizenID', CAST(ContractID AS VARCHAR(10)) + ' / ' + CitizenID,
       STRING_AGG(CAST(AuthorizedPersonID AS VARCHAR(10)), ', ')
FROM @People GROUP BY ContractID, CitizenID HAVING COUNT(*) > 1;

IF EXISTS (SELECT 1 FROM @Conflicts)
BEGIN
    SELECT TableName, Field, Value, Ids AS [ID bị trùng sau khi chuẩn hóa] FROM @Conflicts;
    ROLLBACK TRANSACTION;
    RAISERROR(N'Có dữ liệu bị trùng sau khi chuẩn hóa (xem bảng kết quả). Hãy sửa tay các dòng này rồi chạy lại script.', 16, 1);
    RETURN;
END

UPDATE u SET CitizenID = n.CitizenID, PhoneNumber = n.PhoneNumber, Email = n.Email
FROM Users u JOIN @Users n ON n.UserID = u.UserID
WHERE ISNULL(u.CitizenID, '') <> ISNULL(n.CitizenID, '') OR u.PhoneNumber <> n.PhoneNumber OR u.Email <> n.Email;
PRINT CONCAT(N'Users đã chuẩn hóa: ', @@ROWCOUNT);

UPDATE p SET CitizenID = n.CitizenID, PhoneNumber = n.PhoneNumber
FROM AuthorizedPersons p JOIN @People n ON n.AuthorizedPersonID = p.AuthorizedPersonID
WHERE p.CitizenID <> n.CitizenID OR p.PhoneNumber <> n.PhoneNumber;
PRINT CONCAT(N'AuthorizedPersons đã chuẩn hóa: ', @@ROWCOUNT);

COMMIT TRANSACTION;

-- Rows still not in a valid format after normalization: fix them by hand
-- (customers can also fill in their own data via PUT /api/auth/me).
SELECT 'Users' AS TableName, UserID AS Id, Username AS Name, CitizenID, PhoneNumber, Email,
       CASE WHEN CitizenID IS NULL THEN N'Thiếu CCCD (không vào kho được)'
            WHEN CitizenID NOT LIKE REPLICATE('[0-9]', 12) THEN N'CCCD sai định dạng'
            WHEN PhoneNumber NOT LIKE '0[35789]' + REPLICATE('[0-9]', 8) THEN N'SĐT sai định dạng'
            ELSE N'Email sai định dạng' END AS Problem
FROM Users
WHERE (CitizenID IS NULL AND RoleID = (SELECT RoleID FROM Roles WHERE RoleName = N'Storage Customer'))
   OR CitizenID NOT LIKE REPLICATE('[0-9]', 12)
   OR PhoneNumber NOT LIKE '0[35789]' + REPLICATE('[0-9]', 8)
   OR Email NOT LIKE '_%@_%._%'
UNION ALL
SELECT 'AuthorizedPersons', AuthorizedPersonID, FullName, CitizenID, PhoneNumber, NULL,
       CASE WHEN CitizenID NOT LIKE REPLICATE('[0-9]', 12) THEN N'CCCD sai định dạng' ELSE N'SĐT sai định dạng' END
FROM AuthorizedPersons
WHERE Status = 'Active'
  AND (CitizenID NOT LIKE REPLICATE('[0-9]', 12) OR PhoneNumber NOT LIKE '0[35789]' + REPLICATE('[0-9]', 8));
GO
