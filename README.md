<p align="center">
  <img src="./assets/murmur/prod/icon-192x192.png" width="96" height="96" alt="Murmur logo" />
</p>

<h1 align="center">Murmur</h1>

<p align="center">重视隐私与安全，开放且包容的 coding agent 工作空间。</p>

Murmur fork 自 [T3 Code](https://github.com/pingdotgg/t3code)。感谢上游项目及所有贡献者；原始项目介绍保留在 [README-Original.md](./README-Original.md)。

## 为什么 fork

我们希望拥有一个能够安心使用、自由参与的 coding agent 应用，并围绕这些原则持续修改：

- **隐私优先**：代码、对话和工作记录由使用者掌控；外部连接与数据流向应清晰、可理解、可选择。
- **安全为本**：重视通信保护、凭证隔离与最小权限，让远程协作的信任边界明确、可审查。
- **开放包容**：欢迎不同背景的使用者与贡献者，尊重不同工具、模型与部署方式，让参与和选择保持开放。

## 配置与数据

Murmur 使用独立的 `.murmur` 命名空间：

- 用户配置根目录默认是 `~/.murmur`，运行数据保存在其中的 `userdata/`。
- 项目开发状态、worktree 与本地工具配置使用 `.murmur/`。
- 环境变量使用 `MURMUR_` 前缀，例如 `MURMUR_HOME`；浏览器本地存储使用 `murmur:` 前缀。
- 项目配置文件为 `murmur.json`。

Murmur 不会自动迁移、读取或覆盖旧的 `.t3` / `.t3code` 数据目录。如需迁移，请先备份，再显式复制所需内容。复制 `.env.example` 只提供空白配置示例；连接自托管的云服务前，需要填写自己的配置。

## 本地开发

```sh
pnpm install
pnpm run dev
```

项目沿用上游的 Vite+ 工具链与 Node 版本要求。更多开发说明见 [开发指南](./docs/operations/00_development.md)。

## 许可证与来源

源码沿用 [MIT License](./LICENSE)。上游名称、商标和原始设计的权利说明见 [TRADEMARK.md](./TRADEMARK.md)；Murmur 使用独立生成的品牌标记。
