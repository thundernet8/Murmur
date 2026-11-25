# Murmur 品牌资源

`murmur/mark.png` 是使用内置 imagegen 生成的新标记源文件。生成提示词：

> 为 Murmur 创建一个独立的应用标记：以两道柔和交叠的对话声波构成小写 m，表达隐私、安全与开放包容。几何轮廓、圆润末端、青绿色、透明背景，无文字；前侧拱肩有一道收细的弧形高光，呈现柔和的实体感。在小尺寸下仍清晰可辨，不沿用 T3 品牌设计。

运行 `vp run icons:export` 从源图重复生成 Web、桌面、iOS、Android、widget 和营销页面资源。运行 `vp run icons:check` 逐字节核验导出结果；无需 Icon Composer 或网络。

开发版、Nightly 和生产版使用不同底色，共享同一标记。通用与 Web 图标使用透明底的大圆角外框。macOS PNG 使用 1024×1024 画布，824×824 图标主体居中，四周各留 100px 安全区，外框同步加大圆角。iOS 保留完整底色画布，由系统裁切；Android adaptive 与 splash 图像为系统遮罩保留安全区。通知和 widget 使用从源图 alpha 提取的单色轮廓。

`dev/`、`nightly/`、`prod/` 中的旧版素材仅保留为上游历史资源，应用构建不再引用它们；原 README 中的图标仍指向原始素材。上游商标说明见 [TRADEMARK.md](../TRADEMARK.md)。

## 圆角与光泽调整

使用内置 imagegen，以现有透明标记和图标截图为参考，圆润末端并添加弧形高光，再清理透明边缘。完整编辑提示词如下：

```text
Use case: logo-brand / precise-object-edit. Image 1 is the editable Murmur mark; Image 2 is a screenshot showing its current app icon for context only. Refine the existing mark, keeping its identity, silhouette proportions, two overlapping speech-wave arches forming a lowercase m, overlap direction, and dark-teal to turquoise palette. Make the form softer and more rounded: smooth all joins and round off the two flared outside feet into gently pill-like rounded terminals, keeping the m recognizable. Add one elegant thin curved specular highlight following the upper shoulder of the front turquoise arch, tapering softly at both ends. This restrained mint-white sheen should make the mark feel like a subtly convex solid piece of satin-polished resin, with gentle tonal volume, not flat. Keep the highlight tasteful and readable at app-icon scale, with no separate decorative stroke outside the mark. No chrome, glitter, lens flare, heavy bevels, extra objects, text, or watermark. Output ONLY the revised single mark on an actual transparent background, centered on a square canvas with clean alpha. Do not include the screenshot's dark tile, border, white margin, or UI; the application will supply its rounded tile separately.
```

```text
Use case: precise-object-edit / background-extraction. Clean up this exact Murmur mark without redesigning it. Preserve its rounded m shape, pill-like feet, dark teal and turquoise colors, overlap, convex satin-resin shading, and the single thin curved white-mint highlight on the upper front arch exactly as shown. Change ONLY the alpha cutout edges: completely remove the fuzzy floating cyan glow, smears, and pixel debris outside and above the upper-right arch, around the inside holes, and below the right foot. The mark must have a single crisp, smooth, antialiased silhouette, with absolutely zero color or alpha outside that silhouette and fully transparent interior holes. No halo, ambient glow, bloom, cast shadow, background, ground plane, added border, text, or objects. Keep the existing internal highlight and volume. Output only the cleaned mark on a genuinely transparent square canvas.
```

## 原始生成提示词

以下为内置 imagegen 的完整输入，源图保存在 `murmur/mark.png`：

```text
Use case: logo-brand. Create the final application brand mark for Murmur, an open inclusive coding-agent app centered on privacy and security. One single isolated symbol, no words, no lettering, no mockups, no sheets. A compact memorable rounded lowercase m formed from two softly interlocking speech-wave arches; feels calm, welcoming, private and thoughtful. Clean geometric flat silhouette, strong legibility at 16 pixels, generous rounded edges, balanced negative space. Restrained teal/turquoise palette with subtle tonal distinction only, no shadows, no decorative background, no lock or shield clichés. Center the large mark with modest margins in a square transparent canvas. It must be an original brand mark unrelated to T3 branding. Transparent background is essential.
```
