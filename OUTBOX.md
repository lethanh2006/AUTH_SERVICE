# Đồng bộ Auth → User bằng transactional outbox

Các thao tác đăng ký thường, tạo tài khoản Google, đổi email/role và xóa tài khoản (cá nhân/admin) ghi credential và `auth_outbox_events` trong **cùng MongoDB transaction**. Response không chờ RabbitMQ. Lỗi insert outbox rollback thay đổi credential.

`send-otp` vẫn gửi trực tiếp: OTP/session thuộc Redis, không nằm trong transaction MongoDB. Introspect JWT vẫn đọc credential gốc để kiểm tra quyền hiện tại.

## Điều kiện vận hành

- MongoDB phải là replica set hoặc sharded cluster hỗ trợ transaction. MongoDB standalone sẽ từ chối các thao tác ghi trên; không có fallback dual write.
- Credential và outbox dùng cùng Mongoose connection/database theo `MONGO_URL`, `MONGO_DB_NAME`.
- Tài khoản DB cần quyền tạo collection/index. Service khởi tạo index trước khi nhận request.
- RabbitMQ phải hỗ trợ publisher confirms. Queue `user-profile-sync` durable, message persistent và mandatory. Auth kết nối lại nền khi broker mất kết nối và vẫn có thể nhận request ghi DB.
- Triển khai User mới trước Auth mới; để queue message cũ và hàng đợi retry được xử lý hết trước khi bật Auth mới. Khi chuyển đổi, tạm dừng ghi Auth để không phát thêm event cũ trong lúc drain. Consumer User cũ không hiểu version/snapshot nên không được dùng với producer mới.

## Relay và ordering

`AUTH_OUTBOX_INTERVAL_MS` mặc định `1000`, tối thiểu `250`. Mỗi batch claim tối đa 20 record bằng `findOneAndUpdate`, lease 30 giây và token riêng. Worker chỉ đánh dấu `publishedAt` sau broker confirm; failure giữ pending và retry vô hạn với backoff tối đa 300 giây. Token ngăn worker đã mất lease ghi đè trạng thái worker khác.

Nếu broker đã nhận nhưng worker chết trước khi cập nhật DB, event được gửi lại. Delivery là **at least once**. Payload có `eventId`, `userId` (ObjectId gốc dạng string) và `version`; version tăng cùng transaction với credential. DELETE lấy version cuối + 1 trước khi xóa credential.

CREATE/UPDATE mang snapshot email/role và username ban đầu để User dựng được profile khi UPDATE đến trước CREATE. `syncUsername` chỉ phục vụ tạo read model; tên đang hiển thị vẫn thuộc User, không bị Auth ghi đè. Credential cũ chưa có `syncVersion` được bắt đầu ở version 1 khi cập nhật; nếu chưa có `syncUsername`, dùng phần trước `@` làm tên mặc định khi phải dựng lại profile.

TTL tự dọn event đã gửi sau 7 ngày theo `publishedAt`. Record pending không có ngày `publishedAt` nên không bị TTL xóa. Payload không chứa password hash, OTP hay token. Event cũ đã mất trước khi áp dụng outbox không tự được phục hồi; cần đối soát riêng nếu hai DB vốn đã lệch.

## Theo dõi

Trong đúng Auth database:

```javascript
db.auth_outbox_events.countDocuments({ publishedAt: null });
db.auth_outbox_events.find({ publishedAt: null })
  .sort({ createdAt: 1 }).limit(20)
  .project({ eventId: 1, aggregateId: 1, attempts: 1, nextAttemptAt: 1, lastError: 1, createdAt: 1 });
```

Cảnh báo khi pending/tuổi event tăng lâu, log retry lặp lại hoặc queue `user-profile-sync.dead` của User có message. `lastError` chỉ lưu tên loại lỗi để tránh lưu dữ liệu nhạy cảm từ thông báo lỗi DB/broker.

## Kiểm thử

```bash
npm run lint
npm run format:check
npm test -- --runInBand
npm run build
# URI của replica set test; suite tạo database riêng rồi xóa database đó.
OUTBOX_TEST_MONGO_URL='mongodb://127.0.0.1:27017/?directConnection=true' npm test -- --runInBand
```

Các test Mongo thật kiểm tra rollback, commit, version khi ghi đồng thời và DELETE đã lưu dù Redis lỗi. Test relay/transport kiểm tra broker confirm/nack, mandatory return, backoff và claim khi chạy nhiều batch.

Tham khảo: [Mongoose transactions](https://mongoosejs.com/docs/8.x/docs/transactions.html), [RabbitMQ publisher confirms](https://www.rabbitmq.com/docs/confirms).
