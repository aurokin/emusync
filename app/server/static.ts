import path from "node:path";

// A hashed asset filename is a content address, so it can be cached forever.
// Everything else under build/client (favicon.ico and whatever else Vite
// copies out of public/) keeps a short TTL: the name is stable, the bytes
// are not.
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const SHORT_CACHE_CONTROL = "public, max-age=3600";

export type StaticTarget = {
    absolutePath: string;
    cacheControl: string;
};

// Maps a request pathname to a file inside clientDir, or null if it does not
// name one. Returning a target does not mean the file exists — the caller
// checks that; this only decides where a path is allowed to point.
//
// Split out of server.ts to be testable: importing server.ts starts a
// listener, and the path handling here is the one part of that file with
// enough edge cases to be worth asserting directly.
export const resolveStaticTarget = (
    clientDir: string,
    pathname: string,
): StaticTarget | null => {
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        // Malformed percent-encoding. Not a file request; let the app 404 it.
        return null;
    }

    // A NUL byte truncates the path in some syscalls, so "/assets/a.js\0.png"
    // can name a different file than it appears to.
    if (decoded.includes("\0")) return null;

    // Resolve first, then confirm the result is still inside clientDir.
    // WHATWG URL parsing already collapses a literal "/../.." before it
    // reaches here, but percent-encoded "%2e%2e" survives decoding above and
    // does escape, so this is load-bearing rather than belt-and-braces.
    const absolutePath = path.resolve(clientDir, `.${decoded}`);
    const root = clientDir.endsWith(path.sep)
        ? clientDir
        : clientDir + path.sep;
    if (!absolutePath.startsWith(root)) return null;

    return {
        absolutePath,
        // Keyed off the resolved path, not the request path. Only files Vite
        // actually emitted into assets/ are content-hashed, and
        // "/assets/%2e%2e%2ffavicon.ico" decodes to "/assets/../favicon.ico":
        // it stays inside clientDir so the guard above allows it, but it names
        // a stable-named file. Matching on the request prefix would hand that
        // file a one-year immutable policy and strand it across deploys.
        cacheControl: absolutePath.startsWith(
            path.join(root, "assets") + path.sep,
        )
            ? IMMUTABLE_CACHE_CONTROL
            : SHORT_CACHE_CONTROL,
    };
};
