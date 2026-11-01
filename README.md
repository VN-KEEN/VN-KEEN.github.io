# VN-KEEN.SKIN — Website CS2

Website chính: https://vn-keen.skin/ — Cloudflare Pages, project `vn-keen`.

## Cấu trúc

- `public/`: source giao diện, ảnh nhỏ và dữ liệu cập nhật có chữ ký; tài nguyên lớn được khôi phục theo manifest.
- `functions/`: API tài khoản, ví, thanh toán, license và phiên sử dụng.
- `migrations/`: cấu trúc D1, lưu ngoài thư mục public.
- Các module `.mjs` ở gốc: cấu hình giá chung, hướng dẫn và xử lý phía máy chủ.
- `*-test.mjs`, `test-*.mjs`, `test-*.cjs`: kiểm thử; không đưa vào thư mục public.

Source app Windows được quản lý riêng trong thư mục `VN-KEEN.SKIN-CS2-V2.1.6-APP` của chủ dự án. Repo công khai này chứa thông tin và cách khôi phục bản phát hành app, không chứa khóa ký riêng hoặc source app.

Model 3D, ảnh/dữ liệu sinh sẵn lớn và EXE/ZIP được giữ trên website chính, không nhân bản vào Git. `public-assets.json` ghi đường dẫn, kích thước và SHA-256; chạy `node restore-public-assets.mjs` sau khi clone để khôi phục đúng các file đó. Máy source đang phát hành đã có đủ file. Giữ một bản sao ngoại tuyến các tài nguyên này cùng source.

## Bản hiện tại

V2.1.6, build 21604: PGUP mở/đóng menu; cập nhật bằng nút trong app; tự chuẩn bị offset khi CS2 sẵn sàng; dumper nhúng trong EXE và đi theo bản cập nhật; mỗi key một phiên đồng thời. Khách dùng V2.1.5 cần tải bộ mới một lần.

`public/updates/latest.json` và `latest.sig` xác định EXE đã ký. Khi phát hành app, dùng script `publish-online-update.ps1` ở source APP, tăng build và build lại. Không tự sửa manifest hoặc dùng lại số build cho EXE khác.

Tham số `-Rebuild` build lại DLL và launcher, sau đó tạo gói website; `release/` và `release/online-update/` được đồng bộ cùng một EXE/ZIP để tránh mở nhầm bản cũ.

## Kiểm tra và triển khai

Chạy Node.js 24 trở lên từ thư mục này:

```powershell
node restore-public-assets.mjs
node audit-public-links.mjs
node cs2-session-test.mjs
node retired-product-test.mjs
node test-ai-routing.mjs
node test-ai-retry.cjs
node test-license-expiry.mjs
node test-payos-service.mjs
node test-wallet-webhook.mjs
```

Triển khai sau khi đăng nhập Cloudflare:

```powershell
wrangler pages deploy public --project-name vn-keen --branch main
```

Cloudflare cung cấp bindings D1/AI và secrets cho API. Không lưu API key, token, dữ liệu khách hàng, file `.dev.vars`, khóa ký hoặc bản sao database trong Git. Sau khi triển khai, kiểm tra trang chủ, API, checksum ZIP và manifest trên miền chính.

`index.html` ở gốc chỉ chuyển khách từ GitHub Pages sang miền chính; giao diện thật nằm tại `public/index.html`.

Các gói cũ và ảnh không sử dụng đã bỏ khỏi nhánh hiện tại. Lịch sử commit được giữ để có thể khôi phục.
