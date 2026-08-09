// Production server. Replaces `react-router-serve`, which pulled in express,
// compression, morgan and source-map-support to do what Bun does natively.
//
// The thing that actually forced this: react-router-serve ships a
// `#!/usr/bin/env node` shebang, so `bun run start` became bun -> bunx -> node
// and the server ran under Node, not Bun. Its SIGTERM handler calls
// server.close(), which stops the listener but leaves the process alive as
// long as anything else holds the event loop open — the Redis socket does,
// from the first request onward. Measured on the server: 90.26s to restart, a
// systemd stop timeout ending in SIGKILL, with nothing even connected.
//
// So shutdown here does not rely on the loop draining by itself. See stop().
import path from "node:path";
import { resolveStaticTarget } from "~/server/static";

// Before anything that reaches React. Static imports are evaluated ahead of
// the module body, so importing react-router at the top of this file loaded
// React under an unset NODE_ENV and resolved its "development" export
// condition, while react-dom had already picked its production build. SSR then
// died on `dispatcher.getOwner is not a function` for every HTML route, with
// static assets still serving fine — so it looked like a routing bug.
// createRequestHandler is imported below, after this line, for that reason.
process.env.NODE_ENV ??= "production";

const { createRequestHandler } = await import("react-router");

// Not a literal: TypeScript would try to resolve the build, which does not
// exist at typecheck time. It is also genuinely configurable —
// react-router-serve took the same value as argv[2], and deploy/smoke.sh
// relies on the default.
const buildPath = process.argv[2] ?? "./build/server/index.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[emusync] invalid PORT: ${process.env.PORT}`);
    process.exit(1);
}

// Deliberately no available-port probe. react-router-serve silently bound a
// random port when the configured one was taken, which for a service behind a
// fixed port is a failure wearing a success costume. Bun.serve throws
// EADDRINUSE and systemd reports it.

const clientDir = path.resolve(
    path.dirname(path.resolve(buildPath)),
    "../client",
);

const build = await import(buildPath);
const handleRequest = createRequestHandler(build, process.env.NODE_ENV);

// Path handling lives in app/server/static.ts so it can be unit-tested
// without booting a listener. This is the containment check express used to
// do for us, and it is the only genuinely new attack surface in this file.
//
// Two things review keeps flagging here, both deliberate:
//
// No response compression. react-router-serve ran compression(); this does
// not. The app is LAN/Tailscale only, the largest asset is 182 kB (58 kB
// gzipped) and is served immutable, so it is fetched once. Revisit by
// measuring, not by assuming — the middleware is easy to reintroduce.
//
// No directory handling. Bun.file(dir).exists() is false on Bun 1.3.14
// (verified), so "/assets" falls through to the app and 404s rather than
// producing a directory-backed Response. If that ever changes, this needs an
// explicit stat.
const staticResponse = async (pathname: string) => {
    const target = resolveStaticTarget(clientDir, pathname);
    if (!target) return null;

    const file = Bun.file(target.absolutePath);
    if (!(await file.exists())) return null;

    return new Response(file, {
        headers: { "Cache-Control": target.cacheControl },
    });
};

const server = Bun.serve({
    port,
    hostname: process.env.HOST,
    // Long syncs are driven by fetches that stay open for the whole run, so no
    // request timeout. The sync lock, not the server, is what bounds them.
    idleTimeout: 0,
    async fetch(request) {
        const started = performance.now();
        const url = new URL(request.url);

        const respond = async () => {
            if (request.method === "GET" || request.method === "HEAD") {
                const asset = await staticResponse(url.pathname);
                if (asset) return asset;
            }
            return handleRequest(request);
        };

        const response = await respond();
        const ms = (performance.now() - started).toFixed(1);
        console.log(
            `${request.method} ${url.pathname} ${response.status} - ${ms} ms`,
        );
        return response;
    },
});

console.log(`[emusync] http://${server.hostname}:${server.port}`);

// Stop accepting, give in-flight requests a bounded grace period, then exit
// explicitly.
//
// The explicit exit is the point. Waiting for the event loop to drain is what
// hung the old server: the Redis client's socket keeps it open forever, and
// that client lives inside the bundled build where this file cannot reach it.
// A sync in progress is not restart-safe either way — it was already being
// SIGKILLed at 90s — so the choice is how fast we admit that, not whether.
// Fall back rather than trust the parse: a typo'd SHUTDOWN_GRACE_MS makes
// this NaN, every `Date.now() >= NaN` is false, and the deadline branch that
// guarantees an exit can never fire — reintroducing the exact hang this file
// exists to remove, just behind the systemd backstop instead of in front of it.
// Trimmed and emptiness-checked before Number(), because Number("") is 0, not
// NaN: a blank `Environment=SHUTDOWN_GRACE_MS=` in the unit file would
// otherwise mean "exit instantly", cutting off in-flight requests, which is
// not what an operator clearing a value is asking for.
const rawGrace = (process.env.SHUTDOWN_GRACE_MS ?? "").trim();
const parsedGrace = rawGrace === "" ? NaN : Number(rawGrace);
const GRACE_MS =
    Number.isFinite(parsedGrace) && parsedGrace >= 0 ? parsedGrace : 5000;

const stop = (signal: string) => {
    console.log(`[emusync] ${signal}: draining up to ${GRACE_MS}ms`);
    void server.stop();

    const deadline = Date.now() + GRACE_MS;
    const check = () => {
        if (server.pendingRequests === 0) {
            console.log("[emusync] drained, exiting");
            process.exit(0);
        }
        if (Date.now() >= deadline) {
            const open = server.pendingRequests;
            console.log(`[emusync] ${open} request(s) open, exiting anyway`);
            process.exit(0);
        }
        setTimeout(check, 50);
    };
    check();
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => stop(signal));
}
