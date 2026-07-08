import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // @ckb-ccc/* dùng import thư mục/không đuôi (dist/utils) — inline để resolver của Vite xử lý (tsx tự làm được).
    server: { deps: { inline: [/@ckb-ccc\/fiber/] } },
  },
});
