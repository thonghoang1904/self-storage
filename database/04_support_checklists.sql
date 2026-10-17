USE SelfStorageDB;
GO

IF OBJECT_ID(N'dbo.SupportChecklistItems', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SupportChecklistItems
    (
        ChecklistItemID INT IDENTITY(1,1) CONSTRAINT PK_SupportChecklistItems PRIMARY KEY,
        RequestID INT NOT NULL,
        SortOrder INT NOT NULL,
        Description NVARCHAR(300) NOT NULL,
        IsCompleted BIT NOT NULL CONSTRAINT DF_SupportChecklistItems_IsCompleted DEFAULT 0,
        CompletedByStaffID INT NULL,
        CompletedAt DATETIME2 NULL,
        Notes NVARCHAR(1000) NULL,
        CONSTRAINT FK_SupportChecklistItems_Requests
            FOREIGN KEY (RequestID) REFERENCES dbo.SupportRequests(RequestID) ON DELETE CASCADE,
        CONSTRAINT FK_SupportChecklistItems_Staff
            FOREIGN KEY (CompletedByStaffID) REFERENCES dbo.Users(UserID),
        CONSTRAINT CK_SupportChecklistItems_Completion CHECK
        (
            (IsCompleted = 0 AND CompletedByStaffID IS NULL AND CompletedAt IS NULL)
            OR (IsCompleted = 1 AND CompletedByStaffID IS NOT NULL AND CompletedAt IS NOT NULL)
        ),
        CONSTRAINT UQ_SupportChecklistItems_Request_Sort UNIQUE (RequestID, SortOrder)
    );
END
GO

INSERT INTO dbo.SupportChecklistItems (RequestID, SortOrder, Description)
SELECT request.RequestID, item.SortOrder, item.Description
FROM dbo.SupportRequests AS request
CROSS APPLY
(
    VALUES
        (1, N'Xác minh khách hàng và mã kho'),
        (2, N'Ghi nhận vấn đề và kiểm tra hiện trạng'),
        (3, N'Thống nhất và thông báo hướng xử lý cho khách')
) AS item(SortOrder, Description)
WHERE request.Category = 'Other'
  AND NOT EXISTS
  (
      SELECT 1 FROM dbo.SupportChecklistItems AS existing
      WHERE existing.RequestID = request.RequestID AND existing.SortOrder = item.SortOrder
  );

INSERT INTO dbo.SupportChecklistItems (RequestID, SortOrder, Description)
SELECT request.RequestID, item.SortOrder, item.Description
FROM dbo.SupportRequests AS request
CROSS APPLY
(
    VALUES
        (1, N'Xác minh khách hàng và mã kho'),
        (2, N'Kiểm tra tình trạng khóa tại chỗ'),
        (3, N'Thử khóa và mở kho cùng khách')
) AS item(SortOrder, Description)
WHERE request.Category = 'LockIssue'
  AND NOT EXISTS
  (
      SELECT 1 FROM dbo.SupportChecklistItems AS existing
      WHERE existing.RequestID = request.RequestID AND existing.SortOrder = item.SortOrder
  );

INSERT INTO dbo.SupportChecklistItems (RequestID, SortOrder, Description)
SELECT request.RequestID, item.SortOrder, item.Description
FROM dbo.SupportRequests AS request
CROSS APPLY
(
    VALUES
        (1, N'Xác minh khách hàng hoặc người được ủy quyền'),
        (2, N'Kiểm tra quyền truy cập còn hiệu lực'),
        (3, N'Hướng dẫn hoặc cấp lại mã truy cập'),
        (4, N'Xác nhận khách truy cập được')
) AS item(SortOrder, Description)
WHERE request.Category = 'AccessCodeIssue'
  AND NOT EXISTS
  (
      SELECT 1 FROM dbo.SupportChecklistItems AS existing
      WHERE existing.RequestID = request.RequestID AND existing.SortOrder = item.SortOrder
  );

INSERT INTO dbo.SupportChecklistItems (RequestID, SortOrder, Description)
SELECT request.RequestID, item.SortOrder, item.Description
FROM dbo.SupportRequests AS request
CROSS APPLY
(
    VALUES
        (1, N'Ghi nhận vị trí và tình trạng hư hỏng'),
        (2, N'Đánh giá nguy cơ an toàn và tài sản'),
        (3, N'Ghi nhận bằng chứng và báo quản lý/bảo trì'),
        (4, N'Thông báo phương án xử lý cho khách')
) AS item(SortOrder, Description)
WHERE request.Category = 'DamagedUnit'
  AND NOT EXISTS
  (
      SELECT 1 FROM dbo.SupportChecklistItems AS existing
      WHERE existing.RequestID = request.RequestID AND existing.SortOrder = item.SortOrder
  );

INSERT INTO dbo.SupportChecklistItems (RequestID, SortOrder, Description)
SELECT request.RequestID, item.SortOrder, item.Description
FROM dbo.SupportRequests AS request
CROSS APPLY
(
    VALUES
        (1, N'Đối chiếu hóa đơn và mã giao dịch'),
        (2, N'Kiểm tra trạng thái giao dịch với bộ phận phụ trách'),
        (3, N'Thông báo kết quả và bước tiếp theo cho khách')
) AS item(SortOrder, Description)
WHERE request.Category = 'PaymentIssue'
  AND NOT EXISTS
  (
      SELECT 1 FROM dbo.SupportChecklistItems AS existing
      WHERE existing.RequestID = request.RequestID AND existing.SortOrder = item.SortOrder
  );

INSERT INTO dbo.SupportChecklistItems (RequestID, SortOrder, Description)
SELECT request.RequestID, item.SortOrder, item.Description
FROM dbo.SupportRequests AS request
CROSS APPLY
(
    VALUES
        (1, N'Xác minh khách hàng và mã kho'),
        (2, N'Ghi nhận tình trạng và vị trí hàng hóa'),
        (3, N'Kiểm tra lịch sử ra vào liên quan'),
        (4, N'Thống nhất phương án hỗ trợ với khách')
) AS item(SortOrder, Description)
WHERE request.Category = 'StoredItemsIssue'
  AND NOT EXISTS
  (
      SELECT 1 FROM dbo.SupportChecklistItems AS existing
      WHERE existing.RequestID = request.RequestID AND existing.SortOrder = item.SortOrder
  );
GO
