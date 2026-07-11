# RPC Notebook (E0-4)

> Sổ tay các RPC lõi của Fiber + params/response **thật** thu được khi thực hành tay trên
> `fiber-demo-startup` (branch `demo-0.8`, commit `e512aec`). Đây là dữ liệu thật, không đoán —
> dùng làm cơ sở cho `lib/fiber/client.ts` (E2-3) và seeder (E3-6).
> Chữ ký RPC trích từ code chạy thật: `app/src/lib/fiber/rpc.ts` trong demo-startup.

## Môi trường

- FNN version: **0.8.0**, commit_hash `335a74a 2026-04-03`  ← version cần pin (E1-5)
- Node RPC (host): bootnode=10000, node1=10001, node2=10002, node3=10003
- Node RPC (nội bộ container): 10000. P2P: 8228. CKB RPC: 8114.
- App demo map tên logic: **alice=node1(10001), bob=node2(10002), charlie=node3(10003)**
- chain_hash devnet: `0xd77b4979bcd3b1a2742e05cc7f97c557d987718f87fc9915a6b0fa35493b2b4e`
- currency devnet = `Fibd` (invoice bắt đầu `fibd1...`); testnet=`Fibt`, mainnet=`Fiber`

## ⚠️ Quy ước quan trọng (dễ vấp)

- **Mọi số trong response là HEX string** (`"0x0"`, `"0xba43b7400"`). Phải decode.
  - 1 CKB = 10⁸ shannon. Đổi nhanh: `printf '0x%x\n' $((500 * 100000000))` → `0xba43b7400` (500 CKB)
  - `0x2540be400` = 100 CKB (min funding). `0x24e160300` = 99 CKB.
- **`result: null` = THÀNH CÔNG** ở nhiều RPC (connect_peer...). Không lỗi = OK.
- Method là `node_info` — KHÔNG phải `get_node_info` như spec giả định ban đầu.
- Endpoint: JSON-RPC 2.0, POST thẳng `http://127.0.0.1:<port>`.

## Pubkey / address các node (devnet này)

| Node | port | pubkey | address (dns4, chỉ resolve TRONG docker net) |
|---|---|---|---|
| node1/alice | 10001 | `024aeb0f06ea2db71d0c5adecd9c3eb8709439c3b9c6f8a15d27c94f8a52f9f1e4` | `/dns4/fiber-node1/tcp/8228/p2p/QmaPLKSgqkYU2Hqt8kXySNLNrZxRv22Wq8nmHNrviRMFod` |
| node2/bob | 10002 | `02ab314c492498b47aa0506c304b01d32662b853f73fdacfdff4aeacfe3b28ed07` | `/dns4/fiber-node2/tcp/8228/p2p/Qmcb7wrGe9QxzTpipFCRJc4fMhfr8mogPGao7EsjeVzEmP` |
| node3/charlie | 10003 | `02d917d83202ab38088e929cf46fe8fcb9dfeea84e4107a5ac44d2b398edcc9207` | `/dns4/fiber-node3/tcp/8228/p2p/QmYni2414ze6W8FFegDcxnyDhugAZ56DyCgk2hB63askhH` |

---

## 1. node_info — thông tin node
params: `[]`
```bash
curl -s -X POST http://127.0.0.1:10001 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"node_info","params":[],"id":1}'
```
Response (rút gọn): `version, commit_hash, pubkey, node_name, addresses[], chain_hash,`
`open_channel_auto_accept_min_ckb_funding_amount(=100 CKB), channel_count, pending_channel_count, peers_count`.

## 2. connect_peer — kết nối 2 node
params: `[{ pubkey?, address? }]` — dùng `address` (dns4) chắc nhất.
```bash
curl ... -d '{"jsonrpc":"2.0","method":"connect_peer","params":[{"address":"/dns4/fiber-node2/tcp/8228/p2p/Qmcb7..."}],"id":1}'
```
Response: `result: null` = OK. Verify: peers_count tăng.

## 3. open_channel — mở kênh
params: `[{ pubkey, funding_amount(hex shannon), funding_udt_type_script? }]`
- `pubkey` = node ĐỐI DIỆN (không phải peer_id). `funding_amount` hex, min 100 CKB.
- CKB thường: bỏ `funding_udt_type_script`. sUDT: thêm.
```bash
curl -s -X POST http://127.0.0.1:10001 ... \
  -d '{"jsonrpc":"2.0","method":"open_channel","params":[{"pubkey":"02ab31...","funding_amount":"0xba43b7400"}],"id":1}'
```
Response: `{ temporary_channel_id: "0x..." }` — **CHƯA READY**. Funding tx phải confirm on-chain.
Ví dụ thật thu được: `temporary_channel_id: 0x6bcb668796f34b03655e98568de5aa07e8321bbf85159bcb9ac5163f35a6cc28`

