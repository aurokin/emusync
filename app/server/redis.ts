import { createClient } from "redis";
import type { RedisClientType } from "redis";

let client: RedisClientType | null = null;

export const connectRedis = async (): Promise<RedisClientType> => {
    if (client && client.isOpen) return client;

    const url = process.env.REDIS_URL || "redis://localhost:6379";
    client = createClient({ url });

    client.on("error", (err: Error) => {
        console.error("Redis Client Error:", err);
    });

    await client.connect();
    return client;
};

export const getRedis = (): RedisClientType => {
    if (!client || !client.isOpen) {
        throw new Error(
            "Redis client not connected. Call connectRedis() first.",
        );
    }
    return client;
};

export const quitRedis = async (): Promise<void> => {
    if (client && client.isOpen) {
        await client.quit();
    }
};

const TTL_SECONDS = 15 * 60; // 15 minutes

// Job logs live in a LIST beside the record, not in a field on it.
//
// They used to be a string[] inside the JSON, appended with a
// get-push-set cycle. Two lines written close together both read the same
// array and the second set overwrote the first, so a sync's log came back
// with CMD: entries whose EXIT: had vanished — observed in production. RPUSH
// is a single atomic append with no read, so concurrent writers cannot lose
// each other's lines.
const logKey = (key: string) => `${key}:log`;

// Writes a job record and renews its log's lifetime in the same transaction.
//
// A plain SET would renew only the record, so the log — last touched by
// whichever append came before — always expired first. A poll landing in that
// gap got a live COMPLETE record with an empty output, which is precisely the
// "where did my log go" symptom this migration exists to remove. The two keys
// are written by different code paths and must not be allowed to drift apart.
export const setSyncRecord = async (key: string, record: unknown) => {
    const c = getRedis();
    await c
        .multi()
        .set(key, JSON.stringify(record), { EX: TTL_SECONDS })
        .expire(logKey(key), TTL_SECONDS)
        .exec();
};

export const appendLog = async (key: string, ...lines: string[]) => {
    if (lines.length === 0) return;
    const c = getRedis();
    const k = logKey(key);
    // One MULTI, not three awaits. Separate commands would let a crash between
    // the push and the expire leave a log key with no TTL at all, which then
    // outlives every other trace of the job.
    //
    // The record's TTL is refreshed here too. The two keys have to age
    // together: renewing only the log would let a sync running longer than the
    // TTL return 404 for its record while its log was still being written to.
    await c
        .multi()
        .rPush(k, lines)
        .expire(k, TTL_SECONDS)
        .expire(key, TTL_SECONDS)
        .exec();
};

export const getLog = async (key: string): Promise<string[]> => {
    const c = getRedis();
    return c.lRange(logKey(key), 0, -1);
};

export const getJSON = async <T = unknown>(key: string): Promise<T | null> => {
    const c = getRedis();
    const raw = await c.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
};
