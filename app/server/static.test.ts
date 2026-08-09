import { describe, it, expect } from "vitest";
import {
    resolveStaticTarget,
    IMMUTABLE_CACHE_CONTROL,
    SHORT_CACHE_CONTROL,
} from "./static";

const CLIENT = "/srv/emusync/build/client";

describe("resolveStaticTarget", () => {
    it("maps an asset path to a file under the client directory", () => {
        expect(
            resolveStaticTarget(CLIENT, "/assets/entry.client-abc123.js"),
        ).toEqual({
            absolutePath: `${CLIENT}/assets/entry.client-abc123.js`,
            cacheControl: IMMUTABLE_CACHE_CONTROL,
        });
    });

    it("caches hashed assets immutably and everything else briefly", () => {
        expect(resolveStaticTarget(CLIENT, "/assets/x.js")?.cacheControl).toBe(
            IMMUTABLE_CACHE_CONTROL,
        );
        expect(resolveStaticTarget(CLIENT, "/favicon.ico")?.cacheControl).toBe(
            SHORT_CACHE_CONTROL,
        );
    });

    // "/assets/%2e%2e%2ffavicon.ico" decodes to "/assets/../favicon.ico",
    // which stays inside the client directory and so is legitimately served —
    // but it names a stable file, not a hashed one. Classifying on the
    // request prefix would cache favicon.ico immutably for a year.
    it("does not cache a non-hashed file immutably via an /assets/ alias", () => {
        expect(
            resolveStaticTarget(CLIENT, "/assets/%2e%2e%2ffavicon.ico"),
        ).toEqual({
            absolutePath: `${CLIENT}/favicon.ico`,
            cacheControl: SHORT_CACHE_CONTROL,
        });
    });

    // The guard's whole reason to exist. WHATWG URL parsing collapses a
    // literal "/../.." before the server sees it, but percent-encoded dots
    // survive until decodeURIComponent and do escape the client directory.
    it("rejects percent-encoded traversal out of the client directory", () => {
        expect(
            resolveStaticTarget(CLIENT, "/%2e%2e/%2e%2e/package.json"),
        ).toBeNull();
        expect(
            resolveStaticTarget(CLIENT, "/%2e%2e/server/index.js"),
        ).toBeNull();
    });

    it("rejects a decoded traversal even when it is spelled literally", () => {
        expect(
            resolveStaticTarget(CLIENT, "/../../app/server/db.json"),
        ).toBeNull();
        expect(resolveStaticTarget(CLIENT, "/../server/index.js")).toBeNull();
    });

    // "/srv/emusync/build/client-secrets" shares the string prefix but is a
    // sibling, so a plain startsWith on the bare directory would let it
    // through.
    it("rejects a sibling directory that shares the client prefix", () => {
        expect(
            resolveStaticTarget(CLIENT, "/../client-secrets/keys.txt"),
        ).toBeNull();
    });

    it("rejects malformed percent-encoding rather than throwing", () => {
        expect(resolveStaticTarget(CLIENT, "/assets/%E0%A4%A.js")).toBeNull();
        expect(resolveStaticTarget(CLIENT, "/%")).toBeNull();
    });

    it("rejects an embedded NUL byte", () => {
        expect(resolveStaticTarget(CLIENT, "/assets/a.js%00.png")).toBeNull();
    });

    // Not a file request: "/" is the home route and has to reach the app's
    // SSR handler. Returning a target here would try to send a directory.
    it("declines the client directory itself so / falls through to SSR", () => {
        expect(resolveStaticTarget(CLIENT, "/")).toBeNull();
    });

    it("handles a client directory given with a trailing separator", () => {
        expect(
            resolveStaticTarget(`${CLIENT}/`, "/assets/x.js")?.absolutePath,
        ).toBe(`${CLIENT}/assets/x.js`);
    });
});
