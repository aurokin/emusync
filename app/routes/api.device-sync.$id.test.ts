import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredSyncRecord } from "~/server/types";
import { SyncStatus } from "~/server/types";
import { loader } from "./api.device-sync.$id";
import { initializeServer } from "~/server";
import { getJSON, getLog } from "~/server/redis";

vi.mock("~/server", () => ({
    initializeServer: vi.fn(),
}));

vi.mock("~/server/redis", () => ({
    getJSON: vi.fn(),
    getLog: vi.fn(),
}));

const initializeServerMock = vi.mocked(initializeServer);
const getJSONMock = vi.mocked(getJSON);
const getLogMock = vi.mocked(getLog);

const callLoader = (id?: string) =>
    loader({ params: { id } } as unknown as Parameters<typeof loader>[0]);

describe("api.device-sync.$id loader", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        initializeServerMock.mockResolvedValue(undefined);
        getJSONMock.mockResolvedValue(null);
        getLogMock.mockResolvedValue([]);
    });

    it("requires id param", async () => {
        const response = await callLoader(undefined);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain("Missing id");
    });

    it("returns 404 when record missing", async () => {
        const response = await callLoader("job-1");

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error).toContain("not found");
    });

    it("stitches the log list onto the stored record", async () => {
        // The record in Redis has no output field at all; the log is a
        // separate LIST key and the loader is what joins them.
        const record: StoredSyncRecord = {
            deviceSyncRequest: {
                deviceName: "Alpha",
                emulatorActions: [],
            },
            status: SyncStatus.COMPLETE,
        };
        getJSONMock.mockResolvedValue(record);
        getLogMock.mockResolvedValue(["CMD: ls", "EXIT: 0 (ok)"]);

        const response = await callLoader("job-1");

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.deviceSyncRecord).toEqual({
            ...record,
            output: ["CMD: ls", "EXIT: 0 (ok)"],
        });
        expect(getLogMock).toHaveBeenCalledWith("job-1");
    });

    it("falls back to a pre-migration record's inline output", async () => {
        // Records written before the log moved to a LIST carry their lines in
        // the JSON and have no list key. Without this they would poll back
        // empty for the rest of their TTL after the deploy.
        getJSONMock.mockResolvedValue({
            deviceSyncRequest: { deviceName: "Alpha", emulatorActions: [] },
            status: SyncStatus.COMPLETE,
            output: ["legacy line"],
        });
        getLogMock.mockResolvedValue([]);

        const response = await callLoader("job-1");

        const body = await response.json();
        expect(body.deviceSyncRecord.output).toEqual(["legacy line"]);
    });

    it("prefers the list over a stale inline output", async () => {
        getJSONMock.mockResolvedValue({
            deviceSyncRequest: { deviceName: "Alpha", emulatorActions: [] },
            status: SyncStatus.COMPLETE,
            output: ["stale"],
        });
        getLogMock.mockResolvedValue(["fresh"]);

        const response = await callLoader("job-1");

        const body = await response.json();
        expect(body.deviceSyncRecord.output).toEqual(["fresh"]);
    });

    it("handles redis errors", async () => {
        getJSONMock.mockRejectedValue(new Error("boom"));

        const response = await callLoader("job-1");

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.error).toContain("Failed to retrieve record");
    });
});
