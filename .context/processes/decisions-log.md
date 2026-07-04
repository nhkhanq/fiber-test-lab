---
type: decisions_log
version: 1.0
last_updated: 2026-07-04
tags: [decisions, architecture, scope]
---

# Decisions Log — Fiber Test Lab

> Ghi lại các quyết định đã được **human xác nhận**.
> Claude Code cập nhật file này **sau khi** human confirm trong hội thoại.
> KHÔNG tự thêm khi chưa có xác nhận rõ ràng.
>
> Format: `[YYYY-MM-DD] **Topic**: decision — Lý do: why`

---

## Architecture & Tech Stack

[2026-07-04] **Chọn Category 2**: Nộp Test Lab theo Category 2 (Node/Routing/Diagnostics), Test Lab theo Category 2 tạo 2 sản phẩm 2 đối tượng khác nhau (merchant vs developer/operator), portfolio đa dạng hơn.

[2026-07-04] **CLI-first**: Bề mặt sản phẩm là CLI + file YAML + test-kit, KHÔNG có dashboard web — Lý do: đối tượng là developer (quen terminal/config); tiết kiệm thời gian hackathon.

[2026-07-04] **Không dùng database, dùng file JSON**: Run-log lưu file JSON, không Postgres — Lý do: dữ liệu Test Lab sống vài phút–vài giờ, mỗi reset xoá sạch; thêm DB là over-engineering, đi ngược mục tiêu "local, nhẹ, 1 lệnh". Nếu cần query phức tạp sau này → cân nhắc SQLite (vẫn không cần DB server).

[2026-07-04] **Local devnet, không testnet**: Chạy trên `offckb` devnet local — Lý do: mục tiêu là môi trường lặp lại được và kiểm soát được; testnet công cộng chậm/chia sẻ/không ép được lỗi. Trade-off (devnet ≠ mainnet) chấp nhận và document.

[2026-07-04] **Node THẬT, không mock giao thức**: Dùng FNN binary thật trong container, không giả lập protocol — Lý do: kết quả test phải phản ánh hành vi Fiber thật; mock giao thức sẽ làm test vô nghĩa.

[2026-07-04] **Cùng dùng `@ckb-ccc/fiber`**: Không coi là trùng lặp — Lý do: đây là SDK chính thức hackathon khuyến nghị; cùng chọn 1 thư viện chuẩn khác với việc chia sẻ code/UI. Repo vẫn độc lập hoàn toàn.

[2026-07-04] **Compose sinh động, không viết tay cố định**: `topology/compose.template.ts` sinh docker-compose từ scenario + run-id — Lý do: số node/tên/port thay đổi theo scenario và cần cô lập theo run-id, không thể hardcode 1 file compose.

[2026-07-04] **Cô lập theo run-id**: Mỗi `up` sinh run-id, mọi tài nguyên gắn prefix — Lý do: cho phép chạy song song (nhiều terminal/CI job) không dẫm chân nhau; đóng vai trò tương tự "cơ chế đăng ký" của FiberGate nhưng cho "1 lần chạy".

---

## Scope

Test Lab nền tảng kỹ thuật đơn giản hơn (devops/scripting, không cần routing/CCH sâu).

[2026-07-04] **3 kịch bản must-have + 2 nếu kịp**: Must-have `direct-channel`, `two-hop-route`, `insufficient-capacity`; nếu kịp thêm `expired-invoice`, `peer-offline` — Lý do: 3 cái đầu đủ chứng minh giá trị cốt lõi (route + lỗi phổ biến nhất); checkpoint cuối Ngày 5 để quyết cắt scope.

[2026-07-04] **Bước 0 (thực hành tay) bắt buộc trước khi code**: Cài fnn, tự tay open_channel/send_payment/list_channels/close_channel trên testnet 1 lần — Lý do: chưa hiểu 4 lệnh lõi khi gõ tay thì không biết CLI đang tự động hoá đúng cái gì.

---

## Open Questions

> Những vấn đề chưa chốt. Xoá dòng khi đã có quyết định và chuyển lên trên.

- [ ] Danh sách `ErrorCategory` chính xác — cần verify bằng thực hành (Bước 0) + đọc source FNN. Hiện là danh sách khởi điểm trong glossary.
- [ ] FNN có chạy được trong container Docker gọn nhẹ không, hay cần config đặc biệt để kết nối offckb devnet — verify ở Bước 1.
- [ ] Có cần build image FNN riêng hay dùng image chính thức có sẵn — verify ở Bước 1.
