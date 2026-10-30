-- =========================================================================
-- Chuẩn hóa CCCD, số điện thoại và email đã có trong database
-- (bỏ dấu cách/dấu chấm/gạch/ngoặc, +84 -> 0, email chữ thường)
-- để khớp với cách backend lưu và so sánh từ nay về sau.
-- Không đổi cấu trúc bảng. Chạy lại nhiều lần vẫn an toàn; backend Development chạy script này mỗi lần khởi động.
-- Dòng nào sau khi chuẩn hóa sẽ trùng với dòng khác (vi phạm UNIQUE) thì được giữ nguyên giá trị cũ
-- và liệt kê ở bảng kết quả cuối script để xử lý tay; script không dừng vì những dòng đó.
-- =========================================================================

SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @Users TABLE (UserID INT PRIMARY KEY, CitizenID VARCHAR(25) NULL, PhoneNumber VARCHAR(20), Email VARCHAR(100));
INSERT INTO @Users
SELECT UserID,
       NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CitizenID, ' ', ''), '.', ''), '-', ''), '(', ''), ')', ''), CHAR(9), ''), ''),
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(PhoneNumber, ' ', ''), '.', ''), '-', ''), '(', ''), ')', ''), CHAR(9), ''),
       LOWER(LTRIM(RTRIM(Email)))
FROM Users;

DECLARE @People TABLE (AuthorizedPersonID INT PRIMARY KEY, ContractID INT, CitizenID VARCHAR(25), PhoneNumber VARCHAR(20));
INSERT INTO @People
SELECT AuthorizedPersonID, ContractID,
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CitizenID, ' ', ''), '.', ''), '-', ''), '(', ''), ')', ''), CHAR(9), ''),
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(PhoneNumber, ' ', ''), '.', ''), '-', ''), '(', ''), ')', ''), CHAR(9), '')
FROM AuthorizedPersons;

-- Phone: +84xxxxxxxxx / 84xxxxxxxxx -> 0xxxxxxxxx
UPDATE @Users SET PhoneNumber = '0' + SUBSTRING(PhoneNumber, 4, 20) WHERE PhoneNumber LIKE '+84%';
UPDATE @Users SET PhoneNumber = '0' + SUBSTRING(PhoneNumber, 3, 20) WHERE PhoneNumber LIKE '84%' AND LEN(PhoneNumber) = 11;
UPDATE @People SET PhoneNumber = '0' + SUBSTRING(PhoneNumber, 4, 20) WHERE PhoneNumber LIKE '+84%';
UPDATE @People SET PhoneNumber = '0' + SUBSTRING(PhoneNumber, 3, 20) WHERE PhoneNumber LIKE '84%' AND LEN(PhoneNumber) = 11;

-- Phone numbers are not unique: always normalized.
UPDATE u SET PhoneNumber = n.PhoneNumber
FROM Users u JOIN @Users n ON n.UserID = u.UserID
WHERE u.PhoneNumber COLLATE Latin1_General_BIN <> n.PhoneNumber AND n.PhoneNumber <> '';

UPDATE p SET PhoneNumber = n.PhoneNumber
FROM AuthorizedPersons p JOIN @People n ON n.AuthorizedPersonID = p.AuthorizedPersonID
WHERE p.PhoneNumber COLLATE Latin1_General_BIN <> n.PhoneNumber AND n.PhoneNumber <> '';

-- CCCD and email are unique: skip a row whose normalized value another row also normalizes to.
UPDATE u SET CitizenID = n.CitizenID
FROM Users u JOIN @Users n ON n.UserID = u.UserID
WHERE ISNULL(u.CitizenID, '') COLLATE Latin1_General_BIN <> ISNULL(n.CitizenID, '')
  AND NOT EXISTS (SELECT 1 FROM @Users o WHERE o.UserID <> n.UserID AND o.CitizenID = n.CitizenID);

-- Email uniqueness already ignores case (default collation), so lower-casing cannot create a duplicate.
UPDATE u SET Email = n.Email
FROM Users u JOIN @Users n ON n.UserID = u.UserID
WHERE u.Email COLLATE Latin1_General_BIN <> n.Email
  AND NOT EXISTS (SELECT 1 FROM @Users o WHERE o.UserID <> n.UserID AND o.Email = n.Email);

UPDATE p SET CitizenID = n.CitizenID
FROM AuthorizedPersons p JOIN @People n ON n.AuthorizedPersonID = p.AuthorizedPersonID
WHERE p.CitizenID COLLATE Latin1_General_BIN <> n.CitizenID
  AND NOT EXISTS (SELECT 1 FROM @People o WHERE o.AuthorizedPersonID <> n.AuthorizedPersonID
      AND o.ContractID = n.ContractID AND o.CitizenID = n.CitizenID);

COMMIT TRANSACTION;

-- Rows still to fix by hand: duplicates after normalization, or not in a valid format.
-- (A customer without a CCCD can fill it in once via PUT /api/auth/me.)
SELECT 'Users' AS TableName, UserID AS Id, Username AS Name, CitizenID, PhoneNumber, Email,
       CASE WHEN CitizenID IS NULL THEN N'Thiếu CCCD (không vào kho được)'
            WHEN CitizenID NOT LIKE REPLICATE('[0-9]', 12) THEN N'CCCD sai định dạng hoặc trùng sau chuẩn hóa'
            WHEN PhoneNumber NOT LIKE '0[35789]' + REPLICATE('[0-9]', 8) THEN N'SĐT sai định dạng'
            ELSE N'Email sai định dạng' END AS Problem
FROM Users
WHERE (CitizenID IS NULL AND RoleID = (SELECT RoleID FROM Roles WHERE RoleName = N'Storage Customer'))
   OR CitizenID NOT LIKE REPLICATE('[0-9]', 12)
   OR PhoneNumber NOT LIKE '0[35789]' + REPLICATE('[0-9]', 8)
   OR Email NOT LIKE '_%@_%._%'
UNION ALL
SELECT 'AuthorizedPersons', AuthorizedPersonID, FullName, CitizenID, PhoneNumber, NULL,
       CASE WHEN CitizenID NOT LIKE REPLICATE('[0-9]', 12) THEN N'CCCD sai định dạng hoặc trùng sau chuẩn hóa'
            ELSE N'SĐT sai định dạng' END
FROM AuthorizedPersons
WHERE Status = 'Active'
  AND (CitizenID NOT LIKE REPLICATE('[0-9]', 12) OR PhoneNumber NOT LIKE '0[35789]' + REPLICATE('[0-9]', 8));
GO
