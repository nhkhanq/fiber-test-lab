# Trade-offs & Limitations

Fiber Test Lab đánh đổi có chủ đích để đạt mục tiêu chính: **tái tạo lỗi payment/routing một cách tất định, cục bộ, một lệnh**. Những điểm cần biết khi đọc kết quả:

## Devnet ≠ mainnet/testnet

- Node chạy trên **CKB devnet** dựng ngay trong docker (genesis tự sinh, pre-fund 3 account). Tham số mạng (block time, script, phí) là devnet — **hành vi có thể khác mainnet/testnet công khai**.
- Gossip interval hạ còn 2000ms (mặc định 60s) để route lan nhanh. Mainnet không chỉnh được vậy ⇒ thời gian hội tụ route thực tế sẽ lâu hơn.
- Kết quả chỉ được coi là đúng với **đúng version đã pin** (`docs/scenario-catalog.md`). Đổi version FNN/`@ckb-ccc` → phải verify lại.

## "Peer offline" là mô phỏng

- Scenario tắt node bằng `docker kill` (không graceful) để giả lập peer offline — khác một node bị mất mạng thật ngoài đời (timeout tầng TCP/gossip có thể lệch). Đủ để tái tạo lớp lỗi, không phải mô phỏng mạng đầy đủ.

## Xác định hop bằng fee, không có route

- FNN `get_payment` **không trả route/số hop**. `routeHops` được verify gián tiếp: số hop từ topology (BFS) + đối chiếu `fee > 0` (mỗi hop trung gian thu phí). Đúng cho topology 1 đường đi; topology nhiều đường sẽ cần tín hiệu khác.

## Phân loại lỗi bằng substring

- FNN luôn trả JSON-RPC `code: -32000`. `ErrorCategory` map bằng **substring của message** (`lib/scenario/errorCategory.ts`) — dễ vỡ nếu FNN đổi chữ trong thông báo lỗi. Hiện chỉ 2 loại đã verify thật (`insufficient_outbound`, `no_route_found`); còn lại chờ scenario E8.

## Kênh single-funded

- Chỉ bên `from` cấp vốn kênh. `capacity` verify = `local + remote balance + 1 reserve (99 CKB)`. Kênh hai bên cùng cấp vốn (push amount) sẽ cần công thức khác.

## Chi phí thời gian

- Mỗi scenario dựng cụm docker riêng (~30–60s boot + channel ready). Test suite chạy **tuần tự** (không song song) để không tranh tài nguyên → tất định nhưng chậm (`npm test` ~9 phút). Trong lúc dev nên chạy từng file.

## Bảo trì version

- FNN và `@ckb-ccc` đang ở bản canary/pre-release, API còn lệch nhau (một số RPC phải gọi `rawCall` thay vì SDK typed). Khi nâng version phải: chạy lại toàn bộ scenario, cập nhật `scenario-catalog.md`, và kiểm lại mapping lỗi.
