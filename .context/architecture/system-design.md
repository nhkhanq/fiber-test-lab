---
type: architecture
version: 1.0
last_updated: 2026-07-04
tags: [typescript, docker-compose, fiber-node, offckb, cli, testing, local]
---

# System Design — Fiber Test Lab

> Đây là file định nghĩa kiến trúc chi tiết nhất. Mọi quyết định implement phải khớp file này.

## 1. Tech Stack

| Layer | Technology | Lý do |
|-------|-----------|-------|
| Ngôn ngữ | TypeScript (strict) | Nhất quán hệ sinh thái Fiber JS/TS, dễ maintain |
| Chạy CLI | `tsx` | Chạy thẳng `.ts` không cần build step riêng — tối ưu tốc độ hackathon |
| CLI framework | `commander` | Nhẹ, đủ cho ~5 lệnh, không cần framework nặng |
| Parse kịch bản | `yaml` | Đọc file scenario `.yaml` |
| Validate schema | `zod` | Validate scenario TRƯỚC khi dựng docker — fail fast, message rõ |
| Container orchestration | Docker + Docker Compose (v2, `docker compose`) | Dựng N node Fiber + 1 CKB devnet, cô lập mạng nội bộ |
| Fiber node | FNN binary (chính thức, pinned version) | Node THẬT, không giả lập giao thức — kết quả test phản ánh hành vi thật |
| CKB devnet | `offckb` | Devnet local + faucet, không phụ thuộc testnet công cộng |
| Gọi Fiber RPC | `@ckb-ccc/fiber` (SDK chính thức) | SDK hackathon khuyến nghị, tránh tự viết JSON-RPC thô |
| Test framework | Vitest | Nhẹ, nhanh, dùng cho `test-kit` và test mẫu |
| Lưu run-log | File JSON (fs) | Vòng đời dữ liệu ngắn — không cần Postgres (xem mục 8) |
| Package manager | npm | 1 package duy nhất, không cần workspace |

**Pinned versions:** FNN binary version và `@ckb-ccc/fiber` version phải ghim cứng trong `docs/scenario-catalog.md` và `package.json` — vì hành vi RPC có thể đổi giữa các bản, kết quả verify chỉ đúng với version đã test.

