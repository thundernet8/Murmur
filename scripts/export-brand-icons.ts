#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import sharp from "sharp";

import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

class BrandAssetError extends Schema.TaggedError<BrandAssetError>()("BrandAssetError", {
  cause: Schema.Defect(),
}) {}

const render = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => new BrandAssetError({ cause }) });

const variants = [
  { name: "dev", background: "#e7f4f2" },
  { name: "nightly", background: "#192d39" },
  { name: "prod", background: "#0c2024" },
] as const;

export const exportBrandIcons = Effect.fn("exportBrandIcons")(function* (checkOnly: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "..");
  const source = yield* fs.readFile(path.join(root, "assets/murmur/mark.png"));
  const outputs = new Map<string, Uint8Array>();
  const mark = yield* render(() =>
    sharp(source)
      .trim()
      .resize(1024, 1024, { fit: "contain", background: "#00000000" })
      .png()
      .toBuffer(),
  );
  outputs.set("apps/web/public/murmur-mark.png", mark);
  outputs.set("apps/mobile/assets/murmur-mark.png", mark);

  for (const variant of variants) {
    const directory = `assets/murmur/${variant.name}`;
    const foreground = yield* render(() => sharp(mark).resize(740, 740).png().toBuffer());
    const fullBleedIcon = yield* render(() =>
      sharp({ create: { width: 1024, height: 1024, channels: 4, background: variant.background } })
        .composite([{ input: foreground, gravity: "centre" }])
        .png()
        .toBuffer(),
    );
    const icon = yield* render(() =>
      sharp(fullBleedIcon)
        .composite([
          {
            input: Buffer.from(
              '<svg width="1024" height="1024"><rect width="1024" height="1024" rx="256" fill="white"/></svg>',
            ),
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer(),
    );
    outputs.set(`${directory}/icon.png`, icon);
    outputs.set(`${directory}/icon-ios.png`, fullBleedIcon);
    const macBody = yield* render(() =>
      sharp(fullBleedIcon)
        .resize(824, 824)
        .composite([
          {
            input: Buffer.from(
              '<svg width="824" height="824"><rect width="824" height="824" rx="224" fill="white"/></svg>',
            ),
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer(),
    );
    outputs.set(
      `${directory}/icon-macos.png`,
      yield* render(() =>
        sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#00000000" } })
          .composite([{ input: macBody, left: 100, top: 100 }])
          .png()
          .toBuffer(),
      ),
    );
    for (const size of [16, 32, 180, 192, 512]) {
      const filename =
        size === 180
          ? "apple-touch-180.png"
          : size <= 32
            ? `favicon-${size}x${size}.png`
            : `icon-${size}x${size}.png`;
      outputs.set(
        `${directory}/${filename}`,
        yield* render(() => sharp(icon).resize(size, size).png().toBuffer()),
      );
    }
    const icoImages = yield* Effect.forEach(WINDOWS_ICON_SIZES, (size) =>
      render(async () => ({
        size,
        contents: await sharp(icon).resize(size, size).png().toBuffer(),
      })),
    );
    outputs.set(`${directory}/icon.ico`, encodePngIco(icoImages));
    outputs.set(
      `${directory}/favicon.ico`,
      encodePngIco(icoImages.filter(({ size }) => size <= 48)),
    );
    outputs.set(
      `${directory}/app-icon.icon/Assets/mark.png`,
      yield* render(() =>
        sharp(mark)
          .resize(740, 740)
          .extend({ top: 142, bottom: 142, left: 142, right: 142, background: "#00000000" })
          .png()
          .toBuffer(),
      ),
    );
    const projectJson = yield* encodeJson({
      fill: {
        solid: `display-p3:${[1, 3, 5].map((offset) => (parseInt(variant.background.slice(offset, offset + 2), 16) / 255).toFixed(5)).join(",")},1.00000`,
      },
      groups: [{ layers: [{ "image-name": "mark.png", name: "Murmur" }] }],
      "supported-platforms": { squares: "shared", circles: ["watchOS"] },
    });
    outputs.set(`${directory}/app-icon.icon/icon.json`, Buffer.from(projectJson + "\n"));

    const androidBackground = yield* render(() =>
      sharp({ create: { width: 432, height: 432, channels: 4, background: variant.background } })
        .png()
        .toBuffer(),
    );
    if (variant.name !== "prod")
      outputs.set(
        `apps/mobile/assets/android-icon-background-${variant.name}.png`,
        androidBackground,
      );
    const androidForeground = yield* render(() =>
      sharp(mark)
        .resize(224, 224)
        .extend({ top: 104, bottom: 104, left: 104, right: 104, background: "#00000000" })
        .png()
        .toBuffer(),
    );
    outputs.set("apps/mobile/assets/android-icon-foreground.png", androidForeground);
    outputs.set(
      `apps/mobile/assets/android-splash-icon-${variant.name}.png`,
      yield* render(() =>
        sharp(androidBackground)
          .composite([{ input: androidForeground }])
          .png()
          .toBuffer(),
      ),
    );
    if (variant.name === "prod") {
      const monochrome = yield* render(() =>
        sharp(androidForeground)
          .ensureAlpha()
          .extractChannel("alpha")
          .raw()
          .toBuffer({ resolveWithObject: true }),
      );
      outputs.set(
        "apps/mobile/assets/android-icon-mark.png",
        yield* render(() =>
          sharp({
            create: {
              width: monochrome.info.width,
              height: monochrome.info.height,
              channels: 3,
              background: "white",
            },
          })
            .joinChannel(monochrome.data, {
              raw: { width: monochrome.info.width, height: monochrome.info.height, channels: 1 },
            })
            .png()
            .toBuffer(),
        ),
      );
      outputs.set(
        "apps/mobile/assets/android-notification-icon.png",
        yield* render(() =>
          sharp(mark)
            .resize(96, 96)
            .ensureAlpha()
            .linear([0, 0, 0, 1], [255, 255, 255, 0])
            .png()
            .toBuffer(),
        ),
      );
    }
  }

  const alpha = yield* render(() =>
    sharp(mark).resize(128, 128).ensureAlpha().extractChannel("alpha").raw().toBuffer(),
  );
  const segments: string[] = [];
  for (let y = 0; y < 128; y++) {
    let start = -1;
    for (let x = 0; x <= 128; x++) {
      const opaque = x < 128 && alpha[y * 128 + x]! >= 128;
      if (opaque && start < 0) start = x;
      if (!opaque && start >= 0) {
        segments.push(`M${start},${y}h${x - start}v1h${start - x}Z`);
        start = -1;
      }
    }
  }
  const silhouette = segments.join("");
  const monoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path fill="white" d="${silhouette}"/></svg>\n`;
  outputs.set("apps/mobile/assets/widget/MurmurMark.svg", Buffer.from(monoSvg));
  outputs.set(
    "assets/murmur/logo.svg",
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><image width="1024" height="1024" href="data:image/png;base64,${mark.toString("base64")}"/></svg>\n`,
    ),
  );
  outputs.set(
    "apps/mobile/modules/t3-agent-notifications/android/src/main/res/drawable/agent_activity_mark.xml",
    Buffer.from(
      `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="128" android:viewportHeight="128"><path android:fillColor="#FFFFFFFF" android:pathData="${silhouette}"/></vector>\n`,
    ),
  );
  for (const channel of ["latest", "nightly"]) {
    const name = `apps/desktop/resources/dmg/dmg-background-${channel}.svg`;
    const template = yield* fs.readFileString(path.join(root, name));
    const image = `<image id="murmur-mark" x="32" y="16" width="30" height="30" href="data:image/png;base64,${mark.toString("base64")}"/>`;
    outputs.set(name, Buffer.from(template.replace(/<image id="murmur-mark"[^>]*\/>/, image)));
  }

  for (const target of ["apps/web/public", "apps/marketing/public"]) {
    const channel = target === "apps/web/public" ? "dev" : "prod";
    for (const name of [
      "favicon.ico",
      "favicon-16x16.png",
      "favicon-32x32.png",
      "apple-touch-180.png",
      "icon-192x192.png",
      "icon-512x512.png",
    ]) {
      outputs.set(
        `${target}/${name.replace("apple-touch-180", "apple-touch-icon")}`,
        outputs.get(`assets/murmur/${channel}/${name}`)!,
      );
    }
  }
  for (const [channel, filename] of [
    ["prod", "icon.webp"],
    ["nightly", "icon-nightly.webp"],
  ] as const) {
    outputs.set(
      `apps/marketing/src/assets/${filename}`,
      yield* render(() =>
        sharp(outputs.get(`assets/murmur/${channel}/icon.png`))
          .webp({ lossless: true })
          .toBuffer(),
      ),
    );
  }

  const stale: string[] = [];
  for (const [relativePath, bytes] of outputs) {
    const destination = path.join(root, relativePath);
    if (checkOnly) {
      const actual = yield* fs.readFile(destination).pipe(Effect.option);
      if (actual._tag === "None" || !Buffer.from(actual.value).equals(Buffer.from(bytes)))
        stale.push(relativePath);
    } else {
      yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
      yield* fs.writeFile(destination, bytes);
    }
  }
  if (stale.length > 0)
    return yield* new BrandAssetError({ cause: `品牌资源需要重新导出：\n${stale.join("\n")}` });
  yield* Console.log(`${checkOnly ? "已核验" : "已生成"} ${outputs.size} 个 Murmur 品牌资源。`);
});

const command = Command.make(
  "export-brand-icons",
  {
    check: Flag.Boolean("check").pipe(Flag.withDefault(false)),
  },
  ({ check }) => exportBrandIcons(check),
);

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
