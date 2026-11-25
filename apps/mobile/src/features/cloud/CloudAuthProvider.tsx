import { ClerkProvider, getClerkInstance } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Suspense, use, type ReactNode } from "react";

import { cloudAccountService, deactivateCloudRelayAccount } from "./cloudAccountService";
import { resolveCloudPublicConfig } from "./publicConfig";
import { loadRelayClientSettings } from "./relaySettings";

const cloudAuthReady = loadRelayClientSettings().then(() => {
  const cloudConfig = resolveCloudPublicConfig();
  const publishableKey = cloudConfig.relay.url ? cloudConfig.clerk.publishableKey : null;
  if (publishableKey) {
    // 等待本机 relay 配置后再挂接 Clerk，避免启动时向构建默认地址发送请求。
    cloudAccountService.attach(getClerkInstance({ publishableKey }));
  } else {
    // 本次启动未启用云端配置，清理之前保留的云端账户状态。
    deactivateCloudRelayAccount();
  }
  return publishableKey;
});

export function CloudAuthProvider(props: { readonly children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ReadyCloudAuthProvider {...props} />
    </Suspense>
  );
}

function ReadyCloudAuthProvider(props: { readonly children: ReactNode }) {
  const publishableKey = use(cloudAuthReady);
  if (!publishableKey) {
    return props.children;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      {props.children}
    </ClerkProvider>
  );
}
