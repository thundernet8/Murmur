import { normalizeSecureRelayUrl } from "@murmur/shared/relayUrl";
import { reloadAppAsync } from "expo";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { getRelayUrlOverride, saveRelayUrlOverride } from "../cloud/relaySettings";
import { SettingsSection } from "./components/SettingsSection";

export function RelayServerSettings() {
  const gt = useGT();
  const override = getRelayUrlOverride();
  const [address, setAddress] = useState(override ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function apply(value: string) {
    const normalized = value.trim() ? normalizeSecureRelayUrl(value) : null;
    if (value.trim() && !normalized) {
      setError(
        gt("Enter an HTTPS address without credentials, a path, query parameters, or a fragment."),
      );
      return;
    }
    setSaving(true);
    setError(null);
    void saveRelayUrlOverride(normalized)
      .then(() => reloadAppAsync())
      .catch(() => {
        setSaving(false);
        setError(gt("Could not apply the relay address. Try again or reopen the app."));
      });
  }

  return (
    <View className="mb-5">
      <SettingsSection title={gt("Relay server")}>
        <View className="gap-3 p-4">
          <AppText>
            {gt(
              "Used by this client for Murmur Connect. Saving reloads the client. Leave blank to use the default address.",
            )}
          </AppText>
          <AppTextInput
            accessibilityLabel={gt("Relay server address")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://relay.example.com"
            value={address}
            editable={!saving}
            onChangeText={(value) => {
              setAddress(value);
              setError(null);
            }}
            onSubmitEditing={() => apply(address)}
          />
          {error ? (
            <AppText accessibilityRole="alert" className="text-danger">
              {error}
            </AppText>
          ) : null}
          <View className="gap-2">
            <Button
              label={gt("Save and reload")}
              onPress={() => apply(address)}
              disabled={saving || address.trim() === (override ?? "")}
              loading={saving}
            />
            <Button
              label={gt("Use default and reload")}
              tone="text"
              onPress={() => apply("")}
              disabled={saving || override === null}
            />
          </View>
        </View>
      </SettingsSection>
    </View>
  );
}
