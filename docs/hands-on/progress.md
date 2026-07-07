# Tiến độ backlog — Fiber Test Lab

> Cập nhật khi làm. Nguồn ticket: `.context/processes/backlog.md`.
> Cách học: đi tuần tự E0 (thực hành tay, chưa code) → E1 → ... Style: "giải thích rồi tự gõ".

## Trạng thái

| Ticket | Trạng thái | Ghi chú |
|---|---|---|
| **E0-1** Clone + up + reach node | ✅ DONE | Stack chạy, curl `node_info` node1 ra kết quả. |
| **E0-2** Đọc quick-start official | ⬜ chưa | Đã đọc README demo-startup (nhiều phần trùng). |
| **E0-3** Mở channel + payment (tay) | ✅ DONE | connect_peer → open_channel → ChannelReady → new_invoice(bob) → send_payment(alice) OK: 100 CKB dịch, fee 0. (close_channel chưa thử — optional.) |
| **E0-4** RPC notebook | ✅ DONE | `docs/hands-on/rpc-notebook.md` — đủ 8 RPC lõi + raw error, params/response thật. |
| **E0-5** Ép lỗi over-capacity | ✅ DONE | Raw error thu được: code -32000, message "Failed to build route... Insufficient balance... max outbound liquidity". Map → `insufficient_outbound`. |
| **E1-1** Check license demo-startup | ⚠️ ĐÃ KIỂM TRA — RỦI RO | demo-startup KHÔNG có file LICENSE (API null). nervosnetwork/fiber cũng không có license rõ ràng. "No license" = all-rights-reserved. CẦN human quyết cách xử lý (liên hệ tác giả / reimplement compose / chấp nhận rủi ro hackathon). Chưa ghi decisions-log (chờ confirm). |
| **E1-2** Document compose | ✅ DONE (draft) | `docs/hands-on/demo-startup-compose.md`, verify khớp thực tế. |
| **E1-5** Pin FNN version | ✅ DONE (bản chất) | FNN `0.8.0` (335a74a) → `fiber-lab.config.ts` fnnVersion. SDK @ckb-ccc pin cứng canary trong package.json. Bảng version chính thức để E7-1 (scenario-catalog.md). |
| **E2-1** Init repo/tsconfig/folders | ✅ DONE | npm install OK, cấu trúc khớp §10. (10 npm audit warns — KHÔNG fix-force, giữ pin canary.) |
| **E2-2** fiber-lab.config.ts + loader | ✅ DONE | lib/config.ts (zod schema + loadConfig) + fiber-lab.config.ts. typecheck pass, load trả đúng giá trị. |
| **E2-3** lib/fiber/client.ts | ✅ DONE | FiberClient wrap @ckb-ccc/fiber, gọi RPC theo tên node + logger hook. Verify thật: getNodeInfo/listChannels vào alice(10001) OK, đọc đúng kênh E0. |
| **E2-4** lib/runlog/store.ts | ✅ DONE | RunLogStore (zod schema, create/recordRpc/recordStep/finish/save/load). Verify: client→store→file→load OK, JSON khớp schema. HẾT EPIC E2. |
| **E3-1** zod schema scenario | ✅ DONE | lib/scenario/schema.ts — Channel/SeedStep/Expectation + superRefine (node refs, capacity>=100, reason chỉ khi failed). |
| **E3-2** loader YAML + zod | ✅ DONE | lib/scenario/loader.ts — parse YAML, safeParse, ScenarioValidationError liệt kê field lỗi, check name khớp file. Sample: topology/scenarios/direct-channel.yaml. |
| **E3-3** compose động | ✅ DONE | `topology/compose.template.ts` sinh compose từ scenario+run-id (1 CKB + N FNN, network `flab_<run-id>`, container prefix, không bind host, healthcheck/depends_on). Verify: typecheck + smoke render + `docker compose config` VALID. **CKB genesis-custom LIVE-BOOT OK** (xem dưới). |
| **E3-4** orchestrator up/down | ✅ DONE | `lib/docker/orchestrator.ts` — `up` (sinh run-id + compose + `docker compose up -d --build`, fail giữa chừng → tự teardown), `teardown`/`reset`/`resetAll` (down -v + fallback xoá theo label + rm network), `reset` đánh dấu run-log `status:reset` (giữ file, BR-CLN-002). Verify LIVE trên Docker: composeUp→network+container tồn tại→teardown→sạch; teardown idempotent; reset marks status. |
| **E3-5** wait-for-READY + FNN config | ✅ DONE | FNN boot THẬT trên devnet reimplement. `lib/fiber/nodeConfig.ts` sinh config.yml+sk+ckb/key per-node; FNN Dockerfile+entrypoint (bind RPC vào IP private → né biscuit, dev.toml+fiber-scripts baked); compose FNN volume/command/env + healthcheck qua `hostname -i`; orchestrator `waitForReady` poll docker health. Verify LIVE: `up direct-channel` → alice+bob READY 14s, node_info.chain_hash=devnet mình → reset sạch. |
| **E3-6** seeder | ✅ DONE | `lib/scenario/seeder.ts` — connect_peer → open_channel → poll ChannelReady → send_payment (poll get_payment tới Success) + new_invoice; faucet = pre-fund genesis (3 key cố định, 10 tỷ CKB/node). FiberClient thêm `rawCall` (SDK canary lệch FNN 0.8: node_info/open_channel/list_peers dùng field khác). Verify LIVE `direct-channel`: **100 CKB settle** (alice 401→301, bob 0→100), 27 RPC logged, reset sạch. Cũng chứng minh E5-1. |
| E3-7 → E8 | ⬜ chưa | Kế: E3-7 seeder kill_node/start_node/wait. |

