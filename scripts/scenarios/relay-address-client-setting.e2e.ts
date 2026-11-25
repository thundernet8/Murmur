/// <reference lib="dom" />
import { expect } from "e2e";

import { APP_DIR } from "../e2e.config.ts";
import { test, WEB } from "./t3.ts";

test(
  "Relay address can be changed and reset without rebuilding the client",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("relay-settings");
    await t3.open("/settings/connections");
    const field = screen.getByRole("textbox", "Relay server address");
    await expect(field).toBeVisible();
    const readRelay = () =>
      browser.evaluate(async (root) => {
        const configPath = "/src/cloud/publicConfig.ts";
        const runtimePath = "/src/lib/runtime.ts";
        const relayPath = `/@fs${root}/packages/client-runtime/src/relay/managedRelay.ts`;
        const { resolveCloudPublicConfig } = await import(configPath);
        const { runtime } = await import(runtimePath);
        const { ManagedRelayClient } = await import(relayPath);
        const client = await runtime.runPromise(ManagedRelayClient);
        return { configured: resolveCloudPublicConfig().relayUrl, active: client.relayUrl };
      }, APP_DIR);
    const initial = await readRelay();
    await app.screenshot("relay-default");

    for (const address of [
      "http://relay.example.test",
      "https://user:pass@relay.example.test",
      "https://relay.example.test/path",
      "https://relay.example.test?token=example",
      "https://relay.example.test#fragment",
    ]) {
      await field.fill(address);
      await screen.getByRole("button", "Save and reload").tap();
      await expect(screen.getByRole("alert")).toHaveText(
        "Enter an HTTPS address without credentials, a path, query parameters, or a fragment.",
      );
      expect(await readRelay()).toEqual(initial);
    }
    await app.screenshot("relay-invalid");

    await field.fill("https://RELAY.example.test:443/");
    await screen.getByRole("button", "Save and reload").tap();
    await expect(field).toHaveValue("https://relay.example.test");
    expect(await readRelay()).toEqual({
      configured: "https://relay.example.test",
      active: "https://relay.example.test",
    });
    await app.screenshot("relay-saved");

    // 再次进入页面，验证设置保存在当前客户端，而非仅保留在表单中。
    await t3.open("/settings/connections");
    await expect(field).toHaveValue("https://relay.example.test");
    await screen.getByRole("button", "Use default and reload").tap();
    await expect(field).toHaveValue("");
    expect(await readRelay()).toEqual(initial);
    await app.screenshot("relay-reset");
  },
);
