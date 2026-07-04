---
type: index
version: 1.0
last_updated: 2026-07-04
---

# Fiber Test Lab — Context Index

Đây là Single Source of Truth cho toàn bộ project. Claude Code nên đọc file này trước tiên.

## Dự án là gì?

**Fiber Test Lab** là một môi trường test **hoàn toàn local** cho Fiber Network (CKB blockchain), dựng bằng 1 lệnh, cho phép developer tái tạo **lặp lại được** và **kiểm soát được** các tình huống thanh toán / routing thường gặp (kênh trực tiếp, route multi-hop, thiếu capacity, invoice hết hạn, peer offline) — kèm CLI để dựng/seed/reset từng kịch bản, và một thư viện assertion (`test-kit`) để viết integration test tự động.

Developer build app trên Fiber (ví, merchant gateway, game, agent...) hiện **không thể viết test tự động** cho logic thanh toán của họ, vì cách duy nhất để chạm vào các tình huống lỗi payment-channel là tạo chúng thật trên testnet công cộng — chậm, chia sẻ, không lặp lại được, không ép được lỗi theo ý muốn. Fiber Test Lab giải quyết đúng vấn đề đó.

> **Lưu ý naming & định vị:** đây KHÔNG phải là một Fiber node mới, KHÔNG phải wallet, KHÔNG phải app end-user. Đây là **developer tooling / local testing environment** — khớp trực tiếp ví dụ *"Local testing environments, developer CLIs, and test suites for common Fiber payment and routing scenarios"* trong **Category 2** của hackathon.

Dự án được xây cho **Gone in 60ms: Fiber Network Infrastructure Hackathon** (1–15 July 2026), category: **Node, Routing, Cross-Chain, and Diagnostics Infrastructure**.


## Cây context

| File | Nội dung |
|------|----------|
| `business-context/project-vision.md` | Vision, vấn đề, scope, out-of-scope, trade-offs |
| `architecture/system-design.md` | **Kiến trúc chi tiết** — tech stack, topology, data flow, run-id isolation, cấu trúc repo, config 2 tầng. Đọc kỹ nhất. |
| `data-dictionary/scenario-schema.md` | Schema file kịch bản YAML + schema JSON run-log (thay cho database-schema) |
| `api/cli-spec.md` | Đặc tả CLI đầy đủ (lệnh, tham số, output, exit code) — thay cho REST API |
| `business-rules/scenario-rules.md` | Luật chạy kịch bản, polling, isolation, cleanup |
| `glossary/fiber-terms.md` | Thuật ngữ Fiber + Test Lab |
| `user-stories/developer-flows.md` | User stories từ góc nhìn developer dùng Test Lab |
| `processes/decisions-log.md` | Quyết định kiến trúc/nghiệp vụ đã được human chốt |
| `processes/definition-of-done.md` | DoD + checklist tự verify cuối mỗi session |

## Repo layout

```
fiber-test-lab/
├── topology/          — docker-compose + scenario YAML files
├── cli/               — fiber-lab CLI (commander)
├── test-kit/          — assertion helpers cho Vitest
├── lib/               — fiber RPC client wrapper, docker orchestration, run-log
├── fiber-lab.config.ts — global config (tầng 2 settings)
└── docs/              — scenario-catalog.md, README
```

## Quy ước code

- TypeScript strict mode toàn bộ
- Tên hàm: camelCase. Tên type/interface: PascalCase
- CLI command handler tách khỏi business logic (handler mỏng, logic trong `lib/`)
- Mọi input từ file YAML phải validate qua `zod` TRƯỚC khi dùng — fail fast với message rõ ràng
- Không hardcode port/tên container — sinh từ run-id (xem system-design)
- Mọi thao tác docker phải cleanup được qua `fiber-lab reset` — không để lại rác
