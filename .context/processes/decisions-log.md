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

[2026-07-04] **Local devnet, không testnet**: Chạy trên CKB dev chain local — Lý do: mục tiêu là môi trường lặp lại được và kiểm soát được; testnet công cộng chậm/chia sẻ/không ép được lỗi. Trade-off (devnet ≠ mainnet) chấp nhận và document.
  > **Cập nhật sau khi đọc doc thật (xem mục "Verified from official docs"):** CKB dev chain đến từ docker-compose của `fiber-demo-startup` (đã dockerized sẵn), KHÔNG phải `offckb` standalone như giả định ban đầu. `offckb` vẫn có thể dùng thay thế nếu cần, nhưng đường đã-được-chứng-minh là compose của demo-startup.

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

## Verified from official docs (2026-07-04)

> Đối chiếu với tài liệu onboard hackathon (github.com/RetricSu/fiber-hackathon-docs) + fiber.world/docs. Đây là SỰ THẬT đã xác minh qua doc, thay thế các giả định trước đó.

[2026-07-04] **Build ON TOP of `fiber-demo-startup`, KHÔNG dựng docker từ đầu**: Repo chính thức `HappySonnyDev/fiber-demo-startup` (branch `demo-0.8`) đã cung cấp docker-compose với CKB dev chain local + nhiều Fiber node (1 bootnode + 3 node + transfer container cấp tiền) — Lý do: đây là phần hạ tầng rủi ro/tốn thời gian nhất, đã được chứng minh chạy được; fork/xây trên nó giảm rủi ro tiến độ lớn. Test Lab tập trung vào lớp CHƯA có: automated channel-opening (seeder), scenario YAML, assertion (test-kit), CLI chạy named scenario — chính là những thứ demo-startup tự nêu là "còn thiếu" (nó là "interactive learning", không phải "automated testing").

[2026-07-04] **Định vị so với fiber-demo-startup**: demo-startup = môi trường học tương tác (mở channel/trả tiền qua UI thủ công); Test Lab = biến nó thành test tự động lặp lại được (scenario + assertion + CLI) — Lý do: khác mục đích rõ ràng, không phải bản sao; câu chuyện submission mạnh hơn: "không phát minh lại hạ tầng, làm nó test được".

[2026-07-04] **`fnn-cli` dùng cấu trúc subcommand**: Thực tế là `fnn-cli info`, `fnn-cli peer list_peers`, `fnn-cli channel list_channels` — KHÔNG phải lệnh phẳng `fnn-cli open_channel` như giả định trước. Release FNN gồm 2 binary: `fnn` (HTTP RPC + node) và `fnn-cli` (quản lý CLI).

[2026-07-04] **Nguồn RPC chính thức**: fiber.world/docs/api-reference (RPC reference) + các quick-start: run-a-node, basic-transfer, transfer-stablecoin, multi-hop-transfer (đúng scenario two-hop-route). FNN source: github.com/nervosnetwork/fiber. — Dùng làm nguồn cho E0-4 (RPC notebook) thay vì đoán.

---

## Open Questions

> Những vấn đề chưa chốt. Xoá dòng khi đã có quyết định và chuyển lên trên.

- [ ] Danh sách `ErrorCategory` chính xác — vẫn cần verify bằng thực hành (Bước 0/E0-5) + đọc RPC reference. Hiện là danh sách khởi điểm trong glossary.
- [x] ~~FNN có chạy được trong container Docker không~~ — ĐÃ RÕ: `fiber-demo-startup` đã dockerize FNN thành công (multi-node + CKB dev chain). Việc còn lại chỉ là clone + verify chạy được trên máy mình (E1).
- [x] ~~Có cần build image FNN riêng không~~ — ĐÃ RÕ: dùng Dockerfile/compose có sẵn của demo-startup làm điểm khởi đầu.
- [ ] Tên RPC method chính xác (get_node_info vs getNodeInfo qua SDK; open_channel params) — verify ở E0 khi gõ tay thật + đọc api-reference.
- [ ] `fiber-demo-startup` license cho phép fork/build-on-top không — kiểm tra trước khi commit hướng này chính thức.
