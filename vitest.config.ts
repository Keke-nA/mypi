import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["package/**/*.test.ts"],
    exclude: ["package/pi-tui/test/**/*.test.ts"],
  },
});