## 4. list_channels — liệt kê + chờ READY
params: `[{}]` (hoặc `[{"peer_id":...}]`).
Response: `{ channels: [ { channel_id, state:{state_name,...}, local_balance, remote_balance, ... } ] }`
- state_name thật (PascalCase): ... → **`ChannelReady`** (chờ tới đây mới seed/pay — nền tảng poll E3-5).
- balance hex shannon. Ví dụ thật: fund 500 CKB → `local_balance: 0x956257100` = **401 CKB**, `remote_balance: 0x0`.
  → **~99 CKB bị giữ làm channel reserve** (occupied capacity). Số tiêu được = funding − ~99 CKB.
  → Quan trọng cho validate capacity (E3-1) + scenario insufficient-capacity (E5-3).
- channel_id thật (ví dụ): `0x006688c73bfc3aafdbdc0ba62d6518703400208768ff6d03ed529f663bf5e91b`
  (khác `temporary_channel_id` lúc open — id thật chỉ có sau khi ChannelReady).

## 5. new_invoice — tạo hoá đơn (bên NHẬN)
params: `[{ amount(hex), description, expiry(hex GIÂY), currency:"Fibd", udt_type_script? }]`
```bash
curl -s -X POST http://127.0.0.1:10002 ... \
  -d '{"jsonrpc":"2.0","method":"new_invoice","params":[{"amount":"0x2540be400","description":"test","expiry":"0xe10","currency":"Fibd"}],"id":1}'
```
Response: chứa `invoice_address` = `fibd1...` → đưa cho bên trả.
(`0xe10` = 3600 giây; với scenario expired-invoice để expiry ngắn như `0x5`=5s.)

## 5b. new_invoice response — cấu trúc
`result.invoice_address` = chuỗi `fibd1...` (bên trả chỉ cần chuỗi này).
`result.invoice.data` chứa: `payment_hash`, `amount`, `attrs[]` (description, expiry_time,
final_htlc_minimum_expiry_delta, `payee_public_key`). Tức mọi thông tin nhúng trong chuỗi fibd1.

## 6. send_payment — trả hoá đơn (bên GỬI)
params: `[{ invoice }]`
```bash
INV="fibd1..."
curl ... -d "{\"jsonrpc\":\"2.0\",\"method\":\"send_payment\",\"params\":[{\"invoice\":\"$INV\"}],\"id\":1}"
```
Response THẬT: `{ payment_hash, status:"Created", created_at, failed_error:null, fee:"0x0", ... }`
- ⚠️ **status trả về ngay là `Created` — RPC ASYNC, KHÔNG chờ payment xong.** Phải poll get_payment.
- Kênh trực tiếp: `fee: 0x0` (không hop trung gian). Multi-hop sẽ có phí.
- Verify thật: kênh alice→bob, trả 100 CKB → local 401→301 CKB (`0x702198d00`),
  remote 0→100 CKB (`0x2540be400`). Dịch đúng 100, phí 0.

## 6b. get_payment — poll trạng thái payment (dùng cho test-kit E6-2)
params: `[{ payment_hash }]`
```bash
curl ... -d '{"jsonrpc":"2.0","method":"get_payment","params":[{"payment_hash":"0x8231..."}],"id":1}'
```
status: Created → (Inflight) → **Success** / Failed. test-kit poll cái này tới Success/Failed (chống flaky).
Response THẬT (thành công): `{ payment_hash, status:"Success", created_at, last_updated_at,
failed_error:null, fee:"0x0", custom_records:null }`.
→ status="Success" + failed_error=null = payment xong. Khi FAIL: status="Failed" + failed_error có mã.

## 7. shutdown_channel — đóng kênh
params: `[{ channel_id, close_script:{code_hash:"0x00..0", hash_type:"data", args:"0x"}, fee_rate:"0xA00" }]`

## 8. Lỗi gửi quá capacity (E0-5) — RAW ERROR THẬT ✅

Kịch bản: kênh alice→bob, alice tiêu được 301 CKB, trả invoice 400 CKB → FAIL.

