import { defineConfig } from "vite-plus";

// 启动前将 NODE_EXTRA_CA_CERTS 指向 src/peer/fixtures/localhost-cert.pem，信任本机 TLS fixture。
export default defineConfig({
  test: {
    include: ["integration/claudeHttpProxy.e2e.ts"],
    reporters: ["default", "json"],
    outputFile: "../../.murmur/claude-http-proxy/http-e2e.json",
  },
});
