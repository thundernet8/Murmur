# Murmur Connect setup

Deployment and client configuration for Murmur Connect. See [Murmur Connect](../internals/06_t3-connect.md) for trust boundaries and [infra/relay/README.md](../../infra/relay/README.md#deployment) for relay provisioning.

## Public application configuration

Murmur Connect is disabled in a fresh clone. Copy `.env.example` to `.env` for production, or set these public identifiers in `.env` / `.env.local` (process env > `.env.local` > `.env`):

```dotenv
MURMUR_CLERK_PUBLISHABLE_KEY=<publishable key>
MURMUR_CLERK_JWT_TEMPLATE=<JWT template name>
MURMUR_CLERK_CLI_OAUTH_CLIENT_ID=<public OAuth application client ID>
MURMUR_RELAY_URL=https://relay.example.com
```

`CLERK_SECRET_KEY` belongs only in relay secrets, never in client config. Client and bundled-server builds embed these values at build time; EAS preview/production environments need the publishable key, JWT template, and relay URL.

客户端可在「设置 → 环境 → Relay 服务器」覆盖 relay 地址，保存后自动重新加载，无需重新构建。此设置仅保存在当前浏览器或设备，留空或选择恢复默认值会使用构建时配置；它不会修改所连接主机的服务端配置。地址必须是 HTTPS origin，不包含凭据、路径、查询参数或 fragment。Clerk 配置仍需在构建时提供，单独设置 relay 地址不会启用尚未配置身份认证的 Murmur Connect。

## Clerk setup

### CLI OAuth application

Create a public OAuth application in Clerk (authorization code + PKCE):

1. Redirect URI: `http://127.0.0.1:34338/callback`
2. Scopes: `openid`, `profile`, `email`, `offline_access`
3. Enable **Device authorization grant** (required for headless/SSH login; Clerk enables it per account on request).
4. Set `MURMUR_CLERK_CLI_OAUTH_CLIENT_ID` to its public client ID.

### JWT template

Create a Clerk JWT template named `t3-relay` with `{ "aud": "t3-code-relay" }`. Set `MURMUR_CLERK_JWT_TEMPLATE=t3-relay` on clients and `CLERK_JWT_AUDIENCE=t3-code-relay` on the relay.

### Desktop OAuth redirects

Enable Clerk's Native API, add `murmur-dev://app/` and `murmur://app/` to the SSO redirect allowlist, and add `murmur-dev://app` and `murmur://app` to `allowed_origins` via `PATCH https://api.clerk.com/v1/instance` (preserving existing entries).

### Android native sign-in redirects

In Clerk **Native applications > Allowlist for mobile SSO redirect**, allow each variant's callback:

| Variant     | Callback                              |
| ----------- | ------------------------------------- |
| Development | `clerk://app.murmur.dev.callback`     |
| Preview     | `clerk://app.murmur.preview.callback` |
| Production  | `clerk://app.murmur.callback`         |

### Restricting sign-ups

Use Clerk's allowlist or Restricted mode for new sign-ups (an enabled empty allowlist blocks all sign-ups). Ban the account in Clerk to revoke existing sessions.

## Android FCM push setup

The relay sends Android push notifications directly via FCM HTTP v1 (no Expo Push account required):

1. Register each Android package (`app.murmur.{dev,preview}` / `app.murmur`) in Firebase and download `google-services.json`.
2. Pass `MURMUR_ANDROID_GOOGLE_SERVICES_FILE=/abs/path/google-services.json` when prebuilding/building locally or as an EAS file variable (available to fingerprint generation as well).
3. Enable the FCM API and store the Firebase service-account JSON only in the relay's `FCM_SERVICE_ACCOUNT` secret (never in EAS app env or the repo). Set `APNS_ENABLED=false` for an Android-only relay stage.
4. For local smoke/watch verification without deploying a relay, use `vp run push:android:smoke` and `vp run push:android:watch` from `infra/relay`.

## Desktop passkeys

For a signed macOS build (`app.murmur`):

1. Create an explicit macOS App ID with **Associated Domains** and a matching distribution provisioning profile.
2. In Clerk Native API settings, add an iOS app with the same Apple Team ID and bundle ID, and verify `https://<frontend-api>/.well-known/apple-app-site-association` includes `<TEAM_ID>.app.murmur`.
3. Configure signing per [Apple signing and notarization](./03_release.md#apple-signing-and-notarization-macos). Local signed builds use `MURMUR_APPLE_TEAM_ID`, `MURMUR_MACOS_PROVISIONING_PROFILE`, and optionally `MURMUR_CLERK_PASSKEY_RP_DOMAINS`. Bump the build version after changing Associated Domains so macOS refreshes cached Shared Web Credentials.

Unsigned `dev:desktop` cannot exercise passkeys. For renderer HMR with passkeys, launch an installed signed build against `vp run dev:web`:

```sh
VITE_DEV_SERVER_URL=http://127.0.0.1:5733 MURMUR_PORT=13773 \
  "/Applications/Murmur (Alpha).app/Contents/MacOS/Murmur (Alpha)"
```
