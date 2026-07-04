---
type: business_context
version: 1.0
last_updated: 2026-07-04
tags: [vision, scope, hackathon, testing, category-2]
---

# Project Vision — Fiber Test Lab

## Vấn đề đang giải quyết

Payment channel (Fiber cũng như Lightning) tạo ra các tình huống lỗi **không tồn tại** trong giao dịch blockchain thông thường:
- Thiếu capacity theo chiều (outbound/inbound)
- Route multi-hop có thể đứt giữa chừng
- Peer/node trung gian offline
- Invoice hết hạn

Hiện tại, cách DUY NHẤT để "chạm" vào các tình huống này là tạo ra chúng thật trên **testnet công cộng Pudge**:
- **Chậm** — chờ block thật (~vài giây/block)
- **Chia sẻ** — trạng thái mạng đổi liên tục do người khác dùng
- **Không lặp lại được** — chạy "cùng 1 test" 2 lần ra 2 kết quả khác nhau
- **Không ép được lỗi theo ý muốn** — không thể chủ động bắt "peer offline đúng lúc gửi" mà không ảnh hưởng người khác

→ **Hệ quả:** không ai build app trên Fiber hiện nay viết được test tự động (CI) cho logic xử lý thanh toán của họ.

## Giải pháp

**Fiber Test Lab** — môi trường test local dựng bằng 1 lệnh:
- Mỗi tình huống = 1 file YAML khai báo (topology + seed + expect)
- CLI đọc file → dựng N node Fiber thật + CKB devnet local → tự seed → ghi run-log
- `test-kit` cho phép viết integration test (`expectPaymentFails("insufficient_outbound")`) chạy được trong CI
- Chạy lại bao nhiêu lần cũng cho kết quả giống nhau (deterministic)

**Tại sao là "infrastructure" đúng nghĩa:** Test Lab không biết và không cần biết app đang test là gì — ví, merchant gateway, game, agent đều dùng được. Trả lời trực tiếp câu hỏi gốc của hackathon: *"Does this help future developers interact with Fiber more easily?"*

## Hackathon Scope

**IN SCOPE — v1 (must-have):**
- CLI `fiber-lab` với lệnh: `up`, `seed`, `reset`, `logs`, `list`
- Sinh docker-compose động từ scenario, cô lập theo run-id
- 3 kịch bản cốt lõi: `direct-channel`, `two-hop-route`, `insufficient-capacity`
- `test-kit` với assertion cơ bản + ít nhất 1 test mẫu chạy được
- Run-log JSON
- `docs/scenario-catalog.md` + README + video demo

**IN SCOPE — v1 (nếu kịp):**
- 2 kịch bản thêm: `expired-invoice`, `peer-offline`
- Lệnh `seed`/`logs` tách riêng hoàn chỉnh

**IN SCOPE — v2 (stretch, optional):**
- test-kit event-driven qua `subscribe_store_changes` thay vì polling
- Kịch bản multi-asset (xUDT/RUSD)
- Chạy thử FiberGate (Project 1) qua Test Lab như một bằng chứng giá trị thật

**OUT OF SCOPE (documented as future work):**
- Chạy trên testnet/mainnet thật (Test Lab chủ đích là local devnet)
- Web UI/dashboard (chủ đích CLI-first — xem system-design)
- Database server (dùng file JSON)
- Mô phỏng chính xác lỗi mạng thật (peer-offline giả bằng docker kill là best-effort)
- Routing algorithm/CCH nội bộ (không đụng tới, chỉ dùng RPC có sẵn)

## Trade-offs đã chấp nhận (phải document trong submission)

- **Devnet ≠ testnet/mainnet thật:** hành vi (block time, fee, một số giới hạn) khác — test local KHÔNG thay thế test trên testnet thật trước release.
- **peer-offline giả bằng `docker kill`:** không giống hệt lỗi mạng thật (timeout tự nhiên, mất gói dần).
- **Bảo trì theo version FNN:** FNN đổi RPC/image thì scenario phải cập nhật — pinned version để giảm rủi ro.
- **Tài nguyên máy:** nhiều node + devnet tốn RAM/CPU — giới hạn 2–3 node/kịch bản.

## Target users

- Developer build app trên Fiber muốn viết integration/CI test cho logic thanh toán
- Team (kể cả FiberGate) muốn test payment flow không phụ thuộc testnet công cộng
- Người học Fiber muốn thí nghiệm các tình huống routing/lỗi trong môi trường kiểm soát được

## Định vị (không overclaim)

Test Lab giúp *test nhanh và có kiểm soát*, KHÔNG thay thế hoàn toàn test trên testnet thật. Nói đúng: *"giúp developer viết được test tự động cho Fiber payment/routing — điều hiện chưa làm được"*, không claim *"mô phỏng chính xác 100% mạng thật"*.
