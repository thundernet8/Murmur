# Murmur Connect

Murmur Connect 使用 Clerk 管理云端身份。relay 负责发现环境和分配 Tunnel，
客户端业务流量通过 Tunnel 内的端到端加密通道传输；Cloudflare 的 TLS 终止点也只能看到密文。
部署配置见 [Connect setup runbook](../operations/02_connect-setup.md)。

## 配对是信任根

主机在本地 secret store 保存独立的 X25519 身份。公钥随一次性配对凭证放入链接 fragment，
由客户端独立保存；relay 的发现结果只能提供路由，不能替换公钥。旧的 relay 会话须重新配对，
没有本地公钥时不发送环境会话凭证，也不降级到明文。

传输参考 [Paseo 的受保护端点方案](https://github.com/getpaseo/paseo/blob/main/docs/relay-endpoint-security.md)，
使用 Noise NK、X25519、ChaCha20-Poly1305 和 SHA-256。双方每次握手生成临时密钥，
每个方向独立计数，认证失败关闭连接。记录层同时保护文本／二进制类型和分块边界。
改编的 Noise 实现及其 Apache-2.0 许可在 [relayE2ee](../../packages/shared/src/relayE2ee/noise.ts)。

## Tunnel 不直接暴露业务服务

[RelayEncryption](../../apps/server/src/relay/RelayEncryption.ts) 将受管理 Tunnel 指向仅监听本机的
密文网关，而不是业务 HTTP listener。网关只允许健康检查及签名的 bootstrap mint 请求走公开控制面；
其他 HTTP 请求与 WebSocket upgrade 均须先完成 Noise 握手，再由本机转给原有处理器。
加密不会代替原有的 session、scope、撤销及 DPoP 校验。新 relay 设备始终需要本机审批，
relay 签名本身不授予设备访问权。

客户端的 HTTP、RPC、媒体请求复用 [relayTransport](../../packages/shared/src/relayTransport.ts)。
文件在本地解密后呈现；桌面 SOCKS 预览直接复用此适配器，移动端原生代理通过进程内字节桥接复用它。
原生代理不另行学习公钥或发出明文 relay 请求。
活动推送只发送进度元数据，项目名、会话标题、摘要和模型信息不离开加密通道。

外部 webhook 发送者不参与此握手，因此不能视为端到端加密客户端；密文入口不会把其请求转给业务服务。
第三方 webhook 在 relay 接收处的内容以及已保存的离线 inbox 不受本通道保护。

## Link, allocation, and tunnel lifetimes

- CLI authorization, desired exposure, and a running connector have separate lifetimes: linking can
  record intent while stopped, and logout revokes cloud credentials without uninstalling the
  background service.
- Normal CLI shutdown releases its paid tunnel while keeping the hostname reservation and allocation
  record (so the environment shows offline rather than unauthorized). Client-installed links and
  update handoffs retain the tunnel across shutdown so updates do not pay DNS/routing propagation
  delay.
- Every allocation mutation bumps its `generation`. Unlink commits authorization revocation before
  external teardown, and release/reclamation lock on the claimed generation so delayed cleanup never
  deletes a tunnel reused by a concurrent restart or relink
  ([`ManagedEndpointProvider.ts`](../../infra/relay/src/environments/ManagedEndpointProvider.ts)).
- Idle tunnel reclamation deletes only tunnels whose host has registered recovery (and never
  unallocated orphans) so hosts that cannot self-heal are left alone.

## T3 Chat plan cap link

T3 Chat uses WorkOS rather than Clerk, so accounts link by user consent via a shared secret. T3 Chat
owns the link and plan state; the relay stores no copy and queries T3 Chat only when an account hits
its default cap for a new environment, failing closed to the default cap without disrupting existing
slots.

## OAuth traps

- Interactive clients use Clerk session-template JWTs; the headless CLI uses a public PKCE OAuth
  client with no secret. The relay must accept both.
- Loopback CLI login starts on the hosted `/connect` page so sign-in finishes before Clerk's
  authorize endpoint (going straight to authorize drops parameters across sign-in redirects).
- SSH and headless sessions use Clerk's OAuth device authorization grant directly against Clerk's
  token endpoint, which must stay enabled on the CLI OAuth application.
