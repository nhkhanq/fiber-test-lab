---
type: data_dictionary
version: 1.0
last_updated: 2026-07-04
tags: [yaml, zod, scenario, run-log, schema]
---

# Data Dictionary — Scenario Schema + Run-log

> Test Lab không có database. "Dữ liệu" của nó gồm 2 loại: **file kịch bản YAML** (input, dev viết) và **run-log JSON** (output, hệ thống ghi). File này định nghĩa cả hai. Mọi file YAML phải validate qua `zod` khớp schema dưới đây trước khi dùng.

## 1. Scenario file (`topology/scenarios/<name>.yaml`)

### Cấu trúc tổng thể
```yaml
name: string                 # định danh kịch bản, khớp tên file
description: string          # mô tả ngắn, hiện ở `fiber-lab list`
nodes: string[]              # tên các node, VD [alice, bob, carol]
channels: Channel[]          # channel mở sẵn khi seed
seed: SeedStep[]             # hành động chạy sau khi topology sẵn sàng
expect: Expectation          # kết quả mong đợi (dùng cho test-kit + tự-verify)
```

### Kiểu `Channel`
| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| from | string | ✓ | Tên node mở channel (phải có trong `nodes`) |
| to | string | ✓ | Tên node đối diện (phải có trong `nodes`) |
| capacity | number | ✓ | Capacity (CKB) node `from` khoá vào channel |
| asset | "CKB" \| "RUSD" | | Mặc định "CKB" |
| push | number | | Số CKB đẩy sẵn sang `to` khi mở (tạo inbound cho `from`) |

### Kiểu `SeedStep`
| Field | Type | Mô tả |
|---|---|---|
| action | "send_payment" \| "new_invoice" \| "wait" \| "kill_node" \| "start_node" | Hành động |
| from | string | Node thực hiện (với send_payment) |
| to | string | Node đích |
| amount | number | Số tiền (send_payment/new_invoice) |
| asset | "CKB" \| "RUSD" | Mặc định "CKB" |
| expiresInSec | number | Với new_invoice — set hết hạn ngắn để test |
| node | string | Với kill_node/start_node — node bị tác động |
| durationSec | number | Với wait — chờ bao lâu |

### Kiểu `Expectation`
| Field | Type | Mô tả |
|---|---|---|
| status | "succeeded" \| "failed" | Kết quả payment cuối cùng mong đợi |
| reason | ErrorCategory | Nếu failed — mã lỗi mong đợi (xem glossary) |
| routeHops | number | Số hop trung gian mong đợi (VD 1 cho A-B-C) |

### Ví dụ đầy đủ
```yaml
name: insufficient-capacity
description: Payment fail vì outbound không đủ
nodes: [alice, bob]
channels:
  - { from: alice, to: bob, capacity: 50 }
seed:
  - action: send_payment
    from: alice
    to: bob
    amount: 500
expect:
  status: failed
  reason: insufficient_outbound
```

## 2. Run-log (`.fiber-lab/runs/<run-id>.json`)

Ghi lại toàn bộ 1 lần `fiber-lab up` để debug lại sau khi container đã bị reset.

| Field | Type | Mô tả |
|---|---|---|
| runId | string | Định danh duy nhất lần chạy |
| scenario | string | Tên scenario đã chạy |
| status | "running" \| "completed" \| "failed" \| "reset" | Trạng thái tổng |
| startedAt | ISO8601 | Thời điểm bắt đầu |
| finishedAt | ISO8601 \| null | Thời điểm kết thúc |
| network | string | Tên docker network (flab_<run-id>) |
| nodes | NodeRecord[] | Danh sách node + container name + port map tạm (nếu có) |
| steps | StepRecord[] | Từng bước seed: action, input, kết quả |
| rpcCalls | RpcRecord[] | Mọi RPC gọi ra: method, params, response/error thô |
| error | string \| null | Lỗi tổng nếu có |

### Kiểu `RpcRecord` (quan trọng để debug)
| Field | Type | Mô tả |
|---|---|---|
| node | string | Node đích của RPC |
| method | string | VD open_channel, send_payment |
| params | object | Tham số gửi đi |
| response | object \| null | Kết quả thô |
| error | object \| null | Lỗi thô từ node (giữ nguyên để debug) |
| at | ISO8601 | Thời điểm gọi |

> Run-log là "nguồn sự thật" để hiểu vì sao 1 test fail — vì sau `reset`, container không còn để hỏi lại.

## 3. Quy tắc validation (zod)

- `channels[].from`/`to` phải nằm trong `nodes` — nếu không: lỗi rõ "node X không khai báo trong nodes".
- `capacity` phải > mức reserve tối thiểu (99 CKB/bên — xem glossary) nếu không muốn channel bị từ chối.
- `expect.reason` chỉ được set khi `expect.status === "failed"`.
- Tên scenario `name` nên khớp tên file để tránh nhầm.