## Mốc dữ liệu đã chốt (thật, không đoán)

- FNN pin: **0.8.0**, commit `335a74a 2026-04-03`.
- RPC method `node_info` (không phải `get_node_info`); số trả về là **hex string**; `result:null` = OK.
- Ports host: bootnode 10000, node1/alice 10001, node2/bob 10002, node3/charlie 10003.
- Min channel funding = 100 CKB (`0x2540be400`).
- Chữ ký RPC chuẩn cho 0.8: xem `rpc-notebook.md` (trích từ code thật demo-startup).

## Sửa môi trường đã áp dụng

- docker-compose.yml của demo-startup: subnet `172.21.0.0/16` → `172.30.0.0/16`
  (+ IP node 172.30.0.10-13) vì đụng `server_default`.

## Sub-decision fiber-scripts — ĐÃ GIẢI (2026-07-06, ⏳ chờ human confirm để ghi decisions-log)

- **B3 (offckb) loại:** offckb 0.4.7 genesis KHÔNG có FundingLock/CommitmentLock (verify tay bundled dev.toml).
- **CHỌN B2:** tải fiber-scripts compiled từ **repo FNN tag v0.8.0** (`tests/deploy/contracts/`) — cùng version FNN đã pin, deterministic. Chi tiết: `e3-3-infra-research.md` §"Sub-decision ĐÃ GIẢI".
- **CKB pin:** `nervos/ckb:v0.207.0` (bản pair với offckb 0.4.7). → Cần human confirm 3 mục này trước khi append decisions-log.

## ✅ CKB genesis-custom — LIVE-BOOT VERIFIED (2026-07-06)

Build + boot `topology/docker/ckb.Dockerfile` standalone:
- Image build OK (fiber-scripts tải từ FNN v0.8.0 tag ổn).
- `ckb run` khởi động, RPC `get_tip_block_number` trả `0x0` → miner chạy → tip tiến **0x0→0x4** (dummy pow),
  ⇒ key faucet sẽ có tiền để cấp cho node.
- Genesis tx[0] có **14 output system-cell** (4 chuẩn từ `ckb init -c dev` + 5 fiber: auth/funding-lock/
  commitment-lock/simple_udt/xudt_rce nhúng thành công — genesis dựng được ⇒ file script hợp lệ).
- ⚠️ Còn PENDING: đối chiếu `create_type_id`/thứ tự cell với FNN `node_info.default_funding_lock_script`
  (chỉ chốt được khi FNN kết nối vào — thuộc E3-5).

## ⏸️ ĐIỂM DỪNG — E3-6 XONG (direct-channel payment settle), làm tiếp E3-7

**E3-6 DONE (2026-07-07):** seeder chạy trọn direct-channel, payment 100 CKB settle thật. Chốt quan trọng:
- **Faucet = pre-fund genesis** (không faucet runtime): 3 key cố định `0x1111/2222/3333` (lock args f949/a1d8/bd67),
  mỗi node 10 tỷ CKB từ dev.toml issued_cells, gán theo node index.
- **SDK canary @ckb-ccc/fiber LỆCH FNN 0.8 nhiều field** → FiberClient.rawCall (JSON-RPC thô):
  node_info trả `pubkey` (SDK đọc `node_id`→undefined); open_channel đòi `pubkey` (SDK gửi `peer_id`);
  list_channels/list_peers field snake. connect_peer/send_payment/new_invoice OK qua raw.
