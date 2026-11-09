# Phát hành package

`fiber-test-lab` đánh số theo bản FNN mà nó pin, giống `@nervosnetwork/fiber-js` của team Fiber.

| Bản FNN | Version package | Dist-tag | Dự án cài bằng |
|---|---|---|---|
| Stable `0.9.1` | `0.9.1` | `latest` | `npm i -D fiber-test-lab` |
| Release candidate `0.10.0-rc2` | `0.10.0-rc2` | `next` | `npm i -D fiber-test-lab@next` |

`1.0.0` và `1.1.0` là hai bản cũ, phát hành trước khi có quy tắc này.

## Bản sửa chỉ thuộc về lab

npm không cho dùng lại một số version, nên bản sửa của riêng lab cần số mới:

- Dòng stable: tăng patch. FNN `0.9.1` thì bản sửa là `0.9.2`. Khoảng `^0.9.1` nhận được bản sửa mà không nhảy sang FNN 0.10.
- Release candidate: thêm `.N`, ví dụ `0.10.0-rc2.1`.

Vì vậy số patch của package có thể vượt số patch của FNN. `fiber-lab doctor` luôn in bản FNN sẽ chạy.

Quy tắc nằm ở `lib/release.ts`. `test/unit/release.test.ts` kiểm tra version và pin trong repo, còn `scripts/release-check.ts` chạy trước mọi lần `npm publish`.

## Cấu hình một lần

Trên npmjs.com, vào package `fiber-test-lab`, mục Settings, phần Trusted Publisher, chọn GitHub Actions và điền:

- Organization or user: `nhkhanq`
- Repository: `fiber-test-lab`
- Workflow filename: `release.yml`

Từ đó workflow publish bằng OIDC, không cần lưu token.

Hai bản 1.x nên được đánh dấu lỗi thời một lần, sau khi đã `npm login`:

```bash
npm deprecate "fiber-test-lab@1.x" "Version numbers now follow Fiber releases. Install fiber-test-lab@latest."
```

## Phát hành một bản

Workflow `Release` chạy khi có tag `v*`. Nó kiểm tra tag khớp version và version khớp FNN đã pin, chạy typecheck, unit test, consumer test, mọi scenario và test-kit trên bản FNN đó, rồi mới publish. Version đã có trên npm thì bỏ qua.

Bản stable, khi `canary` đã có đúng version và pin:

```bash
git tag v0.9.1 origin/canary
git push origin v0.9.1
```

Bản release candidate: `canary` vẫn pin bản stable, nên commit đổi version chỉ nằm dưới tag:

```bash
git switch --detach origin/canary
npm version 0.10.0-rc2 --no-git-tag-version
# Sửa fnnVersion trong fiber-lab.config.ts thành 0.10.0-rc2
git commit -am "release: 0.10.0-rc2"
git tag v0.10.0-rc2
git push origin v0.10.0-rc2
git switch -
```

Khi FNN có bản stable mới, đổi `version` và `fnnVersion` qua PR vào `canary` như mọi thay đổi khác, rồi gắn tag.

Nếu chưa bật Trusted Publisher, có thể publish từ máy sau khi `npm login`, bằng `npm publish --tag latest` hoặc `npm publish --tag next`. `prepublishOnly` sẽ từ chối nếu version hoặc dist-tag sai.
