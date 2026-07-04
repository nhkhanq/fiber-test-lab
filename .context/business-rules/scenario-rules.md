---
type: business_rules
module: scenario-execution
version: 1.0
last_updated: 2026-07-04
tags: [scenario, polling, isolation, cleanup]
---

# Business Rules — Scenario Execution

## Scenario Rules

**BR-SCN-001:** Mỗi scenario phải validate qua `zod` TRƯỚC khi chạm docker. Sai schema → exit 1, in lỗi rõ ràng field nào sai, KHÔNG dựng container nào.

**BR-SCN-002:** `channels[].from`/`to` phải nằm trong `nodes`. Vi phạm → lỗi validation.

**BR-SCN-003:** `capacity` mỗi channel phải đủ trên mức reserve tối thiểu (99 CKB/bên) trừ khi scenario CỐ TÌNH test lỗi reserve — khi đó `expect.reason` phải phản ánh điều đó.

**BR-SCN-004:** `expect.reason` chỉ hợp lệ khi `expect.status === "failed"`.

## Topology / Isolation Rules

**BR-ISO-001:** Mỗi lần `up` sinh 1 `run-id` duy nhất. Mọi tài nguyên (network, container, run-log, port map) gắn prefix theo run-id.

**BR-ISO-002:** Container/network KHÔNG bind port ra host mặc định — chỉ nghe trong network `flab_<run-id>`. Chỉ cấp port map tạm khi test-kit (ngoài docker) cần gọi RPC, và đóng khi reset.

**BR-ISO-003:** Số node tối đa mỗi scenario giới hạn 3 (tài nguyên máy). Muốn nhiều hơn phải override có chủ đích trong global config + cảnh báo.

**BR-ISO-004:** Hai run song song KHÔNG được chia sẻ network/container. Nếu phát hiện xung đột tên → sinh lại run-id, không ghi đè run cũ.

## Readiness / Polling Rules

**BR-POL-001:** Sau `docker compose up`, phải chờ mỗi node READY (poll `get_node_info` thành công) trước khi seed. Timeout mặc định `pollTimeoutMs`.

**BR-POL-002:** Sau `open_channel`, phải chờ channel đạt trạng thái READY (poll `list_channels`) trước khi coi là mở xong.

**BR-POL-003:** test-kit assertion (`expectPaymentSucceeds`...) poll theo `pollIntervalMs` đến khi đạt kết quả hoặc `pollTimeoutMs`. Hết timeout mà chưa đạt → fail test với run-log đính kèm.

**BR-POL-004:** Mọi RPC call phải được ghi vào run-log (method/params/response/error) — kể cả khi thành công — để debug lại sau reset.

## Cleanup Rules

**BR-CLN-001:** `up` lỗi giữa chừng phải tự teardown những gì đã tạo (trừ khi `--keep`), không để lại rác.

**BR-CLN-002:** `reset` phải xoá: container, network, port map, và đánh dấu run-log `status: reset` (KHÔNG xoá file run-log — giữ để tham khảo lịch sử; chỉ xoá tài nguyên docker).

**BR-CLN-003:** `keepRunOnFailure: true` (global config) → khi test fail, giữ container để debug, in hướng dẫn `fiber-lab logs`/`reset`.

## Determinism Rules

**BR-DET-001:** Cùng 1 scenario + cùng version FNN/offckb → phải cho cùng kết quả `expect`. Nếu flaky (lúc pass lúc fail) → coi là bug của Test Lab (thường do thiếu chờ READY), không phải hành vi chấp nhận được.

**BR-DET-002:** Version FNN binary + `@ckb-ccc/fiber` phải pinned. Kết quả verify chỉ được coi là đúng với version đã ghi trong `scenario-catalog.md`.
