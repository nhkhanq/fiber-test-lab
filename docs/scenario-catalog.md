# Scenario Catalog

Danh mục scenario của Fiber Test Lab kèm **kết quả verify thật** và **version đã pin**. Kết quả chỉ đúng với đúng các version dưới đây (BR-DET-002).

## Pinned versions

| Thành phần | Version | Ghi chú |
|---|---|---|
| FNN (Fiber Network Node) | **0.9.1** (`9a561b3`, 2026-09-10) | `fiber-lab.config.ts` → `fnnVersion` (`FIBER_LAB_FNN_VERSION` ghi đè); fiber-scripts lấy từ cùng tag, giống hệt 0.8.0 |
| `@ckb-ccc/core` | `0.0.0-canary-20260330023358` | pin cứng trong `package.json` |
| `@ckb-ccc/fiber` | `0.0.0-canary-20260330023358` | pin cứng trong `package.json` |
| CKB (devnet) | **v0.207.0** (`nervos/ckb`) | khớp genesis offckb 0.4.7 |
| Node.js | ≥ 20 | chạy trực tiếp bằng `tsx`, không build |

### Các bản FNN đã verify

| FNN | Package | Kết quả 16 scenario |
|---|---|---|
| 0.9.1 | `fiber-test-lab@0.9.1` (`latest`) | Đạt 16/16 trên máy local và CI |
| 0.10.0-rc1 | không phát hành | Đạt 16/16 trên máy local và CI |
| 0.10.0-rc2 | `fiber-test-lab@0.10.0-rc2` (`next`) | Đạt 16/16 trên máy local, 2026-11-09 |

## Global config (`fiber-lab.config.ts`)

| Setting | Giá trị | Ý nghĩa |
|---|---|---|
| `pollIntervalMs` | 1000 | nhịp poll RPC |
| `pollTimeoutMs` | 60000 | timeout chờ READY/ChannelReady/payment |
| `blockIntervalMs` | 200 | nhịp lab tự sinh block trong lúc chờ on-chain |
| `dockerNetworkPrefix` | `flab` | network = `flab_<run-id>` |
| `keepRunOnFailure` | false | lỗi → tự teardown (trừ `--keep`) |
| `maxNodesPerScenario` | 5 | ghi đè có chủ đích mức mặc định 3 (BR-ISO-003); genesis pre-fund 6 account, dự án dùng có thể nâng lên 6 bằng `fiber-lab.config.json` |

Gossip interval hạ xuống **2000ms** (mặc định FNN 60s) để multi-hop route lan nhanh & tất định — xem E5-2.

## Xem lại một run

Mỗi run ghi ra `.fiber-lab/runs/<run-id>.json`. Xem trực quan:

- `fiber-lab ui` — mở viewer ở `127.0.0.1`, tự cập nhật trong lúc `up` đang chạy
- `fiber-lab logs <run-id> --html` — xuất một file HTML tự chứa, mở được bằng `file://`, dùng làm artifact CI

Viewer chỉ **đọc** run-log, không gọi RPC vào node — sau `reset` container đã mất, run-log là bản ghi duy nhất còn lại.

## Giới hạn

- **Tối đa 5 node/scenario** — trên 3 node sẽ in cảnh báo; genesis pre-fund 6 account (10 tỷ CKB/node).
- **Kênh single-funded** — chỉ bên `from` cấp vốn; `capacity` verify = `local+remote balance + reserve(99 CKB)`.
- **Devnet ≠ mainnet** — xem `docs/trade-offs.md`.

## Scenarios

Payment dùng keysend (`target_pubkey` + `amount`) trừ khi scenario tạo invoice. Số tiền tính bằng CKB.

### `direct-channel`
- **Topology:** alice → bob (1 kênh, capacity 500 CKB).
- **Seed:** alice trả bob 100 CKB.
- **Expect:** `status: succeeded`.
- **Kết quả thật:** payment `Success`, **fee `0x0`** (kênh trực tiếp, 0 hop). alice 401→301, bob 0→100. Mở kênh ~3–4,5s (trước đây ~35s). Kiểm tra theo step: fee, số dư tuyệt đối và độ thay đổi của cả hai bên.

