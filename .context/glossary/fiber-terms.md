---
type: glossary
domain: fiber-network + testing
version: 1.0
last_updated: 2026-07-04
tags: [fiber, ckb, payment-channel, testing]
---

# Glossary — Fiber Test Lab

## Thuật ngữ Fiber (nền tảng)

## Fiber Network
Mạng payment channel P2P trên Nervos CKB. Tương tự Bitcoin Lightning nhưng multi-asset (CKB, RUSD, UDT).

## FNN (Fiber Network Node)
Reference implementation của Fiber protocol (Rust). Test Lab chạy nhiều FNN binary THẬT trong các container.

## Payment Channel
Quan hệ trực tiếp 2 node. Mở = khoá CKB on-chain vào Funding Cell (multisig). Giao dịch off-chain. Đóng = settle on-chain.

## Capacity (inbound / outbound)
Capacity channel chia theo CHIỀU, không phải 1 số chung:
- **Outbound** = có thể GỬI đi
- **Inbound** = có thể NHẬN về
Mỗi lần trả tiền, outbound giảm/inbound tăng ở phía người trả. Mỗi bên reserve tối thiểu **99 CKB** (không dùng để payment).

## HTLC (Hash Time-Locked Contract)
Cơ chế bảo mật multi-hop: hoặc tất cả hop thành công, hoặc tất cả revert.

## Multi-hop Route
Payment không cần channel trực tiếp sender↔receiver — đi qua node trung gian nếu đủ liquidity. VD A-B-C: A trả C qua B (1 hop trung gian).

## Invoice
Yêu cầu thanh toán (Bech32m string): amount, asset, payment_hash, expiry, description.

## Shannon
Đơn vị nhỏ nhất CKB. 1 CKB = 100,000,000 Shannon.

## Fiber RPC (methods Test Lab dùng)
JSON-RPC 2.0 của FNN. Các method chính Test Lab gọi:
- `get_node_info` — check node READY
- `open_channel` / `list_channels` / `close_channel`
- `new_invoice` / `get_invoice`
- `send_payment`
- `subscribe_store_changes` — (optional v2) event thay polling

## RUSD
Stablecoin trên CKB testnet (dạng UDT). Dùng cho kịch bản multi-asset (v2 stretch).

## ErrorCategory (mã lỗi chuẩn hoá của Test Lab)
Tập mã lỗi Test Lab dùng trong `expect.reason`. **Chưa verify với node thật** — sẽ chốt sau khi thực hành (Bước 0) và đọc source FNN. Danh sách khởi điểm:
`insufficient_outbound`, `insufficient_inbound`, `no_route_found`, `peer_offline`, `invoice_expired`, `amount_out_of_range`, `asset_mismatch`, `channel_not_ready`, `reserve_violation`.

---

## Thuật ngữ riêng của Test Lab

## Scenario
1 file YAML khai báo 1 tình huống test: topology (nodes + channels) + seed + expect. Tầng 1 settings — dev tự viết được, không đụng code.

## Topology
Cấu hình các node + channel của 1 scenario. VD `two-hop-route` = 3 node A-B-C, 2 channel.

## Seed
Các hành động chạy sau khi topology sẵn sàng (gửi payment mẫu, tạo invoice hết hạn, kill node...).

## Run / run-id
1 lần chạy `fiber-lab up`. Mỗi run có `run-id` duy nhất, mọi tài nguyên gắn prefix theo nó để cô lập.

## Run-log
File JSON ghi lại toàn bộ 1 run (steps + mọi RPC call thô). Nguồn sự thật để debug sau khi container đã reset.

## test-kit
Thư viện assertion (dùng trong Vitest): `expectPaymentSucceeds`, `expectPaymentFails`, `expectChannelState`.

## offckb
Công cụ dựng CKB devnet local + faucet. Cấp tiền test cho các node, thay testnet công cộng.

## Global config (`fiber-lab.config.ts`)
Tầng 2 settings — hành vi chung cả hệ thống (timeout, poll interval, version image). Dev sửa 1 lần.

## Determinism
Cùng scenario + cùng version → cùng kết quả. Flaky = bug của Test Lab, không phải hành vi chấp nhận được.
