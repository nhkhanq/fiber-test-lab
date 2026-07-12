# test-kit examples

Example Vitest tests dùng `fiber-test-lab/test-kit` để assert trên scenario thật (up → seed → assert → reset).

## Prerequisites

- **Docker** đang chạy (compose v2). Test tự dựng/dọn cụm node, không cần stack sẵn.
- Lần chạy đầu **build image FNN + CKB** (vài phút, cache lại cho lần sau).
- Không cần bind port thủ công — mỗi test cô lập theo `run-id`, cấp port map tạm rồi `reset()` dọn sạch.
- Mỗi test tự `ctx.reset()` trong `finally` ⇒ không để lại container/network kể cả khi assert fail.

## Chạy

```bash
npm test                              # toàn bộ (scenarios + examples)
npx vitest run test-kit/examples      # chỉ examples
```

Cụm node boot + channel ready + gossip lan mất ~30–60s mỗi scenario, nên mỗi test đặt timeout rộng.
Kết quả tất định với version đã pin (FNN 0.8.0, `@ckb-ccc/*` canary trong `package.json`).

## API dùng trong examples

- `setupScenario(name)` → `ctx` (`runId`, `call(node, method, params)`, `lastPaymentId`, `reset()`, …); up + seed sẵn.
- `expectPaymentSucceeds(ctx, paymentId?)` — poll `get_payment` tới Success.
- `expectPaymentFails(ctx, paymentId?, reason?)` — payment fail; `reason` map qua ErrorCategory.
- `expectChannelState(ctx, channelId, { status?, capacity? })` — state_name + capacity (CKB) của channel.