**Cách fail: JSON-RPC trả `error` NGAY (đồng bộ), KHÔNG phải status Created→Failed.**
```json
{
  "error": {
    "code": -32000,
    "message": "Send payment error: Failed to build route, Insufficient balance: max outbound liquidity 30100000000 is insufficient, required amount: 40000000000",
    "data": { "invoice": "fibd400...", "target_pubkey": null, ... (nhiều field null) }
  }
}
```
- `30100000000` = 301 CKB (max outbound), `40000000000` = 400 CKB (required). **Số trong message là DECIMAL** (field RPC khác thì hex — coi chừng).
- `code: -32000` = generic, KHÔNG phân biệt loại lỗi. Phải **parse `message`** để phân loại.

### Mapping raw error → ErrorCategory (E5-4 — `lib/scenario/errorCategory.ts::mapError()`)
| Chuỗi trong message | ErrorCategory | Verify |
|---|---|---|
| "Failed to build route" + "Insufficient balance" / "max outbound liquidity ... insufficient" | `insufficient_outbound` | E0-5 (invoice), E5-3 (keysend) ✅ |
| "Failed to build route" + "PathFind error: no path found" | `no_route_found` | E5-2 ✅ |
| (message TRÙNG insufficient_outbound) + **`list_peers` không còn target** | `peer_offline` | E8-2 ✅ |
| `InvalidParameter: Failed to validate payment request: "invoice is expired"` | `invoice_expired` | E8-1 ✅ |

→ `mapError()` match substring message (code luôn -32000). E5-3: keysend cho CÙNG error như E0-5 invoice: `max outbound liquidity 40100000000 is insufficient, required amount: 45000000000` (401 CKB outbound < 450 CKB).

**E8-2 — peer offline không phân biệt được bằng message.** `docker kill bob` → `send_payment` alice→bob fail với `max outbound liquidity 0 is insufficient` — TRÙNG hệt insufficient_outbound (channel ready+enabled nhưng peer offline ⇒ liquidity dùng được = 0). Phân biệt bằng **`list_peers(alice)` = `[]`** (bob bị xoá khỏi peers NGAY khi send_payment fail, kịp cho seeder ghi `peerConnected:false`). ⇒ `classifyFailure()` ưu tiên peerConnected trước message.

**E8-1 — invoice payment + expired.** `new_invoice(bob, expiry:"0x3"=3s)` → `result.invoice_address` (`fibd1...`). Trả bằng `send_payment [{ invoice }]` (KHÔNG cần target_pubkey/keysend). Sau khi hết hạn → fail ĐỒNG BỘ: `InvalidParameter: Failed to validate payment request: "invoice is expired"` (code -32000, peer vẫn connected) → `invoice_expired`. Seeder: `new_invoice` bắt `invoice_address` theo node nhận; `send_payment useInvoice:true` trả invoice đó.

## 9. Multi-hop routing (E5-2) — graph gossip + fee

- `graph_channels` params `[{}]` → `{ channels: [{ node1, node2, ... }] }`; `graph_nodes` → `{ nodes: [{ node_id, node_name }] }`. Đây là **graph mà node đó đã học qua gossip** (khác `list_channels` = kênh của chính node).
- Node chỉ tự biết kênh của MÌNH ngay; kênh của node khác (vd alice học `bob↔charlie`) phải chờ **gossip lan**.
- **Gossip interval mặc định FNN = 60s** (`--fiber-gossip-network-maintenance-interval-ms`, default 60000; store 20000). Không có bootnode như demo-startup ⇒ alice học `bob→charlie` mất >60s → `send_payment` sớm fail `no path found`. **Fix:** set env `FIBER_GOSSIP_NETWORK_MAINTENANCE_INTERVAL_MS`/`..._STORE_...` = 2000 trong compose ⇒ lan ~vài giây, multi-hop tất định.
- `send_payment` multi-hop giống direct (keysend + target_pubkey) — FNN tự build route nếu graph có path.
- **fee phân biệt hop:** kênh trực tiếp `fee: 0x0`; qua 1 hop trung gian (bob) `fee: 0x989680` = 10,000,000 shannon = 0.1 CKB (= 0.1% × 100 CKB, khớp `tlc_fee_proportional_millionths: 0x3e8`). `get_payment` KHÔNG trả route/hop count — chỉ có `fee` làm bằng chứng runtime có hop trung gian.

## Ghi chú lệch spec cần sửa
- Glossary "Fiber RPC methods" ghi `get_node_info` / `close_channel` — thực tế node 0.8 là
  **`node_info`** và **`shutdown_channel`**. Nên sửa glossary khi rảnh (đã verify tay).
