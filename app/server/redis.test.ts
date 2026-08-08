import { describe, expect, it, vi } from "vitest";

const redisMocks = vi.hoisted(() => ({
    createClient: vi.fn(),
}));

vi.mock("redis", () => ({
    createClient: redisMocks.createClient,
}));

const buildClient = () => {
    // The self-referential returns here are fine: `bunx tsc --noEmit` resolves
    // `multi` without TS7022/TS7024 (checked directly; this file is in the
    // program). Reviewers keep flagging it as circular inference.
    const multi = {
        set: vi.fn(() => multi),
        rPush: vi.fn(() => multi),
        expire: vi.fn(() => multi),
        exec: vi.fn(async () => []),
    };
    const client = {
        multi: vi.fn(() => multi),
        __multi: multi,
        isOpen: false,
        connect: vi.fn(async () => {
            client.isOpen = true;
        }),
        quit: vi.fn(async () => {
            client.isOpen = false;
        }),
        on: vi.fn(),
        set: vi.fn(),
        get: vi.fn(),
        rPush: vi.fn(),
        lRange: vi.fn(),
        expire: vi.fn(),
    };
    return client;
};

const loadRedis = async () => {
    vi.resetModules();
    const client = buildClient();
    redisMocks.createClient.mockReturnValue(client);
    const module = await import("./redis");
    return { client, ...module };
};

describe("redis helpers", () => {
    it("throws when client is not connected", async () => {
        const { getRedis } = await loadRedis();

        expect(() => getRedis()).toThrow(
            "Redis client not connected. Call connectRedis() first.",
        );
    });

    it("connects and returns client", async () => {
        const { connectRedis, client } = await loadRedis();

        const result = await connectRedis();

        expect(result).toBe(client);
        expect(client.connect).toHaveBeenCalled();
        expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("writes a record and renews its log in one transaction", async () => {
        // A plain SET would renew only the record, leaving the log to expire
        // first and a live COMPLETE record to poll back with no output.
        const { connectRedis, setSyncRecord, client } = await loadRedis();

        await connectRedis();
        await setSyncRecord("job-1", { ok: true });

        expect(client.__multi.set).toHaveBeenCalledWith(
            "job-1",
            JSON.stringify({ ok: true }),
            { EX: 900 },
        );
        expect(client.__multi.expire).toHaveBeenCalledWith("job-1:log", 900);
        expect(client.__multi.exec).toHaveBeenCalled();
    });

    it("parses json values back", async () => {
        const { connectRedis, getJSON, client } = await loadRedis();

        await connectRedis();
        client.get.mockResolvedValueOnce(JSON.stringify({ ok: false }));

        await expect(getJSON("job-1")).resolves.toEqual({ ok: false });
    });

    it("returns null when key missing", async () => {
        const { connectRedis, getJSON, client } = await loadRedis();

        await connectRedis();
        client.get.mockResolvedValueOnce(null);

        await expect(getJSON("missing")).resolves.toBeNull();
    });

    it("appends log lines with a single atomic rPush", async () => {
        // Not get-then-set: that read-modify-write is exactly how concurrent
        // lines used to overwrite each other and lose EXIT: entries.
        const { connectRedis, appendLog, client } = await loadRedis();

        await connectRedis();
        await appendLog("job-1", "CMD: ls", "EXIT: 0 (ok)");

        expect(client.__multi.rPush).toHaveBeenCalledWith("job-1:log", [
            "CMD: ls",
            "EXIT: 0 (ok)",
        ]);
        expect(client.__multi.exec).toHaveBeenCalled();
        expect(client.get).not.toHaveBeenCalled();
        expect(client.set).not.toHaveBeenCalled();
    });

    it("expires the log and its record together, in one transaction", async () => {
        // Separate commands would let a crash between them strand a log key
        // with no TTL, and renewing only the log would let a long sync 404 on
        // its record while still writing to the log.
        const { connectRedis, appendLog, client } = await loadRedis();

        await connectRedis();
        await appendLog("job-1", "line");

        expect(client.__multi.expire).toHaveBeenCalledWith("job-1:log", 900);
        expect(client.__multi.expire).toHaveBeenCalledWith("job-1", 900);
        expect(client.expire).not.toHaveBeenCalled();
    });

    it("does not issue an empty rPush", async () => {
        // rPush rejects a zero-length value list, which would turn a no-op
        // completion with no summary lines into a failed job.
        const { connectRedis, appendLog, client } = await loadRedis();

        await connectRedis();
        await appendLog("job-1");

        expect(client.__multi.rPush).not.toHaveBeenCalled();
    });

    it("reads the whole log back in order", async () => {
        const { connectRedis, getLog, client } = await loadRedis();

        await connectRedis();
        client.lRange.mockResolvedValueOnce(["a", "b"]);

        await expect(getLog("job-1")).resolves.toEqual(["a", "b"]);
        expect(client.lRange).toHaveBeenCalledWith("job-1:log", 0, -1);
    });

    it("keeps the log key separate from the record key", async () => {
        // Same id, two keys: a log write must never clobber the record.
        const { connectRedis, setSyncRecord, appendLog, client } =
            await loadRedis();

        await connectRedis();
        await setSyncRecord("job-1", { status: "IN_PROGRESS" });
        await appendLog("job-1", "line");

        expect(client.__multi.set).toHaveBeenCalledWith(
            "job-1",
            expect.any(String),
            expect.anything(),
        );
        expect(client.__multi.rPush).toHaveBeenCalledWith("job-1:log", [
            "line",
        ]);
    });

    it("quits the client", async () => {
        const { connectRedis, quitRedis, client } = await loadRedis();

        await connectRedis();
        await quitRedis();

        expect(client.quit).toHaveBeenCalled();
    });
});
