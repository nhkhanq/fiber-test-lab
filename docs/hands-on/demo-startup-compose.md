# fiber-demo-startup — đọc & document compose (E1-2)

> Nền hạ tầng Test Lab fork từ đây. Verify thật trên máy 2026-07-05, stack chạy OK.
> Repo: github.com/HappySonnyDev/fiber-demo-startup @ branch `demo-0.8` (commit `e512aec`).
> Clone tại: `~/fiber-playground/fiber-demo-startup` (ngoài repo Test Lab — chỉ để học tay E0).

## Services (7)

| Service | Vai trò | Port host | Port nội bộ | IP tĩnh |
|---|---|---|---|---|
| ckb | CKB dev chain + miner + contracts pre-deployed | 8114 | 8114 | (mặc định) |
| transfer | Cấp tiền 1 lần rồi Exited(0): 1 tỷ CKB + 1 tỷ sUDT / node | — | — | (mặc định) |
| fiber-bootnode | Bootstrap gossip; node khác discover qua nó | 10000, 8230→8228 | 10000, 8228 | 172.30.0.10 |
| fiber-node1 | Node FNN (=alice) | 10001, 8231→8228 | 10000, 8228 | 172.30.0.11 |
| fiber-node2 | Node FNN (=bob) | 10002, 8232→8228 | 10000, 8228 | 172.30.0.12 |
| fiber-node3 | Node FNN (=charlie) | 10003, 8233→8228 | 10000, 8228 | 172.30.0.13 |
| fiber-web | Panel monitor cũ (không quan trọng) | 3000 | 3000 | (mặc định) |

## Network

- Tên: `fiber_net` → compose prefix thành `fiber-demo-startup_fiber_net`. Driver bridge.
- Subnet gốc `172.21.0.0/16`. **ĐÃ SỬA trên máy này → `172.30.0.0/16`** (IP node 172.30.0.10-13)
  vì `172.21.0.0/16` bị `server_default` (project khác) chiếm → lỗi "Pool overlaps".
- Máy này đang dùng: 172.17–172.23. Dải trống đã chọn: 172.30.

## Thứ tự khởi động (depends_on + healthcheck)

1. `ckb` (healthcheck curl :8114) →
2. `transfer` (chờ ckb healthy, cấp tiền rồi thoát) + `fiber-bootnode` (chờ ckb healthy) →
3. `fiber-node1/2/3` (chờ ckb + bootnode healthy) →
4. `fiber-web`
- Healthcheck node fiber: curl cổng nội bộ 41716.

## Fund flow

- sUDT pre-mint trong genesis, thuộc 1 source account.
- `transfer` chuyển CKB + sUDT từ source account → từng node → mỗi node đủ tiền mở channel + test.

## State / cleanup

- State mỗi node bind-mount ở `fiber/nodes/<node>/store` (ra host).
- Reset demo-startup thủ công: `docker compose down` + `rm -rf fiber/nodes/*/store`.

## Đối chiếu invariant Test Lab — cái PHẢI parametrize (E1-3 / E3-3 / E4-3)

| demo-startup hardcode | Test Lab phải làm | Ticket |
|---|---|---|
| network tên cứng + subnet cứng | `flab_<run-id>`, subnet do Docker cấp | E1-3/E3-3 |
| IP tĩnh 172.x.0.10-13 | bỏ, để Docker tự cấp | E1-3 |
| bind port host cứng 8114/10000-10003 | KHÔNG bind mặc định; port tạm khi test-kit cần | E1-3, §9 |
| tên container cố định | prefix run-id | E1-3 |
| state ở fiber/nodes/*/store | reset sạch qua `fiber-lab reset` | E4-3 |

**Bài học sống:** lỗi "Pool overlaps" lúc `up` chính là hệ quả của hardcode subnet —
đúng vấn đề mà run-id isolation của Test Lab sinh ra để giải.
