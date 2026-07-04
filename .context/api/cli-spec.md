---
type: cli_specification
version: 1.0
last_updated: 2026-07-04
tags: [cli, commander, commands]
---

# CLI Specification — fiber-lab


## Quy ước chung

- Mọi lệnh in kết quả dạng người đọc được ra stdout; thêm `--json` để in JSON máy đọc được (cho CI).
- Exit code: `0` thành công, `1` lỗi cấu hình/validation, `2` lỗi runtime (docker/RPC), `3` expectation không khớp.
- Mọi lệnh đọc `fiber-lab.config.ts` (global config) trừ khi override bằng flag.

## Lệnh

### `fiber-lab up <scenario> [--json] [--keep]`
Dựng topology cho kịch bản.
- `<scenario>` — tên file trong `topology/scenarios/` (không cần đuôi `.yaml`)
- `--keep` — không tự teardown khi lỗi (để debug)
- **Làm gì:** validate YAML → sinh run-id → sinh compose động → `docker compose up` → chờ node ready → offckb faucet → mở channel theo `channels` → chờ channel READY.
- **Output:** in `run-id` (dùng cho các lệnh sau). `--json` → `{ runId, network, nodes: [...] }`.
- **Lỗi:** schema sai → exit 1; docker/RPC lỗi → exit 2, run-log ghi lại nguyên nhân.

### `fiber-lab seed <scenario> [--run <run-id>] [--json]`
Chạy phần `seed` của kịch bản trên 1 run đang chạy.
- Nếu không có `--run` → dùng run mới nhất của scenario đó.
- **Làm gì:** thực thi tuần tự `SeedStep[]` (send_payment, new_invoice, kill_node, wait...), ghi từng bước vào run-log.
- **Output:** kết quả từng step. `--json` → mảng `StepRecord`.

> Ghi chú: `up` có thể tự chạy seed luôn nếu scenario có phần `seed`. `seed` riêng dùng khi muốn chạy lại/điều khiển thủ công.

### `fiber-lab reset [run-id] [--all]`
Teardown và dọn dẹp.
- `reset <run-id>` — dọn đúng 1 run (docker down + xoá network + xoá port map).
- `reset --all` (hoặc `reset` không tham số) — dọn TẤT CẢ run của Test Lab.
- **Output:** danh sách run đã dọn.
- **Đảm bảo:** không để lại container/network rác — kể cả khi `up` trước đó bị lỗi giữa chừng.

### `fiber-lab logs <run-id> [--json] [--rpc]`
In run-log.
- Mặc định: tóm tắt các step + status.
- `--rpc` — in đầy đủ mọi RPC call (method/params/response/error thô) — để debug sâu.
- `--json` — in nguyên file run-log JSON.

### `fiber-lab list [--json]`
- Liệt kê các scenario có sẵn (đọc `topology/scenarios/`) kèm `description`.
- Liệt kê các run đang chạy (đọc `.fiber-lab/runs/`) kèm status.

## Dùng chung với test-kit (Vitest)

test-kit không gọi CLI qua shell — import trực tiếp `lib/` để lấy context 1 run:
```typescript
import { setupScenario } from "fiber-test-lab/test-kit"
import { expectPaymentFails } from "fiber-test-lab/test-kit"

const ctx = await setupScenario("insufficient-capacity")   // ~ up + seed
await expectPaymentFails(ctx, ctx.lastPaymentId, "insufficient_outbound")
await ctx.reset()
```
`ctx` bao gồm: `runId`, hàm gọi RPC theo tên node, `lastPaymentId`, `reset()`.
