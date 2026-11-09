# Phát hành package

`fiber-test-lab` đánh số semver riêng, tiếp nối từ `1.1.0`. Mỗi bản pin đúng một bản FNN, và dist-tag dùng giống `@nervosnetwork/fiber-js` của team Fiber.

| Bản FNN | Version package | Dist-tag | Dự án cài bằng |
|---|---|---|---|
| Stable `0.9.1` | `1.2.0` | `latest` | `npm i -D fiber-test-lab` |
| Release candidate `0.10.0-rc2` | `1.3.0-rc.2` | `next` | `npm i -D fiber-test-lab@next` |

## Quy tắc

- Bản stable của package pin bản stable của FNN và lên `latest`.
- Release candidate của package có dạng `x.y.z-rc.N`, pin bản `-rcN` cùng số của FNN và lên `next`. Bản sửa riêng cho nó thêm một số, ví dụ `1.3.0-rc.2.1`.
- Tăng số theo semver: sửa lỗi tăng patch, thêm tính năng hoặc chuyển sang dòng FNN mới tăng minor, thay đổi phá vỡ API tăng major.

Quy tắc nằm ở `lib/release.ts`. `test/unit/release.test.ts` kiểm tra version và pin trong repo, còn `scripts/release-check.ts` chạy trước mọi lần `npm publish`.

`fiber-lab doctor` luôn in bản FNN sẽ chạy. Dự án vẫn có thể chạy bản FNN khác bằng `fnnVersion` trong `fiber-lab.config.json`.

## Đổi version

Một lệnh đổi cả version package lẫn bản FNN được pin:

```bash
npm run release:set -- 1.3.0-rc.2 0.10.0-rc2
```

## Publish từ máy

Sau khi `npm login`:

```bash
npm publish --dry-run --tag latest    # xem trước, chưa upload
npm publish --tag latest              # bản stable
npm publish --tag next                # bản release candidate
```

`prepublishOnly` sẽ từ chối nếu version, bản FNN hoặc dist-tag không khớp nhau.

Bản release candidate không commit vào `canary`, vì `canary` pin bản stable. Publish xong thì trả lại:

```bash
git restore package.json package-lock.json fiber-lab.config.ts
```

## Publish qua GitHub Actions

Workflow `Release` chạy khi có tag `v*`. Nó kiểm tra tag khớp version và version khớp FNN đã pin, chạy typecheck, unit test, consumer test, mọi scenario và test-kit trên bản FNN đó, rồi mới publish. Version đã có trên npm thì bỏ qua.

Cấu hình một lần, chỉ làm khi đã sẵn sàng đẩy tag: cấu hình mới phải có một lần publish thành công trong 2 ngày, nếu không sẽ hết hạn và phải xóa đi tạo lại.

Trên npmjs.com, vào Packages, chọn `fiber-test-lab`, Settings, Trusted publishing, chọn GitHub Actions và điền đúng chữ hoa chữ thường:

- Organization or user: `nhkhanq`
- Repository: `fiber-test-lab`
- Workflow filename: `release.yml`
- Allowed actions: phải có `npm publish`

npm không kiểm tra các trường này lúc lưu, nên điền sai chỉ lộ ra khi workflow publish. Từ đó workflow publish bằng OIDC, không cần lưu token, và npm tự kèm provenance.

Bản stable, khi `canary` đã có đúng version và pin:

```bash
git tag v1.2.0 origin/canary
git push origin v1.2.0
```

Bản release candidate: commit đổi version chỉ nằm dưới tag:

```bash
git switch --detach origin/canary
npm run release:set -- 1.3.0-rc.2 0.10.0-rc2
git commit -am "release: 1.3.0-rc.2"
git tag v1.3.0-rc.2
git push origin v1.3.0-rc.2
git switch -
```
