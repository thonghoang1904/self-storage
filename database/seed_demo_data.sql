-- =========================================================================
-- SYSTEM: SELF-STORAGE FACILITY RENTAL AND MANAGEMENT SYSTEM
-- SCRIPT: Realistic demo data for development and presentations. NOT for production.
--
-- Run:    sqlcmd -S localhost -E -C -f 65001 -i database\seed_demo_data.sql
-- Trial:  set @DryRun = 1 below: everything runs, the summary prints, then it is rolled back.
-- Login:  new accounts share the password of the demo account "admin" (Demo@12345 by default).
--
-- Additive: existing rows are kept, except the display names and phone numbers of the
-- seeded demo accounts (admin, ops1, manager1, staff1, customer1) and the demo facility name.
-- Dates are relative to the day it runs. Every contract already has its rent invoices through
-- today + 7 days, so MonthlyRentInvoiceService has nothing to create and queues no email.
-- People, phone numbers and CCCD are fictional; emails use the reserved domain example.com.
-- It refuses to run twice; to start over, run setup_fresh.sql (this erases ALL data).
-- =========================================================================

USE SelfStorageDB;
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

DECLARE @DryRun BIT = 0;

DECLARE @Now DATETIME2(0) = CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2(0));
DECLARE @Today DATE = CAST(@Now AS DATE);
DECLARE @Password VARCHAR(255) = (SELECT PasswordHash FROM Users WHERE Username = 'admin' AND Email = 'admin@example.com');

-- A database without the demo admin is not a development database.
IF @Password IS NULL
    THROW 50001, 'Demo account admin@example.com not found: run the API in Development once, and never run this script on production.', 1;
IF EXISTS (SELECT 1 FROM Facilities WHERE FacilityName = N'SafeKeep Thủ Đức')
    THROW 50002, 'Demo data is already there; this script only runs once.', 1;

DROP TABLE IF EXISTS #N, #S, #F, #T, #U, #P, #I, #V, #Sup, #Tpl;

BEGIN TRANSACTION;

SELECT TOP (61) n = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 INTO #N FROM sys.all_objects;

-- =========================================================================
-- 1. TIDY UP THE SEEDED DEMO ACCOUNTS AND FACILITY
-- =========================================================================

UPDATE f SET FacilityName = N'SafeKeep Quận 7', Address = N'123 Nguyễn Thị Thập, Phường Tân Phú'
FROM Facilities f WHERE f.FacilityName LIKE 'Self Storage%';

UPDATE u SET FullName = v.FullName, PhoneNumber = v.Phone, UpdatedAt = @Now
FROM Users u
JOIN (VALUES
    ('admin',     N'Quản trị hệ thống', '0909871234'),
    ('ops1',      N'Phạm Thu Hà',       '0986340217'),
    ('manager1',  N'Trần Quốc Bảo',     '0903214567'),
    ('staff1',    N'Lê Minh Tuấn',      '0937125846'),
    ('customer1', N'Nguyễn Văn Khánh',  '0918452630')
) v (Username, FullName, Phone) ON v.Username = u.Username AND u.Email = v.Username + '@example.com';

UPDATE AuthorizedPersons SET FullName = N'Nguyễn Thị Hồng Nhung', PhoneNumber = '0911526384'
WHERE FullName = N'Nguyễn Thị Người Nhà';

-- =========================================================================
-- 2. FACILITIES, STAFF, PROMOTIONS
-- =========================================================================

INSERT INTO Facilities (FacilityName, Address, City, District, Hotline, OperatingHours, CreatedAt)
SELECT v.Name, v.Addr, v.City, v.District, v.Hotline, N'06:00 - 22:00', DATEADD(DAY, -420, @Now)
FROM (VALUES
    (N'SafeKeep Thủ Đức',   N'215 Võ Văn Ngân, Phường Linh Chiểu',        N'TP. Hồ Chí Minh', N'TP. Thủ Đức',   '02873001102'),
    (N'SafeKeep Bình Thạnh', N'88 Điện Biên Phủ, Phường 15',              N'TP. Hồ Chí Minh', N'Quận Bình Thạnh', '02873001103'),
    (N'SafeKeep Tân Bình',  N'412 Cộng Hòa, Phường 13',                   N'TP. Hồ Chí Minh', N'Quận Tân Bình', '02873001104'),
    (N'SafeKeep Cầu Giấy',  N'36 Duy Tân, Phường Dịch Vọng Hậu',          N'Hà Nội',          N'Quận Cầu Giấy', '02473001105'),
    (N'SafeKeep Hải Châu',  N'120 Nguyễn Văn Linh, Phường Nam Dương',     N'Đà Nẵng',         N'Quận Hải Châu', '02363001106')
) v (Name, Addr, City, District, Hotline);

SELECT f.FacilityID, v.Slug, Manager = CAST(NULL AS INT), StaffA = CAST(NULL AS INT), StaffB = CAST(NULL AS INT)
INTO #F
FROM Facilities f
JOIN (VALUES
    (N'SafeKeep Quận 7', 'quan7'), (N'SafeKeep Thủ Đức', 'thuduc'), (N'SafeKeep Bình Thạnh', 'binhthanh'),
    (N'SafeKeep Tân Bình', 'tanbinh'), (N'SafeKeep Cầu Giấy', 'caugiay'), (N'SafeKeep Hải Châu', 'haichau')
) v (Name, Slug) ON v.Name = f.FacilityName;

SELECT v.Slug, v.Slot, v.Username, v.FullName, v.Phone, v.Cccd
INTO #S
FROM (VALUES
    ('quan7',     'StaffB',  'nv.quan7',      N'Đỗ Thị Thanh Vân',  '0978214536', '079187004512'),
    ('thuduc',    'Manager', 'ql.thuduc',     N'Võ Hoàng Nam',      '0903558214', '079084006231'),
    ('thuduc',    'StaffA',  'nv.thuduc1',    N'Nguyễn Thị Kim Oanh', '0935127460', '079192008147'),
    ('thuduc',    'StaffB',  'nv.thuduc2',    N'Trịnh Gia Huy',     '0967301852', '079098003365'),
    ('binhthanh', 'Manager', 'ql.binhthanh',  N'Huỳnh Thị Mỹ Hạnh', '0908416273', '079186002794'),
    ('binhthanh', 'StaffA',  'nv.binhthanh1', N'Phan Thành Lộc',    '0932674185', '079095007428'),
    ('binhthanh', 'StaffB',  'nv.binhthanh2', N'Lý Ngọc Bích',      '0972583614', '079194005913'),
    ('tanbinh',   'Manager', 'ql.tanbinh',    N'Đặng Quốc Việt',    '0918735426', '079082009156'),
    ('tanbinh',   'StaffA',  'nv.tanbinh1',   N'Bùi Thị Tuyết Mai', '0938260471', '079193001687'),
    ('tanbinh',   'StaffB',  'nv.tanbinh2',   N'Hồ Minh Đức',       '0986142753', '079097006342'),
    ('caugiay',   'Manager', 'ql.caugiay',    N'Nguyễn Thị Thu Hương', '0912648357', '001185003926'),
    ('caugiay',   'StaffA',  'nv.caugiay1',   N'Vũ Đức Mạnh',       '0983571264', '001096008471'),
    ('caugiay',   'StaffB',  'nv.caugiay2',   N'Đào Phương Anh',    '0975318426', '001197002653'),
    ('haichau',   'Manager', 'ql.haichau',    N'Lê Công Thành',     '0905372816', '048083007219'),
    ('haichau',   'StaffA',  'nv.haichau1',   N'Trương Thị Ánh Tuyết', '0935846172', '048192004538'),
    ('haichau',   'StaffB',  'nv.haichau2',   N'Ngô Văn Sơn',       '0979265143', '048094009162')
) v (Slug, Slot, Username, FullName, Phone, Cccd);

INSERT INTO Users (RoleID, Username, PasswordHash, FullName, Email, PhoneNumber, CitizenID, CreatedAt)
SELECT r.RoleID, s.Username, @Password, s.FullName, s.Username + '@example.com', s.Phone, s.Cccd, DATEADD(DAY, -415, @Now)
FROM #S s
JOIN Roles r ON r.RoleName = CASE s.Slot WHEN 'Manager' THEN N'Facility Manager' ELSE N'Facility Staff' END;

