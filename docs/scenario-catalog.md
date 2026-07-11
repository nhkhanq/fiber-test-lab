# Scenario Catalog

Danh mục scenario của Fiber Test Lab kèm **kết quả verify thật** và **version đã pin**. Kết quả chỉ đúng với đúng các version dưới đây (BR-DET-002).

## Pinned versions

| Thành phần | Version | Ghi chú |
|---|---|---|
| FNN (Fiber Network Node) | **0.8.0** (`335a74a`, 2026-04-03) | `fiber-lab.config.ts` → `fnnVersion`; fiber-scripts lấy từ tag `v0.8.0` |
| `@ckb-ccc/core` | `0.0.0-canary-20260330023358` | pin cứng trong `package.json` |
| `@ckb-ccc/fiber` | `0.0.0-canary-20260330023358` | pin cứng trong `package.json` |
| CKB (devnet) | **v0.207.0** (`nervos/ckb`) | khớp genesis offckb 0.4.7 |
| Node.js | ≥ 20 | chạy trực tiếp bằng `tsx`, không build |

## Global config (`fiber-lab.config.ts`)

| Setting | Giá trị | Ý nghĩa |
|---|---|---|
| `pollIntervalMs` | 1000 | nhịp poll RPC |
| `pollTimeoutMs` | 60000 | timeout chờ READY/ChannelReady/payment (devnet confirm ~36–40s) |
| `dockerNetworkPrefix` | `flab` | network = `flab_<run-id>` |
| `keepRunOnFailure` | false | lỗi → tự teardown (trừ `--keep`) |
| `maxNodesPerScenario` | 3 | giới hạn tài nguyên máy (3 account pre-fund genesis) |

Gossip interval hạ xuống **2000ms** (mặc định FNN 60s) để multi-hop route lan nhanh & tất định — xem E5-2.

## Giới hạn

- **Tối đa 3 node/scenario** — genesis pre-fund đúng 3 account (10 tỷ CKB/node), cũng là mức hợp lý cho 1 máy.
- **Kênh single-funded** — chỉ bên `from` cấp vốn; `capacity` verify = `local+remote balance + reserve(99 CKB)`.
- **Devnet ≠ mainnet** — xem `docs/trade-offs.md`.

## Scenarios

Mọi payment dùng keysend (`target_pubkey` + `amount`, không cần invoice). Số tiền tính bằng CKB.

### `direct-channel`
- **Topology:** alice → bob (1 kênh, capacity 500 CKB).
- **Seed:** alice trả bob 100 CKB.
- **Expect:** `status: succeeded`.
- **Kết quả thật:** payment `Success`, **fee `0x0`** (kênh trực tiếp, 0 hop). alice 401→301, bob 0→100. **Tất định qua 3 run** (E5-1).

### `two-hop-route`
- **Topology:** alice → bob, bob → charlie (2 kênh, mỗi kênh 500 CKB).
- **Seed:** alice trả charlie 100 CKB (định tuyến qua bob).
- **Expect:** `status: succeeded`, `routeHops: 1`.
- **Kết quả thật:** payment `Success`, **fee `0x989680`** = 0.1 CKB (phí định tuyến của bob) ⇒ bằng chứng đi qua 1 hop trung gian. `get_payment` không trả route nên fee là tín hiệu hop duy nhất (E5-2).

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

## Exit codes (mọi lệnh CLI)

`0` ok · `1` lỗi config/validation · `2` lỗi runtime (docker/RPC) · `3` expect không khớp.
