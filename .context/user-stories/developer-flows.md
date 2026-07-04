---
type: user_stories
persona: developer
version: 1.0
last_updated: 2026-07-04
tags: [testing, cli, integration-test]
---

# User Stories — Developer dùng Fiber Test Lab

## US-001: Dựng nhanh 1 topology test
**As a** developer build app trên Fiber,
**I want to** dựng 1 mạng Fiber nhiều node bằng 1 lệnh,
**So that** tôi không phải cài/kết nối/mở channel tay mỗi lần test.

**Acceptance:**
- `fiber-lab up two-hop-route` dựng 3 node + 2 channel trong <1 phút
- In ra run-id để dùng tiếp
- Không bind port ra ngoài (an toàn)

## US-002: Viết integration test cho payment logic
**As a** developer,
**I want to** viết test tự động khẳng định "payment fail đúng lý do khi thiếu capacity",
**So that** tôi bắt được regression trong CI mỗi lần commit.

**Acceptance:**
```typescript
const ctx = await setupScenario("insufficient-capacity")
await expectPaymentFails(ctx, ctx.lastPaymentId, "insufficient_outbound")
await ctx.reset()
```
- Chạy được trong Vitest, không cần testnet công cộng
- Kết quả deterministic (chạy 10 lần giống nhau)

## US-003: Tự tạo tình huống lỗi mới không cần sửa code
**As a** developer có case đặc thù,
**I want to** thêm 1 file YAML mô tả tình huống của tôi,
**So that** tôi mở rộng bộ test mà không phải hiểu code CLI.

**Acceptance:**
- Copy 1 scenario mẫu, chỉnh `capacity`/`amount`/`expect`
- `zod` báo lỗi ngay nếu viết sai khuôn
- `fiber-lab up <my-scenario>` chạy được ngay

## US-004: Debug vì sao 1 test fail
**As a** developer,
**I want to** xem lại toàn bộ RPC call của 1 run kể cả sau khi container đã tắt,
**So that** tôi hiểu node thật đã trả gì.

**Acceptance:**
- `fiber-lab logs <run-id> --rpc` in mọi RPC call (method/params/response/error thô)
- Run-log vẫn còn sau `reset`
- `keepRunOnFailure: true` giữ container để debug sâu khi cần

## US-005: Điều chỉnh hành vi chung
**As a** developer,
**I want to** đổi timeout/poll interval cho toàn bộ test,
**So that** phù hợp máy chậm hoặc CI.

**Acceptance:**
- Sửa `fiber-lab.config.ts` 1 chỗ, áp dụng mọi scenario
- Không phải sửa từng file YAML

## US-006: Dọn sạch sau khi test
**As a** developer,
**I want to** xoá toàn bộ container/network test bằng 1 lệnh,
**So that** máy tôi không đầy rác docker.

**Acceptance:**
- `fiber-lab reset --all` dọn mọi run
- Không sót container/network kể cả khi `up` từng lỗi giữa chừng
