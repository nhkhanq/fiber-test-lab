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

## Sub-decision ĐÃ GIẢI (2026-07-06) — nguồn fiber-scripts binaries cho genesis
`nervosnetwork/fiber-scripts` KHÔNG có release asset compiled. Đã điều tra 3 hướng:
- **B1** (build từ source): loại — nặng/chậm (cần capsule toolchain).
- **B3** (offckb bundle): **loại** — verify tay `@offckb/cli 0.4.7`: genesis dev.toml của nó
  (`ckb/devnet/specs/dev.toml`) chỉ nhúng secp256k1/dao/sudt/xudt/omnilock/spore/... —
  **KHÔNG có FundingLock/CommitmentLock**. offckb thiên về script chuẩn CKB, không có fiber scripts.
- **B2 (CHỌN):** lấy binary compiled từ **chính repo FNN tag `v0.8.0`**: `tests/deploy/contracts/`
  chứa blob compiled thật — `funding-lock` (74.8KB), `commitment-lock` (111.9KB), `auth` (150.9KB),
  `simple_udt`, `xudt_rce`, `always_success`. **Cùng version FNN đã pin → deterministic tuyệt đối**,
  không cần verify checksum chéo (cùng nguồn cùng tag). Tải trong `ckb.Dockerfile` lúc build.

### Mô hình genesis-custom (đã impl E3-3, PENDING live-boot ở E3-4)
- CKB image: `nervos/ckb:v0.207.0` (bản offckb 0.4.7 pair — genesis dev.toml khớp).
- `topology/docker/ckb.Dockerfile`: FROM nervos/ckb → tải 6 fiber-scripts từ FNN v0.8.0 → `/fiber-scripts/`.
- `topology/docker/ckb/entrypoint.sh`: `ckb init -c dev` (sinh genesis chuẩn) → **append** `[[genesis.system_cells]]`
  trỏ `/fiber-scripts/*` (mô hình hoá theo fiber `tests/deploy/init-dev-chain.sh`, tự viết) → `ckb run` + dummy miner.
  Miner mint về key faucet (offckb ckb-miner key), cellbase_maturity=0 → orchestrator faucet phân phối (E3-4).
- ✅ **LIVE-BOOT OK (2026-07-06):** build + `ckb run` chạy, RPC trả tip, miner tiến block,
  genesis nhúng 5 fiber cell thành công (14 output system-cell ở genesis tx).

## Live-boot validation (2026-07-06) — ĐÃ KIỂM CHỨNG

CKB genesis-custom **boot OK**, 5 cell fiber nhúng đúng genesis (cellbase tx[0]), miner đào block.

**Bug determinism đã tìm+fix:** `ckb init` đặt `[genesis.genesis_cell] message = "<timestamp ms>"` → genesis hash
+ cellbase tx hash (out-point) đổi mỗi boot. Fix: entrypoint `sed` ghim `message = "flab-devnet"`.
→ 2 boot mới toanh giờ ra genesis + cellbase **giống hệt** (verified).

**Toạ độ genesis deterministic (dùng cho FNN devnet config):**
- genesis hash = `0x4a7748e5e80e2857dfd672aba868eb2e49e3bb1bd3e8fd29e253c8273fbee4b1`
- cellbase tx (out-point cho mọi cell dưới) = `0x7dcd6cec1dfc252ed7d2a96abc44f4cc549d9dd576db0763115f1c844a17c886`
- code_hash = hash type-id script (hash_type: "type"):

| Cell | out_point index | code_hash (type) |
|---|---|---|
| auth | 5 | `0x6283a479a3cf5d4276cd93594de9f1827ab9b55c7b05b3d28e4c2e0a696cfefd` |
| funding-lock | 6 | `0x1a1e4fef34f5982906f745b048fe7b1089647e82346074e0f32c2ece26cf6b1e` |
| commitment-lock | 7 | `0x9c6933d977360f115a3e9cd5a2e0e475853681b80d775d93ad0f8969da343e56` |
| simple_udt | 8 | `0xe09352af0066f3162287763ce4ddba9af6bfaeab198dc7ab37f8c71c9e68bb5b` |
| xudt_rce | 9 | `0xbb4469004225b39e983929db71fe2253cba1d49a76223e9e1d212cdca1f79f28` |

## E3-5 correction (2026-07-06) — ALIGN genesis theo fiber devnet chuẩn

Đọc `nervosnetwork/fiber` v0.8.0 `tests/nodes/deployer/{dev.toml,config.yml}` + `tests/deploy/init-dev-chain.sh`:
- **Config FNN devnet KHÔNG có `scripts:` section** — chỉ `fiber.chain: dev.toml`. FNN **đọc fiber scripts trực
  tiếp từ chain spec (dev.toml) theo convention thứ tự cell genesis**. ⇒ genesis phải khớp cấu trúc fiber devnet.
- Fiber dùng `create_type_id = false` (data-hash), `message = "ckb_dev"`, account faucet nạp sẵn trong genesis.

→ **Rewrite `entrypoint.sh`**: sinh dev.toml khớp fiber devnet (thay bản ad-hoc create_type_id=true trước đó):
  4 system cell chuẩn + 5 fiber cell (`create_type_id=false`, order auth/funding-lock/commitment-lock/simple_udt/xudt_rce)
  + issued_cell faucet **20 tỷ CKB** tới `0xc8328aab…` (secp256k1 sighash `0x9bd7e06f…`, privkey
  `d00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc`), `cellbase_maturity=0`, dummy pow.

**Verified live (2026-07-06):** genesis boot OK, miner chạy; fiber cells ở genesis cellbase index
**auth=5, funding-lock=6, commitment-lock=7, simple_udt=8, xudt_rce=9** (index 0 = genesis message cell);
faucet account có `0x1bc16d674ec80000` = **20 tỷ CKB**. dev.toml tĩnh hoàn toàn ⇒ deterministic.
data-hash funding/commitment-lock: verify qua `node_info.default_funding_lock_script` khi FNN boot.

⚠️ Bảng type-id code_hash ở section trên (create_type_id=true) **ĐÃ BỎ** — cells giờ data-hash based.

**Còn lại (E3-5):** share dev.toml + /fiber-scripts sang FNN container → FNN config.yml (`fiber.chain: dev.toml`,
`ckb.rpc_url: http://ckb:8114`, rpc `0.0.0.0:8227`) + secret key → boot FNN → poll node_info READY + faucet.
