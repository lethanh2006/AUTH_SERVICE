# Common của Auth

Luồng HTTP: `main.ts` khởi động `AppModule` → `CoreModule` đăng ký middleware, logger và exception filter → `RequestIdMiddleware` gắn `x-request-id` → guard của route (nếu có) → DTO validation → controller → service. Khi có lỗi, `GlobalExceptionFilter` giữ định dạng phản hồi và ghi log kèm request ID.

| Thư mục trong `src/common` | Trách nhiệm |
| --- | --- |
| `config/` | Kiểm tra JWT secret và tạo khóa JWT lúc khởi động. |
| `decorators/` | `GatewayRoles` khai báo role được phép cho route. |
| `enums/` | Các role được hỗ trợ. |
| `filters/` | Chuyển exception thành HTTP response và ghi log. |
| `guards/` | `GatewayIdentityGuard` xác thực identity và role từ Gateway. |
| `interfaces/` | Kiểu dữ liệu identity và request context. |
| `logging/` | Một file `logger.ts` tạo logger và flush log khi ứng dụng dừng. |
| `middleware/` | Nhận hoặc tạo request ID trước khi xử lý route. |
| `security/` | Kiểm tra chữ ký và thời hạn của header do Gateway ký. |
| `utils/` | Parse identity và chuẩn hóa lỗi. |

Các route đăng nhập, OTP và refresh token dùng kiểm tra riêng trong `modules/auth`; chúng không tự động đi qua `GatewayIdentityGuard`. Guard chỉ chạy ở route đã gắn `@UseGuards`.

Nghiệp vụ nằm ở `modules/`; schema MongoDB nằm ở `schemas/`. Outbox, Redis và RabbitMQ vẫn cần cho đồng bộ profile, OTP và token. Không chuyển chúng vào `common`.

Logger dùng `@nrapp/observability` trong repo Logger để xuất log và nối log theo request ID. Test đặt cạnh file được kiểm tra; chỉ tạo thư mục khi service thực sự cần.
