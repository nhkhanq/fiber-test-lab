---
type: process
version: 1.0
last_updated: 2026-07-04
tags: [dod, checklist, quality]
---

# Definition of Done — Fiber Test Lab

## DoD cho 1 feature/scenario

Một scenario được coi là "done" khi:
- [ ] File YAML validate qua `zod` không lỗi
- [ ] `fiber-lab up <scenario>` dựng thành công, node đạt READY
- [ ] `fiber-lab seed` chạy hết các step, ghi run-log đầy đủ
- [ ] Kết quả khớp `expect` một cách **deterministic** (chạy 3 lần liên tiếp giống nhau)
- [ ] `fiber-lab reset` dọn sạch, không sót container/network
- [ ] Có mô tả trong `docs/scenario-catalog.md` (dùng để làm gì, giới hạn đã biết)

## DoD cho `test-kit`

- [ ] `expectPaymentSucceeds` / `expectPaymentFails` / `expectChannelState` hoạt động
- [ ] Poll có timeout, khi fail đính kèm run-log để debug
- [ ] Ít nhất 1 file test mẫu trong `test-kit/examples/` chạy pass với Vitest
- [ ] Test mẫu chạy được từ trạng thái sạch (`git clone` → `npm install` → chạy được, có hướng dẫn prerequisite)

## DoD cho toàn dự án (submission)

- [ ] README: vấn đề → giải pháp → cách chạy (prerequisite: Docker, offckb, FNN version)
- [ ] 3 scenario must-have chạy được end-to-end
- [ ] `docs/scenario-catalog.md` liệt kê mọi scenario + giới hạn + pinned versions
- [ ] Video demo (3–5 phút): dựng scenario → chạy test pass/fail → xem run-log → reset
- [ ] Repo open-source, có LICENSE (MIT)
- [ ] Document rõ trade-offs: devnet≠mainnet, peer-offline giả bằng docker kill, bảo trì theo version FNN

## Checklist tự-verify cuối mỗi coding session

- [ ] Code mới có validate input YAML qua zod chưa?
- [ ] Có thao tác docker nào không cleanup được qua reset không?
- [ ] Có hardcode port/tên container thay vì sinh từ run-id không?
- [ ] Run-log có ghi đủ RPC call (kể cả thành công) để debug không?
- [ ] Có làm flaky test không (thiếu chờ READY)? — nếu có, coi là bug phải sửa.
- [ ] Cập nhật `decisions-log.md` nếu có quyết định mới được human chốt?
