# E3-3 — Nghiên cứu nguồn hạ tầng (báo cáo, chờ review)

> Bối cảnh: quyết định 2026-07-05 là **tự viết compose/Dockerfile, KHÔNG fork demo-startup**.
> E3-3 cần nguồn image FNN + CKB devnet uy tín. Đây là báo cáo để quyết hướng trước khi code.

## 1. Nguồn uy tín đã verify (2026-07-05)

| Thành phần | Nguồn chính thức | Có bản pin 0.8.0? |
|---|---|---|
| CKB devnet | Docker Hub `nervos/ckb` (official, nhiều bản: v0.207.0…) | ✅ image ổn định |
| FNN container image | `nervos/fiber` + `ghcr.io/nervosnetwork/fiber` | ❌ CHỈ có từ `0.9.0-rc4` trở đi (toàn RC, chưa stable) |
| FNN 0.8.0 binary | GitHub release official: `fnn_v0.8.0-x86_64-linux.tar.gz` (+ portable/aarch64/darwin) | ✅ có |
| FNN Dockerfile mẫu | `nervosnetwork/fiber/docker/Dockerfile` + entrypoint (official, develop) | tham khảo được |
| Fiber on-chain scripts | repo `nervosnetwork/fiber-scripts` | có |

**Điểm mấu chốt:** image FNN official **chỉ mới publish từ 0.9.0-rc** (release candidate, chưa stable). Bản ta đã verify tay toàn bộ ở E0 là **0.8.0 (stable)** — không có image official, nhưng **có binary official**.

## 2. Khuyến nghị stack (giữ pin 0.8.0)

Giữ FNN 0.8.0 (đã verify E0 → determinism). Không nhảy lên 0.9.0-rc (đổi version = phải re-verify toàn bộ E0, mà lại là RC không ổn định).

- **CKB:** dùng image official `nervos/ckb` chạy dev mode.
- **FNN:** Dockerfile mỏng (`debian:bookworm-slim`) → tải binary official `fnn_v0.8.0-x86_64-linux.tar.gz` → chạy `fnn`. Tự viết entrypoint (tham khảo cách official làm, không copy).

Cả hai đều nguồn official, tự viết compose/Dockerfile → sạch pháp lý, nhanh (không compile Rust như demo-startup).

## 3. Rủi ro then chốt (phần khó THẬT của reimplement)

FNN không chạy được trên một CKB devnet trống. Nó cần:
1. **Fiber scripts deploy sẵn trên devnet** (FundingLock, CommitmentLock, simple_udt) tại out-point đã biết — FNN config trỏ tới các cell_dep này (thấy trong `node_info.default_funding_lock_script` + `udt_cfg_infos` ở E0).
2. **Node có tiền CKB** để mở channel (demo-startup dùng `transfer` container cấp 1 tỷ CKB/node).
3. **Devnet config** (`config.yml`/`dev.toml`) — official repo chỉ có mainnet/testnet, KHÔNG có devnet sẵn. demo-startup tự ráp.

→ Đây là phần tốn công nhất. demo-startup giải bằng cách **nhúng contracts vào genesis + transfer container**. Ta phải tái tạo sạch, ví dụ:
- **Cách A:** genesis CKB custom nhúng sẵn fiber-scripts (giống demo-startup, tự viết) + bước faucet cấp tiền.
- **Cách B:** CKB devnet trống → bước bootstrap deploy fiber-scripts (từ `nervosnetwork/fiber-scripts`) + faucet, chạy 1 lần khi `up`.
- **Cách C:** thử `offckb` (v0.4.8) — cần verify nó có deploy sẵn fiber-scripts không (chưa chắc; offckb thiên về script chuẩn CKB, không chắc có FundingLock/CommitmentLock).

## 4. Đề xuất chia nhỏ E3-3

1. Viết Dockerfile FNN 0.8.0 (binary official) + xác nhận `fnn` chạy trong container.
2. compose tối thiểu: CKB (`nervos/ckb` dev) + 1 FNN, network `flab_<run-id>`, KHÔNG bind host mặc định.
3. Bootstrap: deploy fiber-scripts + faucet (phần khó — chọn cách A/B/C ở mục 3).
4. compose.template.ts sinh động N node theo scenario + run-id.

## 5. Cần cập nhật context

- system-design §2b ("build ON TOP of demo-startup") đã bị override bởi quyết định reimplement (2026-07-05, decisions-log). Nên thêm ghi chú trỏ tới quyết định đó ở §2b.
- Nếu chốt cách bootstrap scripts → ghi vào decisions-log (sau khi human confirm).

## Đã quyết (2026-07-05)
- **FNN 0.8.0** (binary official + Dockerfile tự viết). ✅ `topology/docker/fnn.Dockerfile` build OK, `fnn --version` = `Fiber v0.8.0 (335a74a)` trong container.
- **CKB genesis custom** nhúng sẵn fiber-scripts.

## Sub-decision còn mở: nguồn fiber-scripts binaries cho genesis
`nervosnetwork/fiber-scripts` **KHÔNG có release asset compiled** — chỉ source + `deployment/` + `checksums.txt`. Lấy binary compiled bằng cách nào:
- **B1:** build fiber-scripts từ source (cần ckb-script/capsule toolchain — nặng, chậm).
- **B2:** dùng binary official đã compile lấy từ nguồn tin cậy khác (vd artifact CI của fiber-scripts, hoặc script system của offckb) — cần verify checksum khớp `checksums.txt`.
- **B3:** offckb v0.4.8 — verify xem có bundle sẵn fiber-scripts (FundingLock/CommitmentLock) không.
→ Cần quyết trước khi làm genesis. FNN binary đã lo xong; đây là mắt xích còn lại của CKB devnet.