### `two-hop-route`
- **Topology:** alice → bob, bob → charlie (2 kênh, mỗi kênh 500 CKB).
- **Seed:** alice trả charlie 100 CKB (định tuyến qua bob).
- **Expect:** `status: succeeded`, `routeHops: 1`.
- **Kết quả thật:** payment `Success`, **fee `0x989680`** = 0.1 CKB (phí định tuyến của bob) ⇒ bằng chứng đi qua 1 hop trung gian. Bản release của `get_payment` không trả route nên fee là tín hiệu hop duy nhất (E5-2). Kiểm tra theo step: alice mất 100,1 CKB, charlie nhận 100 CKB.

### `insufficient-capacity`
- **Topology:** alice → bob (1 kênh, capacity 500 CKB ⇒ alice outbound ~401 CKB).
- **Seed:** alice trả bob 450 CKB (> outbound).
- **Expect:** `status: failed`, `reason: insufficient_outbound`.
- **Kết quả thật:** send_payment lỗi **đồng bộ** (không sinh payment_hash): `Failed to build route, Insufficient balance: max outbound liquidity 40100000000 is insufficient, required amount: 45000000000` (401 < 450 CKB) → map `insufficient_outbound` (E5-3/E5-4).

### `peer-offline` (stretch)
- **Topology:** alice → bob (1 kênh, capacity 500 CKB).
- **Seed:** `kill_node bob` → alice trả bob 100 CKB.
- **Expect:** `status: failed`, `reason: peer_offline`.
- **Kết quả thật:** send_payment lỗi `max outbound liquidity 0 is insufficient` — **TRÙNG message với `insufficient_outbound`** (peer offline ⇒ liquidity dùng được = 0). Phân biệt bằng `list_peers(alice) = []` (`peerConnected: false`) → `classifyFailure` cho `peer_offline` (E8-2).

### `expired-invoice` (stretch)
- **Topology:** alice → bob (1 kênh, capacity 500 CKB).
- **Seed:** `new_invoice(bob, 100 CKB, expiresInSec: 3)` → `wait 6s` → alice trả invoice đó (`send_payment` `useInvoice: true`).
- **Expect:** `status: failed`, `reason: invoice_expired`.
- **Kết quả thật:** send_payment lỗi **đồng bộ**: `InvalidParameter: Failed to validate payment request: "invoice is expired"` → map `invoice_expired` (E8-1). Trả invoice dùng `send_payment [{ invoice }]`, không keysend.

### `round-trip`
- **Topology:** alice → bob (1 kênh 500 CKB).
- **Seed:** alice trả bob 300, rồi **bob trả alice 100** (chiều ngược, dùng inbound bob vừa nhận).
- **Expect:** `status: succeeded`.
- **Kết quả thật:** cả 2 payment Success — chứng minh kênh **hai chiều** (bob chi tiêu được sau khi nhận). Số dư sau từng payment được kiểm tra: 101/300 rồi 201/200.

### `channel-drain`
- **Topology:** alice → bob (1 kênh 500 CKB → alice outbound ~401).
- **Seed:** alice trả bob 100 **× 5 lần**.
- **Expect:** `status: failed`, `reason: insufficient_outbound`.
- **Kết quả thật:** 4 payment đầu Success (401→…→1), payment thứ 5 fail `max outbound liquidity 1 CKB insufficient` → cạn outbound dần theo chuỗi (bằng chứng determinism của phép tính capacity). Mỗi payment có kỳ vọng riêng, nên payment nào lệch sẽ được chỉ đích danh.

### `two-hop-bottleneck`
- **Topology:** alice → bob (500), bob → charlie (**200** → bob outbound tới charlie chỉ ~101).
- **Seed:** alice trả charlie **180** (định tuyến qua bob).
- **Expect:** `status: failed`, `reason: no_route_found`.
- **Kết quả thật:** kênh mở OK nhưng PathFind của alice biết hop bob→charlie không đủ đẩy 180 → `PathFind error: no path found` → `no_route_found`. (Lỗi định tuyến tại **hop trung gian**, không phải tại sender.)

