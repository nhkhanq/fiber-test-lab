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
| **E3-1** zod schema scenario | 🟡 đang làm | Channel/SeedStep/Expectation. |
| E3-2 → E8 | ⬜ chưa | |

## Mốc dữ liệu đã chốt (thật, không đoán)

- FNN pin: **0.8.0**, commit `335a74a 2026-04-03`.
- RPC method `node_info` (không phải `get_node_info`); số trả về là **hex string**; `result:null` = OK.
- Ports host: bootnode 10000, node1/alice 10001, node2/bob 10002, node3/charlie 10003.
- Min channel funding = 100 CKB (`0x2540be400`).
- Chữ ký RPC chuẩn cho 0.8: xem `rpc-notebook.md` (trích từ code thật demo-startup).

## Sửa môi trường đã áp dụng

- docker-compose.yml của demo-startup: subnet `172.21.0.0/16` → `172.30.0.0/16`
  (+ IP node 172.30.0.10-13) vì đụng `server_default`.

## Việc tiếp theo

1. Xong E0-3: poll list_channels → CHANNEL_READY → new_invoice(bob) → send_payment(alice) → shutdown_channel.
2. E0-5: ép over-capacity, thu raw error.
3. E1-1: kiểm tra license.
4. Bắt đầu E2 (skeleton project: package.json, tsconfig, tsx, folders).