- **connect_peer phải dùng address `/dns4/<node>/...`** (addresses[0] là 0.0.0.0 không dial được); chờ list_peers có peer trước open.
- send_payment async → poll get_payment tới Success/Failed (catch lỗi để scenario fail-case vẫn record).

**👉 Việc kế (E3-7):** seeder `kill_node`/`start_node` (docker kill/start theo container run-id) + `wait`.
Sau đó E4 (CLI commander) wire up→seed→run-log, E5 scenarios, E6 test-kit.

---
### (cũ) ĐIỂM DỪNG — E3-5 XONG

**E3-5 DONE (2026-07-07):** FNN boot thật trên CKB devnet reimplement. Recipe FNN devnet đã chốt:
- Config FNN devnet KHÔNG cần scripts section (đọc từ chain spec). `fiber.chain: /flab/dev.toml` (baked).
- FNN RPC phải bind IP private container (không 0.0.0.0) để né biscuit auth → entrypoint `hostname -i`.
- Mỗi node: base dir mount (`config.yml` + `fiber/sk` 32B + `ckb/key` hex), env `FIBER_SECRET_KEY_PASSWORD`.
- `up direct-channel` → alice+bob READY 14s (verify node_info), reset sạch.

**👉 Việc kế (E3-6 — seeder):** faucet cấp CKB từ account `0xc8328aab…` (20 tỷ, privkey `d00c06bf…`) →
mỗi node (dùng ckb/key đã sinh); connect_peer; open_channel + poll ChannelReady (BR-POL-002);
send_payment/new_invoice; ghi mọi RPC vào run-log qua FiberClient logger. Cần port-map RPC ra host cho
FiberClient (ngoài docker) — hoặc gọi qua `docker exec`. Xem `.context/business-rules` BR-SEED-*.

---
### (cũ) ⏸️ ĐIỂM DỪNG — làm tiếp ở E3-5

**E3-3 + E3-4 xong + verify** (typecheck + smoke + live Docker). Files:
- `topology/compose.template.ts`, `lib/constants.ts` (pin hạ tầng + WORK_DIR).
- `topology/docker/ckb.Dockerfile` + `ckb/entrypoint.sh` (genesis-custom, đã live-boot + fix determinism).
- `lib/docker/orchestrator.ts` (`up`/`teardown`/`reset`/`resetAll` + `composeUp` seam).
- `lib/runlog/store.ts` — thêm `setStatus` (đánh dấu reset không xoá file).

**Genesis determinism DONE (2026-07-06):** fix `genesis_cell.message` (ghim `flab-devnet`) → genesis/out-point
deterministic giữa các boot. Đã trích **code_hash + index** 5 cell fiber (cellbase `0x7dcd6cec…`) — xem
`e3-3-infra-research.md` §Live-boot. ⇒ E3-5 step 1 "chốt create_type_id" coi như đã có dữ liệu.

**👉 Việc kế (E3-5 — wait-for-READY + FNN config):**
- ✅ **Genesis align fiber devnet DONE (2026-07-06):** rewrite `ckb/entrypoint.sh` → dev.toml khớp
  `tests/nodes/deployer/dev.toml` (create_type_id=false, message ckb_dev, faucet 20 tỷ CKB tới
  `0xc8328aab…` privkey `d00c06bf…`). Verify live: boot OK, cells index auth=5/funding=6/commitment=7/
  sudt=8/xudt=9, faucet balance = 20 tỷ. Config FNN devnet KHÔNG cần scripts section (đọc từ chain spec).
1. **Share dev.toml + /fiber-scripts sang FNN container** (volume) → FNN config.yml (`fiber.chain: dev.toml`,
   `ckb.rpc_url: http://ckb:8114`, rpc `0.0.0.0:8227`) + sinh secret key → boot FNN thật.
2. Đối chiếu `node_info.default_funding_lock_script` == data-hash funding-lock; poll node_info READY (BR-POL-001).
3. Faucet: phân phối CKB từ account faucet (đã nạp 20 tỷ trong genesis) → từng node.

**Git:** E3-3 = PR #44 (→ canary). E3-4 + genesis-determinism-fix trên branch `feat/e3-4-orchestrator`.

## Đã hoàn thành (E0–E3-2 + E3-3 code)

E0 (hands-on) · E1-1/1-2/1-4/1-5 · E2-1..E2-4 (skeleton) · E3-1 (schema) · E3-2 (loader) · **E3-3 (compose.template.ts + CKB genesis infra, chờ live-boot)**.
Issues đóng: #4–17, #41, #42.
