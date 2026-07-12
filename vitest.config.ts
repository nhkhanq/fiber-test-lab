import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // @ckb-ccc/* dùng import thư mục/không đuôi (dist/utils) — inline để resolver của Vite xử lý (tsx tự làm được).
    server: { deps: { inline: [/@ckb-ccc\/fiber/] } },
    // Mỗi test file dựng 1 cụm docker riêng — chạy TUẦN TỰ để không tranh tài nguyên (giữ tất định, BR-DET-001).
    fileParallelism: false,
    hookTimeout: 300_000,
  },
});
