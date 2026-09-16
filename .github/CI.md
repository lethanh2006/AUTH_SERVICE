# CI/CD trên GitHub

Workflow trong repo này là caller mỏng; logic thực thi nằm trong Logger:

- [Reusable Node CI](https://github.com/lethanh2006/Logger/blob/d274b289a561fd7c6e3637995482a75a89af4773/.github/workflows/reusable-node-ci.yml)
- [Reusable VPS CD](https://github.com/lethanh2006/Logger/blob/d274b289a561fd7c6e3637995482a75a89af4773/.github/workflows/reusable-vps-cd.yml)

Caller và `platform-ref` được pin cùng full commit SHA, không dùng `@main`.
Nhờ vậy một thay đổi nền tảng không âm thầm ảnh hưởng mọi repository.

## CI

Mỗi push, Pull Request hoặc lần chạy thủ công sẽ cài dependency bằng `npm ci`,
chặn lỗ hổng production mức critical, lint, kiểm tra format, chạy test và build.
CI không cần `.env` thật hoặc các dependency runtime như MongoDB/RabbitMQ.

Chạy tương tự ở local:

```bash
npm ci --prefix ../logger/packages/observability --no-audit --no-fund
npm ci --no-audit --no-fund
npm audit --omit=dev --audit-level=critical
npm run lint
npm run format:check
npm test -- --ci --runInBand
npm run build
```

## CD lên VPS

Sau CI thành công của một push vào nhánh mặc định, caller `cd.yml` gọi
reusable VPS CD. Pipeline từ chối SHA cũ không còn là HEAD, build image
`linux/amd64`, kiểm tra archive, retry SSH tối đa ba lần và giao image cho
receiver. Receiver chỉ cho phép service `auth`, chờ healthcheck và tự rollback.

Repository cần secret `VPS_SSH_PRIVATE_KEY` chứa đúng private key bị giới hạn
cho service này. Không dùng key cá nhân hoặc key của service khác.

## Nâng phiên bản nền tảng

1. Commit và push thay đổi reusable workflow/asset vào Logger.
2. Lấy full SHA Logger mới và cập nhật cả `uses:` lẫn `platform-ref` trên
   một service canary.
3. Chờ CI/CD canary và healthcheck VPS thành công.
4. Cập nhật cùng SHA cho các service còn lại.

Các chi tiết bảo mật, receiver và rollback nằm trong
[Logger README](https://github.com/lethanh2006/Logger/blob/d274b289a561fd7c6e3637995482a75a89af4773/README.md).
