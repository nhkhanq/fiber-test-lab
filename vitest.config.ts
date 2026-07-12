import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: { deps: { inline: [/@ckb-ccc\/fiber/] } },
    fileParallelism: false,
    hookTimeout: 300_000,
  },
});
