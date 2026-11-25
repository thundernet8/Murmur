import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as NodeDns from "node:dns";
import * as NodeOS from "node:os";
import * as NodeSea from "node:sea";

export const Platform = Context.Reference<NodeJS.Platform>("@murmur/shared/HostProcess/Platform", {
  defaultValue: () => process.platform,
});

export const Architecture = Context.Reference<NodeJS.Architecture>(
  "@murmur/shared/HostProcess/Architecture",
  {
    defaultValue: () => process.arch,
  },
);

export const KernelRelease = Context.Reference<string>("@murmur/shared/HostProcess/KernelRelease", {
  defaultValue: () => NodeOS.release(),
});

export const LinuxLibc = Context.Reference<"gnu" | "musl">("@murmur/shared/HostProcess/LinuxLibc", {
  defaultValue: () => {
    try {
      const report = process.report?.getReport() as
        | { header?: { glibcVersionRuntime?: unknown } }
        | undefined;
      return typeof report?.header?.glibcVersionRuntime === "string" ? "gnu" : "musl";
    } catch {
      return "musl";
    }
  },
});

export const Hostname = Context.Reference<string>("@murmur/shared/HostProcess/Hostname", {
  defaultValue: () => NodeOS.hostname(),
});

export const Username = Context.Reference<string | null>("@murmur/shared/HostProcess/Username", {
  defaultValue: () => {
    try {
      return NodeOS.userInfo().username.trim() || null;
    } catch {
      return null;
    }
  },
});

export const HomeDirectory = Context.Reference<string>("@murmur/shared/HostProcess/HomeDirectory", {
  defaultValue: () => NodeOS.homedir(),
});

export const Environment = Context.Reference<NodeJS.ProcessEnv>(
  "@murmur/shared/HostProcess/Environment",
  {
    defaultValue: () => process.env,
  },
);

export const WorkingDirectory = Context.Reference<string>(
  "@murmur/shared/HostProcess/WorkingDirectory",
  {
    defaultValue: () => process.cwd(),
  },
);

export const ExecutablePath = Context.Reference<string>(
  "@murmur/shared/HostProcess/ExecutablePath",
  {
    defaultValue: () => process.execPath,
  },
);

export const Arguments = Context.Reference<ReadonlyArray<string>>(
  "@murmur/shared/HostProcess/Arguments",
  {
    defaultValue: () => process.argv,
  },
);

/** Original shell command spelling; argv[0] and execPath instead identify the resolved binary. */
export const InvokedAs = Context.Reference<string>("@murmur/shared/HostProcess/InvokedAs", {
  defaultValue: () => process.argv0,
});

export const IsExecutable = Context.Reference<boolean>("@murmur/shared/HostProcess/IsExecutable", {
  defaultValue: () => NodeSea.isSea(),
});

export class HostnameLookupError extends Schema.TaggedError<HostnameLookupError>()(
  "HostnameLookupError",
  { hostname: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not resolve ${this.hostname}.`;
  }
}

/** Includes hostname-resolved addresses absent from interfaces, such as Debian's 127.0.1.1 used by Firefox locks. */
export const Addresses = Context.Reference<Effect.Effect<ReadonlySet<string>>>(
  "@murmur/shared/HostProcess/Addresses",
  {
    // The enclosing operation owns the span for this inline handler.
    defaultValue: Effect.fnUntraced(function* () {
      const interfaces = Object.values(NodeOS.networkInterfaces())
        .flat()
        .flatMap((entry) => (entry ? [entry.address] : []));
      const hostname = NodeOS.hostname();
      const resolved = yield* Effect.tryPromise({
        try: () => NodeDns.promises.lookup(hostname, { all: true }),
        catch: (cause) => new HostnameLookupError({ hostname, cause }),
      }).pipe(
        Effect.map((entries) => entries.map((entry) => entry.address)),
        Effect.orElseSucceed(() => [] as ReadonlyArray<string>),
      );
      return new Set([...interfaces, ...resolved]);
    }),
  },
);

export const UserId = Context.Reference<number | undefined>("@murmur/shared/HostProcess/UserId", {
  defaultValue: () => process.getuid?.(),
});

export const isWindows = Effect.map(Platform, (platform) => platform === "win32");
