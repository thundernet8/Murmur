import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["integration/relayEncryption.e2e.ts"],
    testTimeout: 120_000,
    reporters: ["default", "json"],
    outputFile: "/tmp/murmur-relay-e2ee/e2e-results.json",
  },
});