### `multi-asset` (stretch)
- **Topology:** alice → bob (1 kênh **UDT/RUSD**, capacity 10000 đơn vị token).
- **Seed:** alice trả bob 100 RUSD (sUDT).
- **Expect:** `status: succeeded`.
- **Kết quả thật:** seeder tự **mint sUDT** cho alice (owner = lock hash key genesis) qua @ckb-ccc → mở kênh với `funding_udt_type_script` → `send_payment` kèm `udt_type_script` (đơn vị token, KHÔNG ×1e8) → **Success** (E8-4). `RUSD` ↔ script `simple_udt` code_hash `0xe1e354…` (hash_type data), FNN nhận diện qua `ckb.udt_whitelist`.

### `hold-invoice-settle`
- **Topology:** member → hub → organizer (mỗi kênh 1000 CKB).
- **Seed:** tạo hold invoice 10 CKB → settle sớm → member trả (`waitFor: inflight`) → settle sai preimage → settle đúng → `await_payment`.
- **Kết quả thật:** settle sớm bị từ chối `Invoice is still open`. Khi đang giữ: payment `Inflight`, invoice `Received`, member vẫn `local` 901 nhưng `offered` 10,01, organizer `local` 0 và `received` 10. Sai preimage bị từ chối `Hash mismatch`. Đúng preimage: invoice `Paid`, payment `Success`, fee 0,01.

### `hold-invoice-cancel`
- **Topology:** member → hub → organizer.
- **Seed:** hold invoice 20 CKB → member trả → organizer `cancel_invoice` → `await_payment`.
- **Kết quả thật:** invoice `Cancelled`, payment `Failed` với `failed_error: InvoiceCancelled` (`invoice_cancelled`), member về lại `local` 901.

### `channel-close`
- **Topology:** alice → bob (500 CKB).
- **Seed:** alice trả bob 100 → alice đóng kênh thường.
- **Kết quả thật:** hai bên `Closed (COOPERATIVE)`. On-chain: alice +399,99999462 (301 + 99 reserve, trừ phí đóng), bob +199 (100 + 99 đã góp lúc mở).

### `channel-force-close`
- **Topology:** alice → bob (500 CKB).
- **Seed:** alice trả bob 100 → alice force-close → `advance_epochs: 8`.
- **Kết quả thật:** alice `Closed (UNCOOPERATIVE_LOCAL|WAITING_ONCHAIN_SETTLEMENT)`. Sau độ trễ commitment: alice +399,99999216, bob +198,99998906 on-chain.

### `peer-reconnect`
- **Topology:** alice → bob (500 CKB).
- **Seed:** trả 10 → `disconnect_peer` → trả 10 → `connect_peer` → trả 10.
- **Kết quả thật:** khi ngắt, payment fail đồng bộ (`peer_offline`). Nối lại là trả được ngay trên cùng kênh, alice còn `local` 381.

### `restart-during-hold`
- **Topology:** member → hub → organizer.
- **Seed:** giữ 10 CKB → kill rồi start organizer → settle; giữ 7 CKB → kill member → settle → start member.
- **Kết quả thật:** sau restart invoice vẫn `Received` và TLC còn nguyên, settle thành công. Settle được cả khi người trả đang tắt; lúc quay lại payment của họ là `Success`.

### `frozen-peer`
- **Topology:** alice → bob (500 CKB).
- **Seed:** `pause_node bob` → alice trả (`timeoutSec: 4`) → `resume_node bob` → `await_payment`.
- **Kết quả thật:** sau 4 giây payment vẫn chưa ngã ngũ và được báo `timeout`, không phải `failed`. Bob tỉnh lại thì payment `Success`.

## Exit codes (mọi lệnh CLI)

`0` ok · `1` lỗi config/validation · `2` lỗi runtime (docker/RPC) · `3` expect không khớp.

Chạy cả danh mục: `fiber-lab test --all` (16 scenario, ~10 phút trên máy 12 CPU, kể cả dựng và dọn từng cụm). Chọn theo nhóm: `fiber-lab test --tag smoke`.