## 2. Kiến trúc tổng thể

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Máy local của developer                       │
│                                                                       │
│   developer ──> fiber-lab CLI (commander, chạy bằng tsx)             │
│                     │                                                 │
│                     │ 1. đọc scenarios/<name>.yaml                   │
│                     │ 2. validate bằng zod                           │
│                     │ 3. sinh run-id + docker-compose động           │
│                     │ 4. docker compose up (network cô lập theo run-id)│
│                     │ 5. seed: gọi RPC mở channel/tạo invoice        │
│                     │ 6. ghi run-log JSON                            │
│                     ▼                                                 │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │   Docker network cô lập: flab_<run-id>  (KHÔNG bind ra host)   │ │
│   │                                                                 │ │
│   │   ┌──────────┐    ┌──────────┐    ┌──────────┐                 │ │
│   │   │ fnn:alice│◄──►│ fnn:bob  │◄──►│ fnn:carol│  (P2P nội bộ)   │ │
│   │   └────┬─────┘    └────┬─────┘    └────┬─────┘                 │ │
│   │        │               │               │                       │ │
│   │        └───────────────┴───────────────┘                       │ │
│   │                        │ (mỗi fnn kết nối tới CKB devnet)       │ │
│   │                 ┌──────▼───────┐                                │ │
│   │                 │ offckb devnet│  (CKB node local)             │ │
│   │                 └──────────────┘                                │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                     ▲                                                 │
│                     │ RPC (chỉ CLI + test-kit gọi vào, qua           │
│                     │ port map tạm theo run-id hoặc exec trong net)  │
│   test-kit (Vitest) ┘  expectPaymentSucceeds() / expectPaymentFails()│
└─────────────────────────────────────────────────────────────────────┘
```

## 3. Các thành phần và vai trò

### 3.1 `cli/` — fiber-lab (lớp giao tiếp DUY NHẤT vào cụm node)
Không ai gọi thẳng JSON-RPC vào từng container. Mọi thao tác đi qua CLI để đảm bảo state được ghi log và reset đúng. Handler mỏng — chỉ parse tham số rồi gọi vào `lib/`.

Lệnh (đặc tả đầy đủ ở `api/cli-spec.md`):
- `fiber-lab up <scenario>` — dựng topology
- `fiber-lab seed <scenario>` — chạy phần `seed` của kịch bản
- `fiber-lab reset [run-id]` — teardown + xoá state
- `fiber-lab logs <run-id>` — in run-log
- `fiber-lab list` — liệt kê scenario có sẵn + run đang chạy

### 3.2 `topology/` — kịch bản + compose động
- `scenarios/*.yaml` — mỗi file là 1 kịch bản (tầng 1 settings, dev tự viết được). Schema ở `data-dictionary/scenario-schema.md`.
- Compose file **sinh động** từ scenario, KHÔNG viết tay cố định — vì số node/tên/port thay đổi theo scenario + run-id.

### 3.3 `lib/` — logic lõi
- `lib/fiber/client.ts` — wrap `@ckb-ccc/fiber`, gọi RPC tới 1 node cụ thể theo tên
- `lib/docker/orchestrator.ts` — sinh compose, `up`/`down`, cô lập network theo run-id
- `lib/scenario/loader.ts` — đọc + validate YAML (zod)
- `lib/scenario/seeder.ts` — thực thi phần `seed` (mở channel, tạo invoice, kill container...)
- `lib/runlog/store.ts` — ghi/đọc run-log JSON

### 3.4 `test-kit/` — assertion helpers (dùng trong Vitest)
- `expectPaymentSucceeds(ctx, paymentId)`
- `expectPaymentFails(ctx, paymentId, reason)`
- `expectChannelState(ctx, channelId, { status, capacity })`
- Bên trong **poll** RPC theo interval + timeout (vì FNN không tự báo — xem mục 7).

### 3.5 `fiber-lab.config.ts` — global config (tầng 2 settings)
Áp dụng cho MỌI kịch bản, dev chỉnh 1 lần:
```typescript
export default {
  pollIntervalMs: 1000,
  pollTimeoutMs: 30000,
  dockerNetworkPrefix: "flab",
  fnnImage: "fnn:v0.x.y",      // pinned
  logLevel: "info",
  keepRunOnFailure: false,      // giữ container khi test fail để debug
}
```

## 4. Config 2 tầng (phần "settings" cho dev tinh chỉnh)

| Tầng | Ở đâu | Điều chỉnh cái gì | Ai sửa |
|---|---|---|---|
| **Tầng 1 — per-scenario** | `scenarios/<name>.yaml` | 1 tình huống cụ thể: số node, channel nào, capacity, amount, expect gì | Dev tạo/sửa file YAML, KHÔNG đụng code |
| **Tầng 2 — global** | `fiber-lab.config.ts` | Hành vi chung cả hệ thống: timeout, interval poll, prefix, version image | Dev sửa 1 lần, áp dụng toàn bộ |

Dev muốn thêm 1 loại lỗi mới → tạo file `.yaml` mới theo schema, không cần sửa CLI. `zod` đảm bảo báo lỗi ngay nếu file sai khuôn.

## 5. Data Flow — `fiber-lab up two-hop-route`

```
1. CLI đọc scenarios/two-hop-route.yaml
2. loader.ts validate bằng zod → nếu sai schema: in lỗi rõ, exit 1 (chưa đụng docker)
3. sinh run-id (VD: ts + random ngắn) → network name = flab_<run-id>
4. orchestrator.ts sinh compose động: 3 service fnn (alice/bob/carol) + 1 offckb,
   tất cả trong network flab_<run-id>, container name có prefix run-id
5. docker compose up -d → chờ health-check các node sẵn sàng (poll get_node_info)
6. offckb faucet cấp CKB cho địa chỉ funding của từng node
7. seeder.ts đọc phần `channels` → gọi open_channel alice→bob, bob→carol,
   chờ channel READY (poll list_channels)
8. seeder.ts đọc phần `seed` → thực thi (VD send_payment alice→carol amount 100)
9. store.ts ghi run-log JSON: {runId, scenario, steps[], rpcResponses[], startedAt}
10. in run-id ra stdout để dev/test-kit dùng tiếp
```

## 6. Cô lập theo run-id (tránh dẫm chân nhau)

Vấn đề: 2 lần `up` song song (2 terminal, hoặc CI chạy nhiều job) → trùng tên container/port → hỏng.

Giải pháp: mỗi lần `up` sinh 1 **run-id** duy nhất. Toàn bộ tài nguyên gắn prefix theo run-id:
- Docker network: `flab_<run-id>`
- Container: `flab_<run-id>_alice`, `..._bob`, ...
- Run-log file: `./.fiber-lab/runs/<run-id>.json`
- Port map (nếu cần expose tạm cho test-kit): cấp port động, không hardcode

`fiber-lab reset` không tham số → dọn TẤT CẢ run. `reset <run-id>` → chỉ dọn 1 run. (Vai trò tương tự "cơ chế đăng ký app" của FiberGate, nhưng cho "1 lần chạy test" thay vì "1 app".)

## 7. FNN không tự báo trạng thái → polling (và đường nâng cấp)

FNN không push event khi channel/payment đổi trạng thái — phải chủ động hỏi (`list_channels`, `get_invoice`). Vì vậy `test-kit` mặc định **poll** theo `pollIntervalMs` + `pollTimeoutMs` (từ global config).

**Đường nâng cấp (optional, Bước 6):** FNN có RPC `subscribe_store_changes` (module `pubsub`, đã được verify tồn tại thật từ FNN v0.8.1 trong nghiên cứu của Project 1 — xem `project1/.context/architecture/system-design.md` "Phase 2"). Có thể tái dùng kết quả đó để làm test-kit event-driven (chờ đúng event thay vì poll mù), nhanh và ít flaky hơn. KHÔNG bắt buộc cho v1.

## 8. Vì sao KHÔNG dùng database 

- Test Lab: dữ liệu sống vài phút–vài giờ, mỗi `reset` xoá sạch. **File JSON đủ.**
- Nếu về sau cần query phức tạp trên run-log → cân nhắc SQLite (vẫn không cần server DB).

## 9. Bảo mật / cô lập mạng

- Mọi container `fnn` + `offckb` chỉ nghe trong docker internal network `flab_<run-id>`, KHÔNG bind port ra host/internet mặc định.
- Lý do: node test dùng key/tiền devnet giả — nếu lộ port, node lạ kết nối vào phá vỡ topology đã khai báo → sai kết quả test.
- Chỉ khi test-kit cần gọi RPC từ tiến trình Vitest (ngoài docker) mới cấp port map tạm theo run-id, đóng lại khi reset.

## 10. Cấu trúc repo

```
fiber-test-lab/                          
├── cli/
│   ├── index.ts                         — entry (commander)
│   └── commands/                        — up.ts, seed.ts, reset.ts, logs.ts, list.ts
├── lib/
│   ├── fiber/client.ts
│   ├── docker/orchestrator.ts
│   ├── scenario/loader.ts
│   ├── scenario/seeder.ts
│   └── runlog/store.ts
├── topology/
│   ├── compose.template.ts             — sinh compose động
│   └── scenarios/
│       ├── direct-channel.yaml
│       ├── two-hop-route.yaml
│       ├── insufficient-capacity.yaml
│       ├── expired-invoice.yaml
│       └── peer-offline.yaml
├── test-kit/
│   ├── index.ts                        — assertion helpers
│   └── examples/                       — test mẫu (*.test.ts) minh hoạ dùng thật
├── .fiber-lab/runs/                    — run-log JSON (gitignore)
├── fiber-lab.config.ts                 — global config
├── docs/
│   ├── scenario-catalog.md
│   └── README.md
├── package.json
└── tsconfig.json
```

## 11. Ranh giới với FiberGate (Project 1) — không trùng lặp

| | FiberGate (P1) | Fiber Test Lab (P3) |
|---|---|---|
| Category | 3 — Merchant/Liquidity | 2 — Node/Routing/Diagnostics |
| Bài toán | Merchant NHẬN thanh toán ổn định | Developer TEST payment/routing lặp lại được |
| Bề mặt | Web dashboard + REST API + webhook | CLI + file YAML + test-kit |
| Dữ liệu | PostgreSQL (lâu dài) | File JSON (tạm, reset được) |
| Số node | 1 node ra thế giới ngoài | Nhiều node nói chuyện với nhau, mạng kín |
| Môi trường | testnet | offckb devnet local |
| Phụ thuộc | Không import P3 | Không import P1 |

Quy tắc: repo riêng, không import `@fibergate/sdk`, không cần FiberGate chạy. Điểm chung DUY NHẤT được phép: cùng dùng SDK chính thức `@ckb-ccc/fiber` (không phải chia sẻ code, chỉ là cùng chọn 1 thư viện chuẩn).
