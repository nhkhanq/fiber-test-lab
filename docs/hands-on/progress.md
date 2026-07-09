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
| **E3-7** Seeder kill_node/start_node/wait | ✅ DONE | `orchestrator.ts` thêm `killNode`/`startNode` (docker kill/start theo container name derive từ run-id qua `containerName()`, `startNode` chờ healthy lại — BR-POL-001). `seeder.ts` `runSeed` nhận thêm `runId` để tính container name; `wait` đã có sẵn từ E3-6. Verify LIVE: kill → container `Status=exited`; start → `running healthy`; steps ghi đúng vào run-log (`kill_node`/`start_node` kèm container name). Lưu ý: payment ngay sau khi node bị kill+restart có thể fail thật ("max outbound liquidity 0") vì channel cần re-establish với peer — hành vi giao thức thật, để dành làm data cho scenario `peer-offline` (E8-2). |
| **E4-1** commander skeleton + `list` | ✅ DONE | `cli/index.ts` — Commander root (`fiber-lab`, version từ `package.json`, error handler top-level → exit 2), thin. `cli/commands/list.ts` — `list [--json]` gọi `lib/scenario/loader.ts::listScenarios()` + `lib/runlog/store.ts::listRuns()` (mới thêm). Scenario lỗi vẫn liệt kê (`valid:false` + message), không crash lệnh. Verify LIVE: `npx tsx cli/index.ts list` in đúng scenario + run có sẵn; `--json` khớp schema run-log; file scenario cố tình sai (`nodes: []`) → liệt kê `INVALID — ...` thay vì throw; `--help`/`--version` chạy đúng. |
| **E4-2** `up <scenario>` end-to-end | ✅ DONE | `cli/commands/up.ts` — validate scenario → `orchestrator.up()` → resume run-log (`RunLogStore.resume`, mới) → `runSeed` (nếu có `channels`/`seed`) → finish + in run-id (`--json` → `{runId,network,nodes}`). Sửa `orchestrator.up()`: bỏ `finish("completed")` sớm (trước kia đánh dấu xong TRƯỚC khi seed chạy) — giờ "completed" chỉ set sau khi `up` (CLI) seed xong; thêm `shouldKeepOnFailure()` gộp `--keep` CLI + `config.keepRunOnFailure` (BR-CLN-003) + in hướng dẫn `logs`/`reset` khi giữ lại. `loader.ts` bắt riêng ENOENT (scenario không tồn tại) → `ScenarioValidationError` thay vì lỗi fs thô, để exit code đúng 1 không phải 2. **Bump `pollTimeoutMs` mặc định 30s → 60s** (`fiber-lab.config.ts` + schema default) — ChannelReady confirm thật ~36-40s, 30s timeout giả liên tục (phát sinh từ E3-6/E3-7). Verify LIVE đủ 4 nhánh: thành công (`direct-channel` settle thật, exit 0, in run-id + `--json` đúng schema); scenario không tồn tại → exit 1; scenario schema sai (`nodes: []`) → exit 1, `list` vẫn không crash; seed lỗi thật (kill_node 2 lần cùng node → docker kill lỗi) → exit 2, auto-teardown sạch; cùng lỗi với `--keep` → container giữ lại + in hướng dẫn, run-log `status:failed`. |
| **E4-3** `reset [run-id]/--all` | ✅ DONE | `cli/commands/reset.ts` — thin wrapper: `reset <run-id>` → `orchestrator.reset()` (1 run); `reset --all`/không tham số → `orchestrator.resetAll()` (mọi run + network `flab_*` còn sót). Output list run đã dọn (`--json` → `{cleaned:[...]}`). Logic đã có sẵn từ E3-4, ticket này chỉ wire CLI. Verify LIVE: `up direct-channel` → `reset <id>` xoá container+network, run-log `status:reset` (giữ file, BR-CLN-002); run lỗi giữa chừng + `--keep` (kill_node lỗi, để lại container + 1 container `Exited`) → `reset --all` dọn sạch cả 2 run, không còn container/network (BR-CLN-001); no-arg == `--all`; reset idempotent (chạy lại trên run đã sạch → exit 0). |
| **E4-4** `logs <run-id> [--rpc] [--json]` | ✅ DONE | `cli/commands/logs.ts` — thin wrapper đọc `RunLogStore.load(runId)`: mặc định in tóm tắt (status, network, started/finished, nodes+endpoint, steps, đếm RPC); `--rpc` in đầy đủ từng RPC (node/method/params/response|error thô — BR-POL-004); `--json` in nguyên run-log. Run-id không tồn tại (ENOENT) → message rõ + exit 1. Verify LIVE: `up direct-channel` → summary in đúng 2 step + payment Success; `--rpc` in đủ 45 RPC raw (node_info/connect_peer/open_channel/list_channels/send_payment...); `--json` parse ra đủ 10 key schema; **logs vẫn chạy SAU `reset`** (file giữ lại, status `reset`) — đúng vai trò run-log là bản ghi debug duy nhất còn lại sau teardown (BR-CLN-002). |
| **E4-5** `seed <scenario> [--run]` | ✅ DONE | `cli/commands/seed.ts` — chạy lại CHỈ phần `seed` (không mở lại channel) trên 1 run đang chạy. Không `--run` → `latestRunForScenario()` (run mới nhất chưa reset, mới thêm ở store.ts); có `--run` → load đúng run đó. Dựng `FiberClient` từ `nodes[].endpoint` trong run-log + resume run-log, gọi `runSeedSteps` rồi in các step vừa chạy (`--json` → mảng `StepRecord` đúng spec). **Refactor seeder.ts:** tách `resolveNodes` (node_info→pubkey+dns4 address) + `runSeedSteps` (chỉ seed step) ra khỏi `runSeed` (= resolve + open channels + runSeedSteps); `up` vẫn dùng `runSeed` nguyên vẹn. Verify LIVE: `up direct-channel` (payment #1 settle) → `seed direct-channel` re-run send_payment (payment #2 Success, KHÔNG mở lại channel) → `seed --run <id> --json` (payment #3 Success); run-log tích luỹ 4 step (1 open + 3 send, đều Success), 55 RPC. Error path: scenario không tồn tại → exit 1; không có run sống → exit 1 (message gợi ý `up`); sau `reset` no-arg seed bỏ qua run đã reset → exit 1. |
| **E4-6** Exit codes chuẩn (0/1/2/3) + `--keep` | ✅ DONE | Hạ tầng tập trung: `EXIT_CODES` (ok/validation/runtime/expectation) ở `constants.ts`; `lib/errors.ts` — `CliError` (mang sẵn exitCode) + `exitCodeFor()` map lỗi → code (ScenarioValidationError→1, DockerError→2, CliError→code riêng, mặc định 2). `cli/index.ts` top-level handler dùng `exitCodeFor` thay vì hardcode 2. Các command bỏ `process.exitCode=…` rải rác, đổi sang throw `CliError`/để lỗi domain bubble. **Exit 3 (expect mismatch) có producer thật:** `lib/scenario/verify.ts::verifyExpectation()` so `expect.status` coarse (succeeded/failed) với kết quả `send_payment`; `up` ghi step `expect` vào run-log rồi throw `CliError(...,expectation)` nếu lệch — run **giữ nguyên** (không teardown) để debug. `reason`/`routeHops` để dành E5-4. Verify LIVE đủ 6 nhánh: **0** (up direct-channel, expect step `match:true`); **1** (scenario không tồn tại / schema sai không tạo container / logs run-id sai / seed không có run sống); **2** (kill_node ×2 → docker lỗi, auto-teardown sạch) + **2 với `--keep`** (container giữ lại, run-log `status:failed`, in guidance); **3** (scenario cố tình `expect:failed` nhưng payment Success → exit 3, run giữ chạy, run-log ghi `match:false`). |
| **E5-1** `direct-channel` + determinism 3 run | ✅ DONE | Scenario đã có từ E3-2; ticket này thêm **kiểm chứng tất định** (BR-DET-001). Tách orchestration `up` ra `lib/scenario/run.ts::runScenario()` (load→dockerUp→seed→verifyExpectation→finish, KHÔNG teardown khi OK; seed lỗi→teardown/keep+throw CliError(2); trả `{scenario,up,store,expectation}`) — `cli/commands/up.ts` giờ chỉ gọi runScenario + xử exit-3/in run-id (mỏng hơn hẳn); dùng chung cho test-kit E6. Test `test/direct-channel.determinism.test.ts` (Vitest) chạy `runScenario` **3 lần tuần tự**, mỗi lần assert `expectation.match===true` + `send_payment.status===Success`, chuẩn hoá kết quả (bỏ run-id/timestamp/hash/port) rồi so 3 run `toEqual` giống hệt, reset sau mỗi run (finally). **Fix Vitest+ESM:** `@ckb-ccc/fiber` import thư mục `dist/utils` không đuôi → thêm `vitest.config.ts` inline `/@ckb-ccc\/fiber/` để resolver Vite xử (tsx tự làm được, node ESM thì không); KHÔNG inline `@ckb-ccc/core` (bundle vỡ signer tree). Verify LIVE: `npm test` PASS (1/1, 181s) — 3 run `direct-channel` cho outcome giống hệt (payment Success, fee 0x0, failed_error null, expect match), tự reset sạch sau mỗi run, docker clean cuối. |
| **E5-2** `two-hop-route` (A-B-C) | ✅ DONE | Scenario `topology/scenarios/two-hop-route.yaml` (alice→bob, bob→charlie; seed send_payment alice→charlie; expect status succeeded + routeHops 1). **3 phát hiện thật:** (1) gửi ngay sau ChannelReady → `PathFind error: no path found` vì gossip chưa lan kênh `bob→charlie` tới alice (missing-wait, BR-DET-001). (2) **Gossip interval FNN mặc định 60s** (`--fiber-gossip-network-maintenance-interval-ms`), không có bootnode như demo-startup ⇒ lan >60s. Fix: env `FIBER_GOSSIP_NETWORK/STORE_MAINTENANCE_INTERVAL_MS=2000` trong compose (`constants.ts` + `compose.template.ts`) ⇒ lan ~vài giây. (3) `get_payment` KHÔNG trả route/hop — bằng chứng runtime của hop là **fee**: direct `0x0` vs 1-hop `0x989680` (0.1 CKB phí bob). **Seeder:** thêm `waitForRoute` (poll `graph_channels` tới khi target xuất hiện, best-effort, trước send_payment) — direct peer có sẵn nên direct-channel không chậm thêm. **verify.ts:** `routeHops` = số hop BFS trên topology channels (vô hướng, edges-1), đối chiếu fee>0 khi hop≥1; `match` gộp status + routeHops. Verify LIVE: `up two-hop-route` exit 0, payment Success, fee 0x989680, `routeHops {expected:1,actual:1,match:true}`. Test `test/two-hop-route.test.ts` (1 run: assert success + routeHops + fee>0). |
| **E5-3** `insufficient-capacity` + **E5-4** map ErrorCategory | ✅ DONE (decisions-log chờ human) | Scenario `topology/scenarios/insufficient-capacity.yaml` (kênh alice→bob cap 500 → alice outbound ~401 CKB; seed send_payment 450 CKB > 401; expect status failed + reason `insufficient_outbound`). **E5-4:** `lib/scenario/errorCategory.ts::mapError()` — map raw message → ErrorCategory bằng substring (FNN luôn code -32000). Verify LIVE 2 mapping: `insufficient_outbound` (`Insufficient balance`/`max outbound liquidity … insufficient`), `no_route_found` (`PathFind error: no path found`); loại khác để E8. **verify.ts:** refactor gọn thành `verifyRouteHops`/`verifyReason` + gộp `match` (status && routeHops? && reason?); `verifyReason` lấy lỗi thô của send_payment fail → mapError → so `expect.reason`. Verify LIVE `up insufficient-capacity` exit 0 (fail đúng kỳ vọng), run-log: send_payment error `max outbound liquidity 40100000000 insufficient, required 45000000000` (401<450), `reason {expected:insufficient_outbound, actual:insufficient_outbound, match:true}` — **keysend cho CÙNG error như E0-5 invoice**. Test `test/insufficient-capacity.test.ts`. Glossary cập nhật bảng mapping đã-verify. **decisions-log CHƯA ghi — cần human confirm** (BR quy trình). |
| E6 → E8 | ⬜ chưa | HẾT E5 (scenarios must-have: direct/two-hop/insufficient). Kế: E6-1 `setupScenario()` test-kit (đã có `runScenario` để tái dùng), E6-2 `expectPaymentSucceeds/Fails`; rồi E7 docs, E8 stretch scenarios. |

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

## ⏸️ ĐIỂM DỪNG — E3-7 XONG (kill_node/start_node/wait), làm tiếp E4

**E3-7 DONE (2026-07-07):** `killNode`/`startNode` trong `orchestrator.ts` (docker kill/start theo container
derive từ run-id, `startNode` chờ healthy lại qua `waitForReady`). `runSeed` nhận thêm tham số `runId`.
Verify LIVE: kill → `docker inspect` state `exited`; start → `running healthy`; steps ghi đúng run-log.
Nhận xét: payment gửi ngay sau restart có thể fail thật ("max outbound liquidity 0") vì channel cần
re-establish với peer sau khi container bị kill (SIGKILL, không graceful) — đây là hành vi giao thức thật,
dữ liệu hữu ích cho scenario `peer-offline` (E8-2) sau này, không phải bug của E3-7.

**⚠️ Lưu ý phát sinh:** `waitChannelReady` đôi lúc cần > 30s (`pollTimeoutMs` mặc định) để funding tx
confirm trên CKB devnet — không phải lỗi, chỉ là timing; cân nhắc tăng default hoặc README ghi chú khi
làm E4/E7.

**👉 Việc kế (E4 — CLI commander):** wire `list`/`up`/`reset`/`logs`/`seed` qua `lib/` (up → validate → up →
seed → run-log → print run-id), exit codes chuẩn (0/1/2/3) + `--keep`. Sau đó E5 scenarios, E6 test-kit.

---
### (cũ) ĐIỂM DỪNG — E3-6 XONG

**E3-6 DONE (2026-07-07):** seeder chạy trọn direct-channel, payment 100 CKB settle thật. Chốt quan trọng:
- **Faucet = pre-fund genesis** (không faucet runtime): 3 key cố định `0x1111/2222/3333` (lock args f949/a1d8/bd67),
  mỗi node 10 tỷ CKB từ dev.toml issued_cells, gán theo node index.
- **SDK canary @ckb-ccc/fiber LỆCH FNN 0.8 nhiều field** → FiberClient.rawCall (JSON-RPC thô):
  node_info trả `pubkey` (SDK đọc `node_id`→undefined); open_channel đòi `pubkey` (SDK gửi `peer_id`);
  list_channels/list_peers field snake. connect_peer/send_payment/new_invoice OK qua raw.
- **connect_peer phải dùng address `/dns4/<node>/...`** (addresses[0] là 0.0.0.0 không dial được); chờ list_peers có peer trước open.
- send_payment async → poll get_payment tới Success/Failed (catch lỗi để scenario fail-case vẫn record).

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
