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

[2026-07-05] **Pin FNN 0.8.0 (binary official + Dockerfile tự viết)**: Dùng FNN version 0.8.0 (stable), tải binary official từ GitHub release (`fnn_v0.8.0-x86_64-linux.tar.gz`) vào Dockerfile mỏng tự viết — KHÔNG dùng image official (chỉ có từ 0.9.0-rc, chưa stable) và KHÔNG compile từ source. — Lý do: 0.8.0 đã verify toàn bộ ở E0 (RPC/params/error/balance), giữ determinism; 0.9.0 mới chỉ có release candidate; binary official có sẵn nên không cần build lâu như demo-startup.

[2026-07-05] **CKB devnet: genesis custom nhúng sẵn fiber-scripts**: Dựng CKB devnet với genesis nhúng sẵn Fiber on-chain scripts (FundingLock/CommitmentLock/simple_udt) + tiền cấp sẵn, config tự viết (tham khảo demo-startup, không copy). — Lý do: FNN không chạy trên devnet trống; genesis-custom cho startup nhanh nhất khi `up`, tránh bước deploy script runtime; chấp nhận config genesis phức tạp hơn.

[2026-07-05] **Reimplement compose riêng, KHÔNG fork file demo-startup**: fiber-demo-startup không có file LICENSE (kiểm tra E1-1: GitHub API trả license=null; nervosnetwork/fiber cũng không có license rõ ràng) → "no license" = all-rights-reserved, về nguyên tắc không được fork/redistribute. Quyết định: Test Lab **tự viết** docker-compose + Dockerfile của mình (học cách demo-startup làm nhưng code mới), không copy file của họ. — Lý do: an toàn pháp lý; vẫn giữ được kiến thức topology/fund-flow đã học tay ở E0. Hệ quả: E1-3/E3-3 chuyển từ "tham số hoá compose demo-startup" sang "sinh compose động của riêng Test Lab" (nguyên tắc run-id isolation giữ nguyên; cân nhắc offckb cho CKB devnet như spec đã nêu là phương án thay thế).

[2026-07-04] **`fnn-cli` dùng cấu trúc subcommand**: Thực tế là `fnn-cli info`, `fnn-cli peer list_peers`, `fnn-cli channel list_channels` — KHÔNG phải lệnh phẳng `fnn-cli open_channel` như giả định trước. Release FNN gồm 2 binary: `fnn` (HTTP RPC + node) và `fnn-cli` (quản lý CLI).

[2026-07-04] **Nguồn RPC chính thức**: fiber.world/docs/api-reference (RPC reference) + các quick-start: run-a-node, basic-transfer, transfer-stablecoin, multi-hop-transfer (đúng scenario two-hop-route). FNN source: github.com/nervosnetwork/fiber. — Dùng làm nguồn cho E0-4 (RPC notebook) thay vì đoán.

---

## Open Questions

> Những vấn đề chưa chốt. Xoá dòng khi đã có quyết định và chuyển lên trên.

- [~] Danh sách `ErrorCategory` chính xác — verify 1 phần (E0-5, 2026-07-05): `insufficient_outbound` = raw error code -32000, message "Failed to build route, Insufficient balance: max outbound liquidity ... insufficient". Còn lại (no_route_found, invoice_expired, peer_offline...) chưa ép. Chi tiết: docs/hands-on/rpc-notebook.md §8.
- [x] ~~FNN có chạy được trong container Docker không~~ — ĐÃ RÕ: `fiber-demo-startup` đã dockerize FNN thành công (multi-node + CKB dev chain). Việc còn lại chỉ là clone + verify chạy được trên máy mình (E1).
- [x] ~~Có cần build image FNN riêng không~~ — ĐÃ RÕ: dùng Dockerfile/compose có sẵn của demo-startup làm điểm khởi đầu.
- [x] ~~Tên RPC method chính xác~~ — ĐÃ RÕ (E0, 2026-07-05): method là `node_info` (KHÔNG phải get_node_info), `shutdown_channel` (KHÔNG phải close_channel). `open_channel` params dùng `pubkey` + `funding_amount` (hex shannon). Số response là hex; `result:null`=OK. Đầy đủ chữ ký: docs/hands-on/rpc-notebook.md.
- [x] ~~`fiber-demo-startup` license cho phép fork/build-on-top không~~ — ĐÃ RÕ (2026-07-05): KHÔNG có license → quyết định reimplement compose riêng, không fork (xem quyết định 2026-07-05 phía trên).
