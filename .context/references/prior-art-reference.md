---
type: reference
version: 1.0
last_updated: 2026-07-04
tags: [prior-art, reference, compliance, reuse]
---

# Prior-Art & Reference — Fiber Test Lab

> File tham khảo độc lập. KHÔNG thay đổi các quyết định trong context chính (system-design, decisions-log...).
> Mục đích: ghi lại các repo được phép ĐỌC làm tham khảo, ranh giới pháp lý, và bản đồ "đọc file nào để biết cái gì".

---

## 1. Các repo dùng làm tham khảo (reference oracle)

Đây là code THẬT đang chạy — đọc để hiểu cách gọi RPC đúng, params, và lỗi thật, thay vì đoán.

| Repo | Là gì | Dùng để tham khảo điều gì |
|---|---|---|
| `cryptape/ckb-py-integration-test` (branch `fiber`) | QA suite Python của team, test chính node FNN | Cách gọi RPC + params + lỗi thật + flow mở channel/multi-hop |
| `HappySonnyDev/fiber-demo-startup` (branch `demo-0.8`) | Local env: docker-compose CKB dev chain + nhiều FNN node | Cách cấu hình FNN + CKB devnet trong docker |
| `nervosnetwork/fiber` | Source FNN chính thức | RPC reference gốc, hành vi node |
| fiber.world/docs/api-reference | RPC docs chính thức | Đối chiếu tên method/params |

---

## 2. Ranh giới pháp lý (QUAN TRỌNG — đọc trước khi dùng)

**Cả 3 repo trên KHÔNG có file LICENSE** (đã kiểm tra 2026-07-04). Mặc định luật bản quyền = "all rights reserved". Do đó:

| Hành vi | Được phép? | Ghi chú |
|---|---|---|
| ĐỌC code để hiểu cách làm | ✅ | Bản quyền không bảo vệ ý tưởng/API/hành vi |
| Học tên RPC + params + thứ tự gọi rồi **tự viết lại bằng TypeScript** | ✅ | Tên RPC/params là "sự thật kỹ thuật" để tương tác, không phải sáng tạo được bảo hộ |
| Copy nguyên `docker-compose.yml`, `Dockerfile`, hay code Python vào repo mình | ❌ | Sao chép "expression" — không license = không có phép. **TỰ VIẾT compose/config của mình.** |
| Chạy FNN binary / docker image chính thức | ✅ | Được publish để dùng |

**Nguyên tắc vàng:** *Đọc để học → tự viết lại bằng lời/code của mình.* Không paste nguyên văn.

**3 việc nên làm để chắc chắn:**
1. Ghi credit trong README (xem mục 5).
2. Cân nhắc mở issue xin repo chủ thêm license.
3. Đọc luật hackathon chính thức về "building on existing repos" + xác nhận với ban tổ chức nếu chưa rõ.

**Lợi ích phụ:** tự viết code = tăng điểm "original work" của hackathon, và vẫn giữ được lợi ích "không sợ làm sai" vì có bản chạy thật để đối chiếu.

---

## 3. Bản đồ "đọc file nào để biết cái gì" (reference oracle map)

| Cần biết | Đọc file (trong cryptape/ckb-py-integration-test) |
|---|---|
| Tên + params RPC chính xác | `framework/fiber_rpc.py` |
| Cách khởi động node + connect peer | `framework/basic_fiber.py` → `Fiber.init_by_port()`, `start_new_fiber()` |
| Mở channel + chờ READY | `basic_fiber.py` → `open_channel()`, `wait_for_channel_state(..., "CHANNEL_READY")` |
| Gửi payment + chờ trạng thái | `basic_fiber.py` → `send_payment()`, `wait_payment_state()` |
| Multi-hop router | `test_cases/fiber/devnet/send_payment_with_router/test_send_payment_with_router.py` → `build_router`, `send_payment_with_router` |
| Lỗi thật khi payment fail (chuỗi lỗi gì) | các block `try/except` trong test — VD `"Failed to send onion packet"`. Dùng để chốt `ErrorCategory`. |
| Cấu hình FNN + CKB devnet trong docker | `fiber-demo-startup`: `docker-compose.yml`, `fiber/Dockerfile`, `ckb/Dockerfile`, `fiber/transfer/` |

---

## 4. Primitive nên PORT (tối thiểu) vs BỎ

Chỉ port đúng phần lõi đủ chạy scenario must-have. KHÔNG port hết suite (sẽ phình, không kịp 11 ngày).

**PORT (tối thiểu):**
- start node · connect peer
- `open_channel` + wait `CHANNEL_READY`
- `new_invoice`
- `send_payment`
- `send_payment_with_router` (multi-hop, cho `two-hop-route`)
- `wait_payment_state`
- bắt lỗi payment (map sang `ErrorCategory`)

**BỎ (không liên quan scenario must-have):**
- watchtower, abandon/update channel, compatibility, graph_*, password, remove_tlc...

**Cái MỚI đặt lên trên (đây là giá trị khác biệt của Test Lab — không có trong Python suite):**
- Lớp khai báo scenario **YAML** (thay 20–40 dòng Python imperative)
- Assertion **TS-native** (`expectPaymentFails("insufficient_outbound")`) với error chuẩn hoá
- CLI `fiber-lab` + run-id isolation + run-log JSON

---

## 5. Attribution mẫu (dán vào README khi nộp)

```
## Prior art & credits
Fiber Test Lab được xây dựng như một test harness TS-native, declarative, app-facing.
Nó tham khảo (không sao chép) các dự án mã nguồn mở sau để đảm bảo tính chính xác:
- cryptape/ckb-py-integration-test — Python integration suite cho FNN (tham khảo RPC flow & error).
- HappySonnyDev/fiber-demo-startup — local docker env (tham khảo cách cấu hình FNN + CKB devnet).
- nervosnetwork/fiber — FNN reference implementation.
Toàn bộ code trong repo này được viết mới bằng TypeScript trong thời gian hackathon.
```

---

## 6. Đo mức khác biệt (để trung thực trong submission)

- ~60% năng lực (dựng node, gửi payment, coverage scenario) đã tồn tại bằng Python trong cryptape suite.
- ~40% mới của Test Lab nằm ở: **declarative YAML + TS-native assertion + app-facing packaging** (kiểu "Polar cho Fiber").
- Định vị đúng: *"mang pattern local-test app-facing, declarative, TS-native đến Fiber"* — KHÔNG claim "chưa ai từng test Fiber".
