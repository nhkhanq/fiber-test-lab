# Trade-offs & Limitations

Fiber Test Lab đánh đổi có chủ đích để đạt mục tiêu chính: **tái tạo lỗi payment/routing một cách tất định, cục bộ, một lệnh**. Những điểm cần biết khi đọc kết quả:

## Devnet ≠ mainnet/testnet

- Node chạy trên **CKB devnet** dựng ngay trong docker (genesis tự sinh, pre-fund 6 account). Tham số mạng (block time, script, phí) là devnet — **hành vi có thể khác mainnet/testnet công khai**.
- Gossip interval hạ còn 2000ms (mặc định 60s) để route lan nhanh. Mainnet không chỉnh được vậy ⇒ thời gian hội tụ route thực tế sẽ lâu hơn.
- Kết quả chỉ được coi là đúng với **đúng version đã pin** (`docs/scenario-catalog.md`). Đổi version FNN/`@ckb-ccc` → phải verify lại.

## Block do lab sinh ra

- Mặc định không có miner: chain chỉ tiến khi lab gọi `generate_block`, và lab chỉ làm vậy trong lúc chờ một thứ on-chain. Nhờ đó mở kênh còn ~3–4,5s thay vì ~35s và giữa các step chain đứng yên.
- Đổi lại, nhịp block không giống mạng thật. Ứng dụng tự mở kênh và chờ block đến sẽ treo trừ khi scenario đặt `chain.mining: auto` hoặc test gọi `ctx.mine()`.

## Thời gian thực không tua được

- Block và epoch thì tua được bằng `mine` và `advance_epochs`, nên độ trễ force-close tính theo epoch chạy trong vài giây. Hạn của TLC và invoice thì theo đồng hồ thật của FNN, không tua được. Muốn kiểm tra một hold hết hạn thật phải chờ thật, ít nhất cỡ 160 phút.
- Watchtower được đặt quét mỗi 2 giây (mặc định 60 giây) để force-close quyết toán nhanh. Bên không chủ động force-close vẫn có thể báo `ChannelReady` một lúc sau khi kênh đã đóng; scenario chỉ kiểm tra số dư on-chain của bên đó.

## "Peer offline" là mô phỏng

- `pause_node` dùng `docker pause` để node đứng im mà vẫn giữ kết nối, trạng thái khiến payment thường treo chưa ngã ngũ.
- Scenario tắt node bằng `docker kill` (không graceful) để giả lập peer offline — khác một node bị mất mạng thật ngoài đời (timeout tầng TCP/gossip có thể lệch). Đủ để tái tạo lớp lỗi, không phải mô phỏng mạng đầy đủ.

## Xác định hop bằng fee, không có route

- Bản release của FNN `get_payment` **không trả route/số hop** (`routers` chỉ có trong bản debug). `routeHops` được verify gián tiếp: số hop từ topology (BFS) + đối chiếu `fee > 0` (mỗi hop trung gian thu phí). Đúng cho topology 1 đường đi; topology nhiều đường sẽ cần tín hiệu khác.

## Phân loại lỗi bằng substring

- FNN luôn trả JSON-RPC `code: -32000`. `ErrorCategory` map bằng **substring của message** (`lib/scenario/errorCategory.ts`) — dễ vỡ nếu FNN đổi chữ trong thông báo lỗi. Schema chỉ nhận 4 loại đã verify thật (`insufficient_outbound`, `no_route_found`, `peer_offline`, `invoice_expired`); loại khác chỉ được thêm khi có scenario tái hiện được.

## Kênh single-funded

- Chỉ bên `from` cấp vốn kênh. `capacity` verify = `local + remote balance + 1 reserve (99 CKB)`. Kênh do hai bên cùng cấp vốn sẽ cần công thức khác.

## Chi phí thời gian

- Mỗi scenario dựng cụm docker riêng (~30–35s gồm cả dựng và dọn). Các scenario chạy **tuần tự** để không tranh tài nguyên → tất định nhưng vẫn tốn thời gian (`fiber-lab test --all` ~5 phút). Trong lúc dev nên chạy `npm run test:unit` trước, rồi từng scenario.

## UDT (RUSD) là sUDT devnet, mint runtime

- Asset `RUSD` ánh xạ sang script `simple_udt` deploy sẵn trong genesis; **token thì mint lúc chạy** (genesis chỉ cấp CKB) bằng 1 tx CCC do node tự ký (owner mode). Không phải RUSD "thật" trên mainnet — chỉ đủ để test kênh/thanh toán UDT.
- code_hash + cell_dep của `simple_udt`/secp256k1 được **đọc từ block 0 của chain đang chạy**, nên đổi genesis hay đổi version contract không phải sửa hằng số nào.
- CKB RPC mở port map tạm để mint và sinh block (đóng khi reset). `fiber-lab seed` dùng lại token đã mint trong lần `up` nhờ run-log.
- Mỗi node cấp vốn kênh UDT tự mint token của riêng nó, nên chưa route được UDT qua nhiều hop.

## Bảo trì version

- `@ckb-ccc` đang ở bản canary, API còn lệch với FNN (một số RPC phải gọi `rawCall` thay vì SDK typed). Khi nâng version phải: chạy lại toàn bộ scenario (`FIBER_LAB_FNN_VERSION=<bản mới> fiber-lab test --all`), cập nhật `scenario-catalog.md`, và kiểm lại mapping lỗi.
