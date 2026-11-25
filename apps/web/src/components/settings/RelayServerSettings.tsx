import { normalizeSecureRelayUrl } from "@murmur/shared/relayUrl";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { relayUrlOverride, saveRelayUrlOverride } from "../../cloud/relaySettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function RelayServerSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const [address, setAddress] = useState(relayUrlOverride ?? "");
  const [error, setError] = useState<string | null>(null);
  const defaultAddress = (import.meta.env.VITE_MURMUR_RELAY_URL as string | undefined) ?? "";

  function apply(value: string) {
    const normalized = value.trim() ? normalizeSecureRelayUrl(value) : null;
    if (value.trim() && !normalized) {
      setError(
        gt("Enter an HTTPS address without credentials, a path, query parameters, or a fragment."),
      );
      return;
    }
    try {
      saveRelayUrlOverride(normalized);
    } catch {
      setError(gt("Could not save the relay address. Check that local storage is available."));
      return;
    }
    window.location.reload();
  }

  return (
    <SettingsSection {...searchableSetting("relay-server")} title={gt("Relay server")}>
      <SettingsRow
        title={gt("Relay server address")}
        devicePreference
        description={gt(
          "Used by this client for Murmur Connect. Saving reloads the client. Leave blank to use the default address.",
        )}
      >
        <form
          className="space-y-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            apply(address);
          }}
        >
          <Input
            aria-label={gt("Relay server address")}
            aria-invalid={error !== null}
            aria-describedby={error ? "relay-server-error" : undefined}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            type="url"
            placeholder={defaultAddress || "https://relay.example.com"}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setError(null);
            }}
          />
          {error ? (
            <p id="relay-server-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={address.trim() === (relayUrlOverride ?? "")}>
              <T>Save and reload</T>
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={relayUrlOverride === null}
              onClick={() => apply("")}
            >
              <T>Use default and reload</T>
            </Button>
          </div>
        </form>
      </SettingsRow>
    </SettingsSection>
  );
}