UPDATE f SET
    Manager = COALESCE((SELECT u.UserID FROM #S s JOIN Users u ON u.Username = s.Username WHERE s.Slug = f.Slug AND s.Slot = 'Manager'),
                       (SELECT UserID FROM Users WHERE Username = 'manager1')),
    StaffA  = COALESCE((SELECT u.UserID FROM #S s JOIN Users u ON u.Username = s.Username WHERE s.Slug = f.Slug AND s.Slot = 'StaffA'),
                       (SELECT UserID FROM Users WHERE Username = 'staff1')),
    StaffB  = (SELECT u.UserID FROM #S s JOIN Users u ON u.Username = s.Username WHERE s.Slug = f.Slug AND s.Slot = 'StaffB')
FROM #F f;

INSERT INTO FacilityStaffAssignments (FacilityID, StaffID, AssignedDate)
SELECT f.FacilityID, x.StaffID, DATEADD(DAY, -410, @Today)
FROM #F f
CROSS APPLY (VALUES (f.Manager), (f.StaffA), (f.StaffB)) x (StaffID)
WHERE NOT EXISTS (SELECT 1 FROM FacilityStaffAssignments a WHERE a.FacilityID = f.FacilityID AND a.StaffID = x.StaffID);

INSERT INTO Promotions (PromoCode, Title, DiscountPercent, MaxDiscountAmount, MinRentalMonths, StartDate, EndDate, IsActive)
SELECT v.Code, v.Title, v.Pct, v.MaxAmount, v.MinMonths, v.StartDate, v.EndDate, v.Active
FROM (VALUES
    ('KHACHMOI10', N'Giảm 10% tháng đầu cho khách thuê lần đầu',  10.00, 200000.00, 1, DATEADD(DAY, -400, @Today), DATEADD(DAY, 60, @Today), 1),
    ('THUEDAI20',  N'Giảm 20% tháng đầu khi thuê từ 6 tháng',     20.00, 500000.00, 6, DATEADD(DAY, -30, @Today),  DATEADD(DAY, 90, @Today), 1),
    ('TET2026',    N'Ưu đãi Tết: giảm 15% tháng đầu',             15.00, 300000.00, 1, DATEADD(DAY, -300, @Today), DATEADD(DAY, -240, @Today), 0)
) v (Code, Title, Pct, MaxAmount, MinMonths, StartDate, EndDate, Active)
WHERE NOT EXISTS (SELECT 1 FROM Promotions p WHERE p.PromoCode = v.Code);

DECLARE @Promo INT = (SELECT PromotionID FROM Promotions WHERE PromoCode = 'KHACHMOI10');

-- =========================================================================
-- 3. CUSTOMERS
-- =========================================================================

DROP TABLE IF EXISTS #Cust;
;WITH Fam AS (
    SELECT * FROM (VALUES
        (0, N'Nguyễn', 'nguyen'), (1, N'Trần', 'tran'), (2, N'Lê', 'le'), (3, N'Phạm', 'pham'),
        (4, N'Hoàng', 'hoang'), (5, N'Huỳnh', 'huynh'), (6, N'Phan', 'phan'), (7, N'Vũ', 'vu'),
        (8, N'Võ', 'vo'), (9, N'Đặng', 'dang'), (10, N'Bùi', 'bui'), (11, N'Đỗ', 'do')
    ) v (i, Name, Slug)
), Given AS (
    SELECT * FROM (VALUES
        (1, 0, N'Minh Quân', 'minhquan'), (1, 1, N'Hoàng Long', 'hoanglong'), (1, 2, N'Đức Anh', 'ducanh'), (1, 3, N'Quốc Huy', 'quochuy'),
        (1, 4, N'Thành Đạt', 'thanhdat'), (1, 5, N'Gia Bảo', 'giabao'), (1, 6, N'Tuấn Kiệt', 'tuankiet'), (1, 7, N'Văn Hùng', 'vanhung'),
        (1, 8, N'Hữu Phước', 'huuphuoc'), (1, 9, N'Anh Khoa', 'anhkhoa'), (1, 10, N'Trọng Nghĩa', 'trongnghia'), (1, 11, N'Đình Khôi', 'dinhkhoi'),
        (1, 12, N'Công Danh', 'congdanh'), (1, 13, N'Nhật Nam', 'nhatnam'), (1, 14, N'Thanh Tùng', 'thanhtung'), (1, 15, N'Xuân Trường', 'xuantruong'),
        (0, 0, N'Thu Trang', 'thutrang'), (0, 1, N'Ngọc Anh', 'ngocanh'), (0, 2, N'Thị Mai', 'thimai'), (0, 3, N'Khánh Linh', 'khanhlinh'),
        (0, 4, N'Phương Thảo', 'phuongthao'), (0, 5, N'Hồng Nhung', 'hongnhung'), (0, 6, N'Bảo Trâm', 'baotram'), (0, 7, N'Minh Châu', 'minhchau'),
        (0, 8, N'Thùy Dương', 'thuyduong'), (0, 9, N'Thanh Hằng', 'thanhhang'), (0, 10, N'Mỹ Duyên', 'myduyen'), (0, 11, N'Kim Ngân', 'kimngan'),
        (0, 12, N'Diễm My', 'diemmy'), (0, 13, N'Hải Yến', 'haiyen'), (0, 14, N'Lan Anh', 'lananh'), (0, 15, N'Quỳnh Như', 'quynhnhu')
    ) v (Male, i, Name, Slug)
), Addr AS (
    SELECT * FROM (VALUES
        (0, N'45 Lê Văn Việt, TP. Thủ Đức, TP. Hồ Chí Minh', '079'), (1, N'17 Xô Viết Nghệ Tĩnh, Quận Bình Thạnh, TP. Hồ Chí Minh', '079'),
        (2, N'302 Hoàng Văn Thụ, Quận Tân Bình, TP. Hồ Chí Minh', '079'), (3, N'76 Huỳnh Tấn Phát, Quận 7, TP. Hồ Chí Minh', '079'),
        (4, N'25 Trần Thái Tông, Quận Cầu Giấy, Hà Nội', '001'), (5, N'141 Xuân Thủy, Quận Cầu Giấy, Hà Nội', '001'),
        (6, N'58 Hùng Vương, Quận Hải Châu, Đà Nẵng', '048'), (7, N'9 Pasteur, Quận 1, TP. Hồ Chí Minh', '079'),
        (8, N'210 Phan Văn Trị, Quận Gò Vấp, TP. Hồ Chí Minh', '079'), (9, N'33 Nguyễn Văn Cừ, TP. Biên Hòa, Đồng Nai', '075')
    ) v (i, Text, Province)
), Num AS (
    SELECT N = n + 1 FROM #N UNION ALL SELECT n + 62 FROM #N WHERE n < 19
)
SELECT
    Num.N,
    FullName = Fam.Name + N' ' + Given.Name,
    Username = CAST(Fam.Slug + Given.Slug AS VARCHAR(50)),
    Phone = LEFT(p.Prefix, 3) + RIGHT('0000000' + CAST((Num.N * 7919 + 1234567) % 10000000 AS VARCHAR(7)), 7),
    Cccd = Addr.Province + CAST(1 - Num.N % 2 AS CHAR(1)) + CAST(78 + Num.N % 22 AS CHAR(2))
        + RIGHT('000000' + CAST((Num.N * 48271) % 1000000 AS VARCHAR(6)), 6),
    Address = Addr.Text,
    UserID = CAST(NULL AS INT)
INTO #Cust
FROM Num
JOIN Fam ON Fam.i = (Num.N / 2) % 12
JOIN Given ON Given.Male = Num.N % 2 AND Given.i = (Num.N / 2) % 16
JOIN Addr ON Addr.i = Num.N % 10
CROSS APPLY (SELECT Prefix = SUBSTRING('090091093097098070079081083085035036038', (Num.N % 13) * 3 + 1, 3)) p;

INSERT INTO Users (RoleID, Username, PasswordHash, FullName, Email, PhoneNumber, CitizenID, Address, Status, CreatedAt)
SELECT (SELECT RoleID FROM Roles WHERE RoleName = N'Storage Customer'), c.Username, @Password, c.FullName,
    c.Username + '@example.com', c.Phone, c.Cccd, c.Address,
    CASE c.N WHEN 79 THEN 'Inactive' WHEN 80 THEN 'Suspended' ELSE 'Active' END,
    DATEADD(MINUTE, c.N * 317, DATEADD(DAY, -(380 + c.N), @Now))
FROM #Cust c;

UPDATE c SET UserID = u.UserID FROM #Cust c JOIN Users u ON u.Username = c.Username;

-- =========================================================================
-- 4. STORAGE UNITS
-- =========================================================================

SELECT UnitTypeID, Rate = BaseMonthlyRate, Letter = CHAR(64 + rn), Cnt = CHOOSE(rn, 8, 10, 8, 6)
INTO #T
FROM (SELECT UnitTypeID, BaseMonthlyRate, rn = ROW_NUMBER() OVER (ORDER BY BaseMonthlyRate) FROM UnitTypes) t
WHERE rn <= 4;

CREATE TABLE #U (UnitID INT, FacilityID INT, UnitTypeID INT, Rate DECIMAL(18,2), H INT NULL);

INSERT INTO StorageUnits (FacilityID, UnitTypeID, UnitCode, FloorNumber, ZoneArea, MonthlyPrice, CreatedAt)
OUTPUT inserted.UnitID, inserted.FacilityID, inserted.UnitTypeID, inserted.MonthlyPrice INTO #U (UnitID, FacilityID, UnitTypeID, Rate)
SELECT f.FacilityID, t.UnitTypeID, t.Letter + '-' + RIGHT('0' + CAST(k.n + 1 AS VARCHAR(2)), 2),
    CASE t.Letter WHEN 'A' THEN 1 WHEN 'B' THEN 1 + k.n / 5 WHEN 'C' THEN 2 ELSE 3 END,
    'Khu ' + t.Letter, t.Rate, DATEADD(DAY, -418, @Now)
FROM #F f
CROSS JOIN #T t
JOIN #N k ON k.n < t.Cnt
WHERE NOT EXISTS (SELECT 1 FROM StorageUnits u WHERE u.FacilityID = f.FacilityID
    AND u.UnitCode = t.Letter + '-' + RIGHT('0' + CAST(k.n + 1 AS VARCHAR(2)), 2));

-- A stable pseudo-random number for each unit; the same unit gets the same story within a run.
UPDATE #U SET H = CAST(SUBSTRING(HASHBYTES('MD5', CONCAT('unit', UnitID)), 1, 3) AS INT) % 1000;

-- =========================================================================
-- 5. THE PLAN: ONE ROW PER RESERVATION, WITH THE CONTRACT IT BECAME (IF ANY)
-- =========================================================================

CREATE TABLE #P (
    PlanID INT IDENTITY(1,1) PRIMARY KEY,
    Kind VARCHAR(10) NOT NULL,       -- Current: occupied now; History: returned; Open: no contract yet
    Scen VARCHAR(20) NOT NULL,
    UnitID INT NULL, FacilityID INT NOT NULL, UnitTypeID INT NOT NULL, Rate DECIMAL(18,2) NOT NULL,
    H INT NOT NULL, Seq INT NOT NULL,
    CustomerID INT NULL, StaffID INT NULL,
    Dur INT NULL, StartDate DATE NULL, EndDate DATE NULL, OldEnd DATE NULL, Ext INT NULL,
    PromoID INT NULL, Disc DECIMAL(18,2) NOT NULL DEFAULT 0,
    ResCode VARCHAR(30) COLLATE DATABASE_DEFAULT NULL, HdCode VARCHAR(30) COLLATE DATABASE_DEFAULT NULL,
    ResCreated DATETIME2(0) NULL, ResDeadline DATETIME2(0) NULL, Signed DATETIME2(0) NULL,
    ReservationID INT NULL, ContractID INT NULL
);

-- Occupied units: 56-68% of each facility, with a mix of situations for the screens to show.
INSERT INTO #P (Kind, Scen, UnitID, FacilityID, UnitTypeID, Rate, H, Seq)
SELECT 'Current',
    CASE rn % 20 WHEN 0 THEN 'Overdue' WHEN 1 THEN 'Late' WHEN 2 THEN 'Late' WHEN 3 THEN 'Ending' WHEN 4 THEN 'Ending'
        WHEN 5 THEN 'RenewPending' WHEN 6 THEN 'Renewed' WHEN 7 THEN 'Renewed' WHEN 8 THEN 'Early' ELSE 'Normal' END,
    UnitID, FacilityID, UnitTypeID, Rate, H, rn
FROM (SELECT *, rn = ROW_NUMBER() OVER (ORDER BY H, UnitID) FROM #U WHERE H % 500 * 2 < 560 + (FacilityID % 3) * 60) u;

-- Earlier tenants of units that are free now.
INSERT INTO #P (Kind, Scen, UnitID, FacilityID, UnitTypeID, Rate, H, Seq)
SELECT 'History', CASE rn % 4 WHEN 0 THEN 'ClosedEarly' ELSE 'Closed' END, UnitID, FacilityID, UnitTypeID, Rate, H, rn
FROM (SELECT u.*, rn = ROW_NUMBER() OVER (ORDER BY u.H DESC, u.UnitID) FROM #U u
      WHERE u.UnitID NOT IN (SELECT UnitID FROM #P) AND u.UnitID % 2 = 0) x;

-- Dates by situation. Monthly periods follow DATEADD(MONTH, n, StartDate), exactly like DateOnly.AddMonths.
UPDATE #P SET StartDate = DATEADD(DAY, -(12 + H % 310), @Today) WHERE Scen = 'Normal' OR Scen = 'Late';
UPDATE #P SET Dur = CASE WHEN DATEDIFF(DAY, StartDate, @Today) < 85 THEN 3 WHEN DATEDIFF(DAY, StartDate, @Today) < 175 THEN 6 ELSE 12 END
WHERE Scen IN ('Normal', 'Late');

UPDATE #P SET Dur = 3 + 3 * (H % 2), StartDate = DATEADD(MONTH, -(3 + 3 * (H % 2)), DATEADD(DAY, 7 + H % 22, @Today))
WHERE Scen IN ('Ending', 'RenewPending');

UPDATE #P SET Dur = 3, StartDate = DATEADD(MONTH, -3, DATEADD(DAY, -(3 + H % 15), @Today)) WHERE Scen = 'Overdue';
UPDATE #P SET Dur = 12, StartDate = DATEADD(DAY, -(30 + H % 120), @Today) WHERE Scen = 'Early';
UPDATE #P SET Dur = 3, StartDate = DATEADD(DAY, -(100 + H % 200), @Today), Ext = 6 WHERE Scen = 'Renewed';
UPDATE #P SET Ext = 12 WHERE Scen = 'Renewed' AND DATEDIFF(DAY, StartDate, @Today) >= 250;
UPDATE #P SET Dur = 1 + H % 3, StartDate = DATEADD(DAY, -(100 + H % 260), @Today) WHERE Scen = 'Closed';
UPDATE #P SET Dur = 6, StartDate = DATEADD(DAY, -(120 + H % 220), @Today) WHERE Scen = 'ClosedEarly';

UPDATE #P SET EndDate = DATEADD(MONTH, Dur, StartDate) WHERE Kind IN ('Current', 'History');
UPDATE #P SET EndDate = DATEADD(DAY, 20 + H % 40, StartDate) WHERE Scen = 'ClosedEarly';
UPDATE #P SET OldEnd = EndDate, EndDate = DATEADD(MONTH, Ext, EndDate) WHERE Scen = 'Renewed';
UPDATE #P SET OldEnd = EndDate, Ext = 3 WHERE Scen = 'RenewPending';

-- Reservations still open (only where enough free units remain) and closed ones that never became contracts.
;WITH Free AS (
    SELECT u.FacilityID, u.UnitTypeID, u.Rate, rn = ROW_NUMBER() OVER (ORDER BY u.FacilityID, u.UnitTypeID)
    FROM #U u
    WHERE NOT EXISTS (SELECT 1 FROM #P p WHERE p.UnitID = u.UnitID AND p.Kind = 'Current') AND u.H < 960
    GROUP BY u.FacilityID, u.UnitTypeID, u.Rate
    HAVING COUNT(*) >= 3
)
INSERT INTO #P (Kind, Scen, FacilityID, UnitTypeID, Rate, H, Seq, Dur)
SELECT 'Open', s.Scen, f.FacilityID, f.UnitTypeID, f.Rate, (f.rn * 137 + s.Bump) % 1000, f.rn * 2 + s.Bump, 3 + 3 * ((f.rn + s.Bump) % 3)
FROM Free f
CROSS APPLY (VALUES
    (0, CASE f.rn % 8 WHEN 0 THEN 'ConfirmedCancelling' WHEN 1 THEN 'Confirmed' WHEN 2 THEN 'Confirmed' WHEN 3 THEN 'Confirmed' ELSE 'PendingDeposit' END),
    (1, CASE f.rn % 3 WHEN 0 THEN 'CancelledPaid' WHEN 1 THEN 'CancelledUnpaid' ELSE 'Expired' END)
) s (Bump, Scen);

UPDATE #P SET StartDate = DATEADD(DAY, 1 + H % 12, @Today) WHERE Scen IN ('Confirmed', 'ConfirmedCancelling');
UPDATE #P SET StartDate = DATEADD(DAY, 2 + H % 10, @Today) WHERE Scen = 'PendingDeposit';
UPDATE #P SET StartDate = DATEADD(DAY, -(5 + H % 90), @Today) WHERE Scen IN ('CancelledPaid', 'CancelledUnpaid', 'Expired');
UPDATE #P SET EndDate = DATEADD(MONTH, Dur, StartDate) WHERE Kind = 'Open';

-- Customers 1-56 hold the current units, 30-69 the history; 70-78 only book, 79-80 are inactive accounts.
UPDATE p SET CustomerID = c.UserID FROM #P p JOIN #Cust c ON c.N = (p.Seq - 1) % 56 + 1 WHERE p.Kind = 'Current';
UPDATE p SET CustomerID = c.UserID FROM #P p JOIN #Cust c ON c.N = 30 + p.Seq % 40 WHERE p.Kind = 'History';
UPDATE p SET CustomerID = c.UserID FROM #P p JOIN #Cust c ON c.N = (p.Seq * 3) % 78 + 1 WHERE p.Kind = 'Open';

UPDATE p SET StaffID = CASE WHEN p.H % 2 = 0 THEN f.StaffA ELSE f.StaffB END FROM #P p JOIN #F f ON f.FacilityID = p.FacilityID;

UPDATE #P SET
    ResCreated = CASE
        WHEN Scen = 'PendingDeposit' THEN DATEADD(MINUTE, -(30 + H % 600), @Now)
        WHEN Kind = 'Open' AND StartDate > @Today THEN DATEADD(MINUTE, 480 + H % 700, CAST(DATEADD(DAY, -(1 + H % 3), @Today) AS DATETIME2(0)))
        ELSE DATEADD(MINUTE, 480 + H % 700, CAST(DATEADD(DAY, -(1 + H % 4), StartDate) AS DATETIME2(0))) END,
    Signed = DATEADD(MINUTE, 480 + H % 540, CAST(StartDate AS DATETIME2(0)));
UPDATE #P SET ResDeadline = DATEADD(HOUR, 24, ResCreated);
UPDATE #P SET
    ResCode = 'RSV-' + CONVERT(CHAR(8), ResCreated, 112) + '-' + LEFT(REPLACE(TRANSLATE(CONVERT(CHAR(36), NEWID()), '01', 'KM'), '-', ''), 8),
    HdCode = 'HD-' + CONVERT(CHAR(8), StartDate, 112) + '-' + LEFT(REPLACE(TRANSLATE(CONVERT(CHAR(36), NEWID()), '01', 'KM'), '-', ''), 8);

-- First-rental promotion: only on a customer's earliest contract (UX_Contracts_Customer_FirstPromotion).
;WITH First AS (
    SELECT p.*, r = ROW_NUMBER() OVER (PARTITION BY p.CustomerID ORDER BY p.StartDate, p.PlanID),
        Lucky = DENSE_RANK() OVER (ORDER BY p.CustomerID) % 4
    FROM #P p WHERE p.Kind <> 'Open'
)
UPDATE First SET PromoID = @Promo, Disc = CASE WHEN Rate * 0.1 > 200000 THEN 200000 ELSE Rate * 0.1 END
WHERE r = 1 AND Lucky = 0;

-- =========================================================================
-- 6. RESERVATIONS, CONTRACTS, HANDOVERS
-- =========================================================================

INSERT INTO Reservations (ReservationCode, CustomerID, FacilityID, UnitTypeID, AssignedUnitID, PromotionID, PromotionDiscountAmount,
    ExpectedStartDate, CheckInAppointmentAt, DurationMonths, DepositAmount, EstimatedTotalFee, Status, DepositDeadline, CreatedAt)
SELECT p.ResCode, p.CustomerID, p.FacilityID, p.UnitTypeID, p.UnitID, p.PromoID, p.Disc, p.StartDate,
    CASE WHEN p.Scen LIKE 'Confirmed%' THEN TODATETIMEOFFSET(DATEADD(MINUTE, 540 + (p.H % 16) * 30, CAST(p.StartDate AS DATETIME2(0))), '+07:00') END,
    p.Dur, p.Rate, p.Rate * p.Dur,
    CASE WHEN p.Kind <> 'Open' THEN 'CheckedIn'
        WHEN p.Scen LIKE 'Confirmed%' THEN 'Confirmed'
        WHEN p.Scen = 'PendingDeposit' THEN 'PendingDeposit'
        WHEN p.Scen = 'Expired' THEN 'Expired' ELSE 'Cancelled' END,
    p.ResDeadline, p.ResCreated
FROM #P p;

UPDATE p SET ReservationID = r.ReservationID FROM #P p JOIN Reservations r ON r.ReservationCode = p.ResCode;

INSERT INTO Contracts (ContractNumber, ReservationID, CustomerID, UnitID, StaffCreatedID, PromotionID, StartDate, EndDate,
    MonthlyRentFee, DepositPaid, Status, SignedDate)
SELECT p.HdCode, p.ReservationID, p.CustomerID, p.UnitID, p.StaffID, p.PromoID, p.StartDate, p.EndDate, p.Rate, p.Rate,
    CASE p.Kind WHEN 'History' THEN 'Terminated' ELSE CASE p.Scen WHEN 'Overdue' THEN 'Overdue' ELSE 'Active' END END,
    p.Signed
FROM #P p WHERE p.Kind <> 'Open';

UPDATE p SET ContractID = c.ContractID FROM #P p JOIN Contracts c ON c.ContractNumber = p.HdCode;

UPDATE u SET Status = CASE WHEN p.Scen = 'Overdue' THEN 'OverdueLocked' ELSE 'Rented' END
FROM StorageUnits u JOIN #P p ON p.UnitID = u.UnitID WHERE p.Kind = 'Current';
UPDATE u SET Status = 'UnderMaintenance'
FROM StorageUnits u JOIN #U x ON x.UnitID = u.UnitID WHERE x.H >= 960 AND u.Status = 'Available';

INSERT INTO HandoverRecords (ContractID, StaffID, HandoverType, HandoverDateTime, PhysicalKeyCount, UnitConditionNotes, CustomerSignatureConfirmed, StaffNotes)
SELECT p.ContractID, p.StaffID, 'CHECK_IN', p.Signed, 0,
    CHOOSE(p.H % 3 + 1, N'Tình trạng kho bình thường khi bàn giao', N'Kho sạch, cửa và khóa hoạt động tốt; khách đã kiểm tra cùng nhân viên', N'Sàn và tường khô ráo, không có vết hư hỏng'),
    1, CASE WHEN p.PromoID IS NOT NULL THEN N'Áp dụng ưu đãi khách thuê lần đầu.' END
FROM #P p WHERE p.ContractID IS NOT NULL;

INSERT INTO HandoverRecords (ContractID, StaffID, HandoverType, HandoverDateTime, PhysicalKeyCount, UnitConditionNotes, CustomerSignatureConfirmed, StaffNotes)
SELECT p.ContractID, p.StaffID, 'CHECK_OUT', DATEADD(MINUTE, 600 + p.H % 400, CAST(p.EndDate AS DATETIME2(0))), 0,
    N'Đã xác nhận dọn sạch kho. Kiểm tra 7/7 mục đạt. Không ghi nhận hư hỏng.', 1,
    CASE WHEN p.Scen = 'ClosedEarly' THEN N'Trả kho sớm theo yêu cầu của khách.' END
FROM #P p WHERE p.Kind = 'History';

-- =========================================================================
-- 7. INVOICES AND PAYMENTS
-- =========================================================================

CREATE TABLE #I (
    Seq INT IDENTITY(100001, 1) PRIMARY KEY,
    PlanID INT NOT NULL, ContractID INT NULL, ReservationID INT NULL, CustomerID INT NOT NULL,
    InvType VARCHAR(30) NOT NULL, Qty INT NOT NULL, UnitPrice DECIMAL(18,2) NOT NULL, Disc DECIMAL(18,2) NOT NULL,
    Due DATE NOT NULL, PS DATE NULL, PE DATE NULL, Status VARCHAR(20) NOT NULL,
    CreatedAt DATETIME2(0) NOT NULL, Descr NVARCHAR(255) NOT NULL, FeeTypeID INT NULL,
    PaidAt DATETIME2(0) NULL, Number VARCHAR(35) COLLATE DATABASE_DEFAULT NULL, InvoiceID INT NULL
);

-- Deposits
INSERT INTO #I (PlanID, ReservationID, CustomerID, InvType, Qty, UnitPrice, Disc, Due, Status, CreatedAt, Descr, PaidAt)
SELECT p.PlanID, p.ReservationID, p.CustomerID, 'DEPOSIT', 1, p.Rate, 0, CAST(p.ResDeadline AS DATE),
    CASE WHEN p.Scen = 'PendingDeposit' THEN 'Unpaid' WHEN p.Scen IN ('Expired', 'CancelledUnpaid') THEN 'Cancelled' ELSE 'Paid' END,
    p.ResCreated, N'Tiền cọc 100% giá thuê tháng cho đơn ' + p.ResCode,
    CASE WHEN p.Scen NOT IN ('PendingDeposit', 'Expired', 'CancelledUnpaid') THEN DATEADD(MINUTE, 5 + p.H % 180, p.ResCreated) END
FROM #P p;

-- Monthly rent: every period through today + 7 days, as MonthlyRentInvoiceService would have created them.
INSERT INTO #I (PlanID, ContractID, CustomerID, InvType, Qty, UnitPrice, Disc, Due, PS, PE, Status, CreatedAt, Descr, PaidAt)
SELECT p.PlanID, p.ContractID, p.CustomerID, 'MONTHLY_RENT', 1, p.Rate, CASE WHEN k.n = 0 THEN p.Disc ELSE 0 END,
    x.PS, x.PS, x.PE, s.Status,
    CASE WHEN k.n = 0 THEN p.Signed ELSE DATEADD(HOUR, 6, CAST(DATEADD(DAY, -7, x.PS) AS DATETIME2(0))) END,
    N'Tiền thuê kỳ ' + CONVERT(CHAR(10), x.PS, 103) + N' - ' + CONVERT(CHAR(10), x.PE, 103) + N' cho hợp đồng ' + p.HdCode,
    CASE WHEN s.Status = 'Paid' THEN
        CASE WHEN k.n = 0 THEN DATEADD(MINUTE, 15 + p.H % 90, p.Signed)
            WHEN y.At > @Now THEN DATEADD(MINUTE, -(20 + p.H % 90), @Now)
            ELSE y.At END END
FROM #P p
JOIN #N k ON DATEADD(MONTH, k.n, p.StartDate) < COALESCE(CASE WHEN p.Scen = 'Renewed' THEN p.OldEnd END, p.EndDate)
    AND DATEADD(MONTH, k.n, p.StartDate) <= DATEADD(DAY, 7, @Today)
CROSS APPLY (SELECT PS = DATEADD(MONTH, k.n, p.StartDate),
    PE = CASE WHEN DATEADD(MONTH, k.n + 1, p.StartDate) > p.EndDate THEN p.EndDate ELSE DATEADD(MONTH, k.n + 1, p.StartDate) END) x
CROSS APPLY (SELECT Status = CASE
    WHEN x.PS > @Today THEN 'Unpaid'
    WHEN p.Scen = 'Late' AND DATEADD(MONTH, k.n + 1, p.StartDate) > @Today THEN CASE WHEN x.PS < @Today THEN 'Overdue' ELSE 'Unpaid' END
    ELSE 'Paid' END) s
CROSS APPLY (SELECT At = DATEADD(MINUTE, 420 + (p.H + k.n * 137) % 800, CAST(DATEADD(DAY, -((p.H + k.n) % 4), x.PS) AS DATETIME2(0)))) y
WHERE p.ContractID IS NOT NULL;

-- Renewals
INSERT INTO #I (PlanID, ContractID, CustomerID, InvType, Qty, UnitPrice, Disc, Due, Status, CreatedAt, Descr, PaidAt)
SELECT p.PlanID, p.ContractID, p.CustomerID, 'RENEWAL', p.Ext, p.Rate, 0, p.OldEnd,
    CASE p.Scen WHEN 'Renewed' THEN 'Paid' ELSE 'Unpaid' END,
    r.RequestedAt,
    N'Phí gia hạn ' + CAST(p.Ext AS NVARCHAR(3)) + N' tháng cho hợp đồng ' + p.HdCode,
    CASE p.Scen WHEN 'Renewed' THEN DATEADD(MINUTE, 10 + p.H % 200, r.RequestedAt) END
FROM #P p
CROSS APPLY (SELECT RequestedAt = CASE p.Scen
    WHEN 'Renewed' THEN DATEADD(MINUTE, 500 + p.H % 500, CAST(DATEADD(DAY, -(3 + p.H % 10), p.OldEnd) AS DATETIME2(0)))
    ELSE DATEADD(MINUTE, -(60 + p.H % 2000), @Now) END) r
WHERE p.Scen IN ('Renewed', 'RenewPending');

-- Extra charges raised by a facility
INSERT INTO #I (PlanID, ContractID, CustomerID, InvType, Qty, UnitPrice, Disc, Due, Status, CreatedAt, Descr, FeeTypeID, PaidAt)
SELECT p.PlanID, p.ContractID, p.CustomerID, 'EXTRA_CHARGE', 1, fee.DefaultAmount, 0,
    CASE WHEN p.Seq % 2 = 0 THEN DATEADD(DAY, -2, @Today) ELSE DATEADD(DAY, 5, @Today) END,
    CASE WHEN p.Seq % 2 = 0 THEN 'Paid' ELSE 'Unpaid' END,
    DATEADD(DAY, -(3 + p.H % 3), @Now), fee.FeeName + N': ' + CHOOSE(p.Seq % 3 + 1, N'khách báo mất tại quầy', N'cấp lại theo yêu cầu của khách', N'theo biên bản ngày ' + CONVERT(CHAR(10), DATEADD(DAY, -3, @Today), 103)),
    fee.FeeTypeID,
    CASE WHEN p.Seq % 2 = 0 THEN DATEADD(HOUR, -(30 + p.H % 20), @Now) END
FROM #P p
JOIN FeeConfigurations fee ON fee.FeeCode = CASE p.Seq % 3 WHEN 0 THEN 'LOST_KEY_FEE' WHEN 1 THEN 'LOST_CARD_FEE' ELSE 'LOCK_REPLACE_FEE' END
WHERE p.Scen = 'Normal' AND p.Seq % 9 = 3;

UPDATE #I SET Number = 'INV-' + FORMAT(CreatedAt, 'yyyyMMddHHmmss', 'en-US') + '-' + CAST(Seq AS VARCHAR(6));

INSERT INTO Invoices (InvoiceNumber, ContractID, ReservationID, CustomerID, InvoiceType, SubTotal, DiscountAmount, DueDate,
    BillingPeriodStart, BillingPeriodEnd, Status, CreatedAt)
SELECT Number, ContractID, ReservationID, CustomerID, InvType, Qty * UnitPrice, Disc, Due, PS, PE, Status, CreatedAt FROM #I;

UPDATE i SET InvoiceID = v.InvoiceID FROM #I i JOIN Invoices v ON v.InvoiceNumber = i.Number;

INSERT INTO InvoiceDetails (InvoiceID, FeeTypeID, Description, Quantity, UnitPrice)
SELECT InvoiceID, FeeTypeID, Descr, Qty, UnitPrice FROM #I;

-- This project takes customer payments through VNPay.
INSERT INTO Payments (InvoiceID, PaymentMethod, TransactionCode, AmountPaid, PaymentDate, Status)
SELECT InvoiceID, 'VNPay', LOWER(REPLACE(CONVERT(CHAR(36), NEWID()), '-', '')), Qty * UnitPrice - Disc, PaidAt, 'Success'
FROM #I WHERE PaidAt IS NOT NULL;

-- Deposit refunds: at return (minus the early-return fee) and for cancellations (minus the 10% cancellation fee).
DECLARE @EarlyFee DECIMAL(18,2) = (SELECT DefaultAmount FROM FeeConfigurations WHERE FeeCode = 'EARLY_RETURN_FEE');

INSERT INTO Payments (InvoiceID, ReceivedByStaffID, PaymentMethod, TransactionCode, AmountPaid, PaymentDate, Status, PaymentNotes)
SELECT i.InvoiceID, p.StaffID, 'BankTransfer', 'HTC' + CAST(i.Seq AS VARCHAR(6)) + RIGHT('000' + CAST(p.H AS VARCHAR(3)), 3),
    x.Amount,
    DATEADD(MINUTE, 540 + p.H % 400, CAST(DATEADD(DAY, 1 + p.H % 2, x.Base) AS DATETIME2(0))),
    'Refunded', x.Note
FROM #P p
JOIN #I i ON i.PlanID = p.PlanID AND i.InvType = 'DEPOSIT'
CROSS APPLY (SELECT
    Base = p.EndDate,
    Amount = p.Rate - CASE WHEN p.Scen = 'ClosedEarly' THEN CASE WHEN @EarlyFee > p.Rate THEN p.Rate ELSE @EarlyFee END ELSE 0 END,
    Note = CASE WHEN p.Scen = 'ClosedEarly' THEN N'Hoàn cọc sau khi trừ phí trả kho sớm' ELSE N'Hoàn cọc khi trả kho' END) x
WHERE p.Kind = 'History' AND x.Amount > 0
UNION ALL
SELECT i.InvoiceID, p.StaffID, 'BankTransfer', 'HTC' + CAST(i.Seq AS VARCHAR(6)) + RIGHT('000' + CAST(p.H AS VARCHAR(3)), 3),
    p.Rate * 0.9, DATEADD(MINUTE, 600 + p.H % 300, CAST(DATEADD(DAY, 1, p.ResCreated) AS DATETIME2(0))), 'Refunded',
    N'Hoàn cọc sau khi trừ phí hủy 10%'
FROM #P p
JOIN #I i ON i.PlanID = p.PlanID AND i.InvType = 'DEPOSIT'
WHERE p.Scen = 'CancelledPaid';

-- =========================================================================
-- 8. RENEWALS, OVERDUE, EARLY RETURNS, CANCELLATIONS
-- =========================================================================

INSERT INTO ContractRenewals (ContractID, ApprovedByStaffID, OldEndDate, NewEndDate, ExtensionMonths, RenewalFee, Status, RequestedAt, ProcessedAt, InvoiceID)
SELECT p.ContractID, CASE p.Scen WHEN 'Renewed' THEN p.StaffID END, p.OldEnd,
    CASE p.Scen WHEN 'Renewed' THEN p.EndDate ELSE DATEADD(MONTH, p.Ext, p.OldEnd) END,
    p.Ext, p.Rate * p.Ext, CASE p.Scen WHEN 'Renewed' THEN 'Paid' ELSE 'Pending' END,
    i.CreatedAt, i.PaidAt, i.InvoiceID
FROM #P p JOIN #I i ON i.PlanID = p.PlanID AND i.InvType = 'RENEWAL';

INSERT INTO OverdueRecords (ContractID, DaysOverdue, AccumulatedLateFee, LockAppliedDate, NoticeSentDate, ActionTaken, Notes)
SELECT p.ContractID, x.Days, fee.DefaultAmount * x.Days, x.LockAt, x.LockAt, 'UnitLocked',
    N'Phí lưu kho quá hạn ' + FORMAT(fee.DefaultAmount, 'N2', 'en-US') + N'đ/ngày, cấn trừ tự động vào tiền cọc.'
FROM #P p
CROSS JOIN (SELECT TOP 1 DefaultAmount FROM FeeConfigurations WHERE FeeCode = 'LATE_FEE_DAILY') fee
CROSS APPLY (SELECT LockAt = DATEADD(DAY, pol.MaxOverdueDaysBeforeLock, DATEADD(HOUR, 20, CAST(p.EndDate AS DATETIME2(0))))
    FROM (SELECT TOP 1 MaxOverdueDaysBeforeLock FROM RentalPolicies WHERE IsActive = 1 ORDER BY CASE WHEN FacilityID = p.FacilityID THEN 0 ELSE 1 END, PolicyID) pol) l
CROSS APPLY (SELECT l.LockAt, Days = 1 + DATEDIFF(MINUTE, l.LockAt, @Now) / 1440) x
WHERE p.Scen = 'Overdue' AND @Now >= l.LockAt;

INSERT INTO EarlyReturnRequests (ContractID, CustomerID, ReturnDate, Reason, EarlyReturnFee, Status, RequestedAt, CompletedByStaffID, CompletedAt)
SELECT p.ContractID, p.CustomerID, CASE p.Kind WHEN 'History' THEN p.EndDate ELSE DATEADD(DAY, 3 + p.H % 10, @Today) END,
    CHOOSE(p.H % 4 + 1, N'Chuyển nhà sang tỉnh khác', N'Đã thanh lý hết hàng lưu trữ', N'Công ty đổi địa điểm kinh doanh', N'Không còn nhu cầu lưu trữ'),
    @EarlyFee, CASE p.Kind WHEN 'History' THEN 'Completed' ELSE 'Pending' END,
    CASE p.Kind WHEN 'History' THEN DATEADD(HOUR, 10, CAST(DATEADD(DAY, -5, p.EndDate) AS DATETIME2(0))) ELSE DATEADD(HOUR, -(5 + p.H % 40), @Now) END,
    CASE p.Kind WHEN 'History' THEN p.StaffID END,
    CASE p.Kind WHEN 'History' THEN DATEADD(HOUR, 15, CAST(p.EndDate AS DATETIME2(0))) END
FROM #P p WHERE p.Scen IN ('Early', 'ClosedEarly');

INSERT INTO ReservationCancellationRequests (ReservationID, CustomerID, Reason, Status, RequestedAt, ResolvedByStaffID, ResolvedAt, ResolutionNotes, ApprovedRefundAmount)
SELECT p.ReservationID, p.CustomerID,
    CHOOSE(p.H % 3 + 1, N'Thay đổi kế hoạch chuyển nhà', N'Đã tìm được chỗ lưu trữ khác', N'Chưa sắp xếp được thời gian đến nhận kho'),
    CASE p.Scen WHEN 'CancelledPaid' THEN 'Approved' ELSE 'Pending' END,
    CASE p.Scen WHEN 'CancelledPaid' THEN DATEADD(HOUR, 6, p.ResCreated) ELSE DATEADD(MINUTE, -(90 + p.H % 300), @Now) END,
    CASE p.Scen WHEN 'CancelledPaid' THEN p.StaffID END,
    CASE p.Scen WHEN 'CancelledPaid' THEN DATEADD(HOUR, 24, p.ResCreated) END,
    CASE p.Scen WHEN 'CancelledPaid' THEN N'Đã duyệt hủy đơn, hoàn cọc sau khi trừ phí hủy 10%.' END,
    CASE p.Scen WHEN 'CancelledPaid' THEN p.Rate * 0.9 END
FROM #P p WHERE p.Scen IN ('CancelledPaid', 'ConfirmedCancelling');

-- =========================================================================
-- 9. PEOPLE ALLOWED IN, VISITS, GATE RECORDS
-- =========================================================================

INSERT INTO AuthorizedPersons (ContractID, FullName, PhoneNumber, CitizenID, Relationship, Status, CreatedAt, RevokedAt)
SELECT p.ContractID, c.FullName,
    '09' + RIGHT('00000000' + CAST((p.PlanID * 104729 + 5150) % 100000000 AS VARCHAR(8)), 8),
    '079' + CAST(p.H % 2 AS CHAR(1)) + CAST(80 + p.H % 20 AS CHAR(2)) + RIGHT('000000' + CAST((p.PlanID * 69621) % 1000000 AS VARCHAR(6)), 6),
    CHOOSE(p.H % 5 + 1, N'Vợ/chồng', N'Anh/chị/em', N'Con', N'Nhân viên công ty', N'Bạn bè'),
    CASE WHEN p.Seq % 15 = 0 THEN 'Revoked' ELSE 'Active' END,
    DATEADD(DAY, 2, p.Signed),
    CASE WHEN p.Seq % 15 = 0 THEN CASE WHEN DATEADD(DAY, 20, p.Signed) > @Now THEN @Now ELSE DATEADD(DAY, 20, p.Signed) END END
FROM #P p
JOIN #Cust c ON c.N = (p.Seq * 7) % 78 + 1
WHERE p.Kind = 'Current' AND p.Seq % 3 = 0 AND c.UserID <> p.CustomerID;

CREATE TABLE #V (
    PlanID INT NOT NULL, ContractID INT NOT NULL, CustomerID INT NOT NULL, FacilityID INT NOT NULL, UnitID INT NOT NULL, StaffID INT NOT NULL,
    EntryAt DATETIME2(0) NOT NULL, ExitAt DATETIME2(0) NOT NULL, Purpose NVARCHAR(255) NOT NULL, Status VARCHAR(20) NOT NULL,
    Notes NVARCHAR(500) NULL, Inside BIT NOT NULL DEFAULT 0, VisitID BIGINT NULL
);

-- Past visits; every contract in good standing gets up to four.
INSERT INTO #V (PlanID, ContractID, CustomerID, FacilityID, UnitID, StaffID, EntryAt, ExitAt, Purpose, Status, Notes)
SELECT DISTINCT p.PlanID, p.ContractID, p.CustomerID, p.FacilityID, p.UnitID, p.StaffID, e.At, DATEADD(MINUTE, 120, e.At),
    CHOOSE((p.H + k.n) % 4 + 1, N'Gửi thêm đồ vào kho', N'Lấy đồ ra khỏi kho', N'Kiểm tra hàng hóa', N'Sắp xếp lại kho'),
    CASE WHEN (p.H + k.n) % 17 = 0 THEN 'Rejected' WHEN (p.H + k.n) % 13 = 0 THEN 'Cancelled' ELSE 'Approved' END,
    CASE WHEN (p.H + k.n) % 17 = 0 THEN N'Khung giờ đã kín lịch, vui lòng chọn giờ khác.' END
FROM #P p
JOIN #N k ON k.n < 1 + p.H % 4
CROSS APPLY (SELECT At = DATEADD(MINUTE, 450 + (p.H * (k.n + 3)) % 660,
    CAST(DATEADD(DAY, -(1 + (p.H * (k.n + 1) + k.n * 11) % 60), @Today) AS DATETIME2(0)))) e
WHERE p.Kind = 'Current' AND p.Scen IN ('Normal', 'Renewed', 'Ending', 'Early') AND CAST(e.At AS DATE) > p.StartDate;

-- Upcoming visits, for the staff approval queue.
INSERT INTO #V (PlanID, ContractID, CustomerID, FacilityID, UnitID, StaffID, EntryAt, ExitAt, Purpose, Status)
SELECT p.PlanID, p.ContractID, p.CustomerID, p.FacilityID, p.UnitID, p.StaffID, e.At, DATEADD(MINUTE, 90, e.At),
    CHOOSE(p.H % 3 + 1, N'Lấy tài liệu trong kho', N'Chuyển hàng vào kho', N'Kiểm tra định kỳ'),
    CASE WHEN p.H % 3 = 0 THEN 'Approved' ELSE 'Pending' END
FROM #P p
CROSS APPLY (SELECT At = DATEADD(MINUTE, 480 + p.H % 540, CAST(DATEADD(DAY, 1 + p.H % 4, @Today) AS DATETIME2(0)))) e
WHERE p.Scen = 'Normal' AND p.Seq % 4 = 1 AND CAST(DATEADD(MINUTE, 90, e.At) AS DATE) < p.EndDate;

-- A few people inside the building right now, during opening hours only.
IF DATEPART(HOUR, @Now) BETWEEN 7 AND 20
    INSERT INTO #V (PlanID, ContractID, CustomerID, FacilityID, UnitID, StaffID, EntryAt, ExitAt, Purpose, Status, Inside)
    SELECT p.PlanID, p.ContractID, p.CustomerID, p.FacilityID, p.UnitID, p.StaffID,
        DATEADD(MINUTE, -(15 + p.H % 40), @Now), DATEADD(MINUTE, 60, @Now), N'Sắp xếp lại kho', 'Approved', 1
    FROM #P p WHERE p.Scen = 'Normal' AND p.Seq % 12 = 3;

;WITH Dup AS (SELECT rn = ROW_NUMBER() OVER (PARTITION BY ContractID, EntryAt ORDER BY Purpose) FROM #V)
DELETE FROM Dup WHERE rn > 1;

DELETE v FROM #V v
WHERE EXISTS (SELECT 1 FROM #V o WHERE o.ContractID = v.ContractID AND o.EntryAt < v.ExitAt AND v.EntryAt < o.ExitAt AND o.EntryAt < v.EntryAt);

INSERT INTO VisitRegistrations (ContractID, CustomerID, ScheduledEntryAt, ScheduledExitAt, Purpose, Status, RequestedAt, ReviewedByStaffID, ReviewedAt, ReviewNotes)
SELECT v.ContractID, v.CustomerID, TODATETIMEOFFSET(v.EntryAt, '+07:00'), TODATETIMEOFFSET(v.ExitAt, '+07:00'), v.Purpose, v.Status,
    x.RequestedAt,
    CASE WHEN v.Status IN ('Approved', 'Rejected') THEN v.StaffID END,
    CASE WHEN v.Status IN ('Approved', 'Rejected') THEN DATEADD(MINUTE, 35, x.RequestedAt) END,
    v.Notes
FROM #V v
CROSS APPLY (SELECT RequestedAt = CASE WHEN v.EntryAt > @Now THEN DATEADD(HOUR, -(2 + v.PlanID % 20), @Now) ELSE DATEADD(HOUR, -(4 + v.PlanID % 40), v.EntryAt) END) x;

UPDATE v SET VisitID = r.VisitRegistrationID
FROM #V v JOIN VisitRegistrations r ON r.ContractID = v.ContractID AND r.ScheduledEntryAt = TODATETIMEOFFSET(v.EntryAt, '+07:00');

INSERT INTO AccessRecords (ContractID, VisitRegistrationID, FacilityID, UnitID, VerifiedByStaffID, VerificationMethod, Result, Purpose, EntryTime, ExitTime, ExitConfirmedByStaffID)
SELECT v.ContractID, v.VisitID, v.FacilityID, v.UnitID, v.StaffID, 'CitizenID', 'Granted', v.Purpose,
    CASE v.Inside WHEN 1 THEN v.EntryAt ELSE DATEADD(MINUTE, 6, v.EntryAt) END,
    CASE v.Inside WHEN 1 THEN NULL ELSE DATEADD(MINUTE, 40 + v.PlanID % 70, v.EntryAt) END,
    CASE v.Inside WHEN 1 THEN NULL ELSE v.StaffID END
FROM #V v WHERE v.Status = 'Approved' AND v.EntryAt <= @Now;

-- Turned away at the gate.
INSERT INTO AccessRecords (ContractID, FacilityID, UnitID, VerifiedByStaffID, VerificationMethod, Result, DenyReason, EntryTime, Notes)
SELECT p.ContractID, p.FacilityID, p.UnitID, p.StaffID, 'CitizenID', 'Denied', x.Reason, DATEADD(MINUTE, 500 + p.H % 500, CAST(DATEADD(DAY, -(1 + p.H % 3), @Today) AS DATETIME2(0))), x.Note
FROM #P p
CROSS APPLY (SELECT
    Reason = CASE p.Scen WHEN 'Overdue' THEN 'OverdueLocked' WHEN 'Late' THEN 'OverdueLocked' ELSE 'IdentityMismatch' END,
    Note = CASE p.Scen WHEN 'Normal' THEN N'Số CCCD không khớp với hồ sơ, đã hướng dẫn khách đăng ký người vào kho.' ELSE N'Còn khoản quá hạn, đã hướng dẫn khách thanh toán.' END) x
WHERE p.Scen IN ('Overdue', 'Late') OR (p.Scen = 'Normal' AND p.Seq % 11 = 4);

-- =========================================================================
-- 10. MAINTENANCE AND SUPPORT
-- =========================================================================

INSERT INTO MaintenanceRecords (UnitID, AssignedStaffID, MaintenanceType, Description, Cost, Status, ScheduledDate, Notes)
SELECT x.UnitID, f.StaffA,
    CHOOSE(x.H % 4 + 1, N'Sửa cửa cuốn', N'Xử lý thấm tường', N'Thay ổ khóa', N'Bảo dưỡng điều hòa'),
    CHOOSE(x.H % 4 + 1, N'Cửa cuốn kẹt ray, cần căn chỉnh và tra dầu.', N'Phát hiện vết thấm ở tường sau, cần chống thấm trước khi cho thuê lại.', N'Ổ khóa kẹt sau nhiều lần sử dụng, cần thay mới.', N'Bảo dưỡng định kỳ hệ thống kiểm soát nhiệt độ và độ ẩm.'),
    CASE WHEN x.H % 2 = 0 THEN 1500000 ELSE 0 END,
    CASE WHEN x.H % 2 = 0 THEN 'InProgress' ELSE 'Scheduled' END,
    DATEADD(DAY, CASE WHEN x.H % 2 = 0 THEN -2 ELSE 3 END, @Today),
    CASE WHEN x.H % 2 = 0 THEN N'Đã liên hệ đơn vị sửa chữa.' END
FROM #U x JOIN #F f ON f.FacilityID = x.FacilityID
WHERE x.H >= 960 AND NOT EXISTS (SELECT 1 FROM #P p WHERE p.UnitID = x.UnitID AND p.Kind = 'Current');

INSERT INTO MaintenanceRecords (UnitID, AssignedStaffID, MaintenanceType, Description, Cost, Status, ScheduledDate, CompletedDate, Notes)
SELECT x.UnitID, f.StaffB, N'Kiểm tra định kỳ', N'Kiểm tra cửa, khóa, đèn và hệ thống báo cháy của kho.',
    250000 + (x.H % 5) * 50000, 'Completed', DATEADD(DAY, -(20 + x.H % 120), @Today),
    DATEADD(HOUR, 16, CAST(DATEADD(DAY, -(20 + x.H % 120), @Today) AS DATETIME2(0))), N'Đạt yêu cầu.'
FROM #U x JOIN #F f ON f.FacilityID = x.FacilityID
WHERE x.UnitID % 6 = 0 AND x.H < 960;

CREATE TABLE #Sup (K INT, Category VARCHAR(50) COLLATE DATABASE_DEFAULT, Priority VARCHAR(20), Title NVARCHAR(200), Body NVARCHAR(1000), Status VARCHAR(25), DaysAgo INT, Reply NVARCHAR(500), Result NVARCHAR(500), RequestID INT NULL, Code VARCHAR(30) COLLATE DATABASE_DEFAULT NULL, PlanID INT NULL);
INSERT INTO #Sup (K, Category, Priority, Title, Body, Status, DaysAgo, Reply, Result) VALUES
(1,  'LockIssue',        'High',   N'Ổ khóa kho bị kẹt, không mở được', N'Sáng nay tôi đến kho nhưng chìa khóa không xoay được. Tôi cần lấy hàng gấp trong hôm nay.', 'InProgress', 0, N'Nhân viên kỹ thuật đang đến kiểm tra ổ khóa tại kho.', NULL),
(2,  'LockIssue',        'Medium', N'Khóa kho khó đóng', N'Khi đóng cửa kho, chốt khóa phải đẩy nhiều lần mới vào. Nhờ cơ sở kiểm tra giúp.', 'Open', 1, NULL, NULL),
(3,  'AccessCodeIssue',  'Medium', N'Người nhà không vào được kho', N'Tôi đã thêm vợ vào danh sách người vào kho nhưng hôm qua quầy báo chưa có thông tin.', 'Resolved', 6, N'Đang đối chiếu thông tin CCCD đã đăng ký trên hợp đồng.', N'Thông tin đã được cập nhật đúng, người nhà của khách đã vào kho bình thường.'),
(4,  'DamagedUnit',      'Urgent', N'Có nước thấm vào kho sau cơn mưa', N'Góc sau của kho bị ướt, một số thùng carton đã ẩm. Nhờ cơ sở xử lý gấp để tránh hỏng hàng.', 'InProgress', 1, N'Đã ghi nhận hiện trạng và chuyển bộ phận bảo trì xử lý trong ngày.', NULL),
(5,  'DamagedUnit',      'Medium', N'Đèn hành lang khu kho không sáng', N'Đèn hành lang phía trước kho của tôi bị hỏng, buổi tối khó thao tác.', 'Closed', 18, N'Đã báo bộ phận bảo trì thay đèn.', N'Đã thay đèn mới, khách xác nhận hoạt động tốt.'),
(6,  'PaymentIssue',     'High',   N'Đã thanh toán nhưng hóa đơn vẫn chưa cập nhật', N'Tôi đã thanh toán qua VNPay, tài khoản bị trừ tiền nhưng hóa đơn vẫn hiện chưa thanh toán.', 'Resolved', 4, N'Đang đối soát giao dịch với cổng thanh toán.', N'Giao dịch đã được xác nhận, hóa đơn đã cập nhật trạng thái đã thanh toán.'),
(7,  'PaymentIssue',     'Low',    N'Xin bản sao hóa đơn tháng trước', N'Nhờ cơ sở gửi lại bản sao hóa đơn tiền thuê tháng trước để công ty tôi quyết toán.', 'Open', 0, NULL, NULL),
(8,  'StoredItemsIssue', 'High',   N'Cần xác minh một thùng hàng trong kho', N'Lần kiểm tra gần nhất tôi không thấy một thùng hàng. Nhờ kiểm tra lịch sử ra vào giúp tôi.', 'InProgress', 2, N'Đã trích lịch sử ra vào của hợp đồng để đối chiếu cùng khách.', NULL),
(9,  'StoredItemsIssue', 'Medium', N'Hỏi về việc lưu trữ đồ điện tử', N'Kho của tôi có phù hợp để lưu trữ tivi và máy tính trong 6 tháng không?', 'Closed', 25, N'Đã tư vấn điều kiện bảo quản phù hợp.', N'Khách đồng ý chuyển sang đóng gói chống ẩm theo hướng dẫn.'),
(10, 'Other',            'Low',    N'Tư vấn đổi sang kho lớn hơn', N'Tôi muốn đổi sang kho rộng hơn tại cùng cơ sở khi hết hợp đồng, nhờ tư vấn thủ tục.', 'Open', 2, NULL, NULL),
(11, 'Other',            'Medium', N'Hỏi về giờ hoạt động ngày lễ', N'Cơ sở có mở cửa vào dịp lễ sắp tới không? Tôi dự định đến lấy đồ vào đầu tháng.', 'Resolved', 9, N'Đang xác nhận lịch hoạt động với quản lý cơ sở.', N'Đã thông báo cơ sở hoạt động bình thường trong dịp lễ.'),
(12, 'LockIssue',        'Medium', N'Mất chìa khóa kho', N'Tôi làm mất chìa khóa kho, cần được hướng dẫn cấp lại.', 'Closed', 32, N'Đã hướng dẫn khách làm thủ tục cấp lại và phí áp dụng.', N'Đã cấp lại chìa khóa cho khách.');

;WITH Pick AS (
    SELECT PlanID, rn = ROW_NUMBER() OVER (ORDER BY Seq) FROM #P WHERE Kind = 'Current' AND Scen IN ('Normal', 'Renewed')
)
UPDATE s SET PlanID = pick.PlanID,
    Code = 'SUP-' + CONVERT(CHAR(8), DATEADD(DAY, -s.DaysAgo, @Today), 112) + '-' + LEFT(REPLACE(TRANSLATE(CONVERT(CHAR(36), NEWID()), '01', 'KM'), '-', ''), 8)
FROM #Sup s JOIN Pick pick ON pick.rn = s.K * 5;

INSERT INTO SupportRequests (RequestCode, CustomerID, FacilityID, ContractID, UnitID, AssignedStaffID, Category, Priority, Title, Description, Status, CreatedAt, ResolvedAt)
SELECT s.Code, p.CustomerID, p.FacilityID, p.ContractID, p.UnitID, CASE WHEN s.Status <> 'Open' THEN p.StaffID END,
    s.Category, s.Priority, s.Title, s.Body, s.Status, x.At,
    CASE WHEN s.Status IN ('Resolved', 'Closed') THEN DATEADD(HOUR, 26, x.At) END
FROM #Sup s JOIN #P p ON p.PlanID = s.PlanID
CROSS APPLY (SELECT At = DATEADD(MINUTE, -(35 + p.H % 200), DATEADD(DAY, -s.DaysAgo, @Now))) x;

UPDATE s SET RequestID = r.RequestID FROM #Sup s JOIN SupportRequests r ON r.RequestCode = s.Code;

INSERT INTO SupportUpdates (RequestID, UpdatedByUserID, ActionMessage, PreviousStatus, NewStatus, CreatedAt)
SELECT s.RequestID, p.StaffID, s.Reply, 'Open', 'InProgress', DATEADD(MINUTE, 25, r.CreatedAt)
FROM #Sup s JOIN #P p ON p.PlanID = s.PlanID JOIN SupportRequests r ON r.RequestID = s.RequestID
WHERE s.Reply IS NOT NULL
UNION ALL
SELECT s.RequestID, p.StaffID, s.Result, 'InProgress', s.Status, r.ResolvedAt
FROM #Sup s JOIN #P p ON p.PlanID = s.PlanID JOIN SupportRequests r ON r.RequestID = s.RequestID
WHERE s.Result IS NOT NULL;

-- Same checklists as SupportController.ChecklistTemplates.
SELECT * INTO #Tpl FROM (VALUES
    ('LockIssue', 1, N'Xác minh khách hàng và mã kho'), ('LockIssue', 2, N'Kiểm tra tình trạng khóa tại chỗ'), ('LockIssue', 3, N'Thử khóa và mở kho cùng khách'),
    ('AccessCodeIssue', 1, N'Xác minh khách hàng hoặc người được ủy quyền'), ('AccessCodeIssue', 2, N'Kiểm tra quyền truy cập còn hiệu lực'),
    ('AccessCodeIssue', 3, N'Hướng dẫn hoặc cấp lại mã truy cập'), ('AccessCodeIssue', 4, N'Xác nhận khách truy cập được'),
    ('DamagedUnit', 1, N'Ghi nhận vị trí và tình trạng hư hỏng'), ('DamagedUnit', 2, N'Đánh giá nguy cơ an toàn và tài sản'),
    ('DamagedUnit', 3, N'Ghi nhận bằng chứng và báo quản lý/bảo trì'), ('DamagedUnit', 4, N'Thông báo phương án xử lý cho khách'),
    ('PaymentIssue', 1, N'Đối chiếu hóa đơn và mã giao dịch'), ('PaymentIssue', 2, N'Kiểm tra trạng thái giao dịch với bộ phận phụ trách'), ('PaymentIssue', 3, N'Thông báo kết quả và bước tiếp theo cho khách'),
    ('StoredItemsIssue', 1, N'Xác minh khách hàng và mã kho'), ('StoredItemsIssue', 2, N'Ghi nhận tình trạng và vị trí hàng hóa'),
    ('StoredItemsIssue', 3, N'Kiểm tra lịch sử ra vào liên quan'), ('StoredItemsIssue', 4, N'Thống nhất phương án hỗ trợ với khách'),
    ('Other', 1, N'Liên hệ và xác nhận vấn đề với khách'), ('Other', 2, N'Ghi nhận kết quả kiểm tra'), ('Other', 3, N'Thống nhất và thông báo hướng xử lý cho khách')
) v (Category, SortOrder, Description);

INSERT INTO SupportChecklistItems (RequestID, SortOrder, Description, IsCompleted, CompletedByStaffID, CompletedAt)
SELECT s.RequestID, t.SortOrder, t.Description, x.Done, CASE x.Done WHEN 1 THEN p.StaffID END, CASE x.Done WHEN 1 THEN DATEADD(MINUTE, 30 + t.SortOrder * 15, r.CreatedAt) END
FROM #Sup s
JOIN #P p ON p.PlanID = s.PlanID
JOIN SupportRequests r ON r.RequestID = s.RequestID
JOIN #Tpl t ON t.Category = s.Category
CROSS APPLY (SELECT Done = CAST(CASE WHEN s.Status IN ('Resolved', 'Closed') OR (s.Status = 'InProgress' AND t.SortOrder = 1) THEN 1 ELSE 0 END AS BIT)) x;

-- =========================================================================
-- 11. ACTIVITY LOG
-- =========================================================================

INSERT INTO ActivityLogs (UserID, Action, IPAddress, Details, CreatedAt)
SELECT v.StaffID, 'VisitRegistrationApproved', NULL, CONCAT('VisitRegistration ', v.VisitID, ' for contract ', p.HdCode), DATEADD(MINUTE, -30, v.EntryAt)
FROM #V v JOIN #P p ON p.PlanID = v.PlanID WHERE v.Status = 'Approved' AND v.EntryAt <= @Now
UNION ALL
SELECT f.StaffA, 'StorageUnitStatusChanged', '10.0.0.' + CAST(10 + x.H % 40 AS VARCHAR(3)), CONCAT('Unit ', u.UnitCode, ': Available -> UnderMaintenance'), DATEADD(HOUR, -(10 + x.H % 40), @Now)
FROM #U x JOIN StorageUnits u ON u.UnitID = x.UnitID JOIN #F f ON f.FacilityID = x.FacilityID WHERE u.Status = 'UnderMaintenance'
UNION ALL
SELECT p.StaffID, 'ExtraChargeInvoiceCreated', '10.0.0.' + CAST(10 + p.H % 40 AS VARCHAR(3)), CONCAT('Created charge invoice for contract ', p.HdCode), i.CreatedAt
FROM #I i JOIN #P p ON p.PlanID = i.PlanID WHERE i.InvType = 'EXTRA_CHARGE';

-- =========================================================================
-- 12. SUMMARY
-- =========================================================================

SELECT Item, Total FROM (VALUES
    (N'Cơ sở', (SELECT COUNT(*) FROM Facilities)),
    (N'Kho', (SELECT COUNT(*) FROM StorageUnits)),
    (N'Khách hàng', (SELECT COUNT(*) FROM Users u JOIN Roles r ON r.RoleID = u.RoleID WHERE r.RoleName = N'Storage Customer')),
    (N'Nhân viên và quản lý', (SELECT COUNT(*) FROM Users u JOIN Roles r ON r.RoleID = u.RoleID WHERE r.RoleName IN (N'Facility Staff', N'Facility Manager'))),
    (N'Đơn đặt kho', (SELECT COUNT(*) FROM Reservations)),
    (N'Hợp đồng', (SELECT COUNT(*) FROM Contracts)),
    (N'Hóa đơn', (SELECT COUNT(*) FROM Invoices)),
    (N'Giao dịch', (SELECT COUNT(*) FROM Payments)),
    (N'Lượt ra vào', (SELECT COUNT(*) FROM AccessRecords)),
    (N'Yêu cầu hỗ trợ', (SELECT COUNT(*) FROM SupportRequests))
) v (Item, Total);

IF @DryRun = 1
BEGIN
    ROLLBACK TRANSACTION;
    PRINT N'Dry run: rolled back, nothing was saved.';
END
ELSE
BEGIN
    COMMIT TRANSACTION;
    PRINT N'Demo data created.';
END

DROP TABLE IF EXISTS #N, #S, #F, #T, #U, #P, #I, #V, #Sup, #Tpl, #Cust;
GO
