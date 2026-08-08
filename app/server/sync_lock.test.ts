import { beforeEach, describe, expect, it } from "vitest";
import {
    tryAcquireSyncSlot,
    releaseSyncSlot,
    currentSyncJobId,
} from "./sync_lock";

describe("sync slot", () => {
    beforeEach(() => {
        // Module state persists across tests; clear whatever a test left held.
        const held = currentSyncJobId();
        if (held) releaseSyncSlot(held);
    });

    it("admits one holder and refuses the rest", () => {
        expect(tryAcquireSyncSlot("job-a")).toBe(true);
        expect(tryAcquireSyncSlot("job-b")).toBe(false);
        expect(currentSyncJobId()).toBe("job-a");
    });

    it("frees the slot for the next job on release", () => {
        tryAcquireSyncSlot("job-a");
        releaseSyncSlot("job-a");

        expect(currentSyncJobId()).toBeNull();
        expect(tryAcquireSyncSlot("job-b")).toBe(true);
    });

    it("ignores a release from a job that does not hold the slot", () => {
        // Otherwise a late release from a finished job would unlock the slot
        // out from under the job currently running.
        tryAcquireSyncSlot("job-a");
        releaseSyncSlot("job-stale");

        expect(currentSyncJobId()).toBe("job-a");
        expect(tryAcquireSyncSlot("job-b")).toBe(false);
    });

    it("is atomic against interleaved async callers", async () => {
        // The check-and-set is synchronous, so concurrent requests cannot both
        // observe a free slot. This is the property the whole design rests on.
        const attempts = await Promise.all(
            Array.from({ length: 8 }, async (_, i) => {
                await Promise.resolve();
                return tryAcquireSyncSlot(`job-${i}`);
            }),
        );

        expect(attempts.filter(Boolean)).toHaveLength(1);
    });
});
