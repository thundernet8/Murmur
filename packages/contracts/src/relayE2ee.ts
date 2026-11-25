import * as Schema from "effect/Schema";

export const RELAY_E2EE_PATH = "/api/relay-e2ee";
export const RELAY_E2EE_PROLOGUE = "murmur-relay-e2ee/1";
export const RelayTunnelControl = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("http"),
    url: Schema.String,
    method: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("ws"),
    url: Schema.String,
    protocols: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("response"),
    status: Schema.Int,
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("open"), protocol: Schema.String }),
  Schema.Struct({ type: Schema.Literals(["end", "ack", "pull"]) }),
]);
export type RelayTunnelControl = typeof RelayTunnelControl.Type;
export const decodeRelayTunnelControl = Schema.decodeUnknownSync(
  Schema.fromJsonString(RelayTunnelControl),
);
