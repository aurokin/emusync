import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmuDevice, EmuServer } from "~/server/types";
import { Emulator, SyncAction, SyncStatus } from "~/server/types";
import { action } from "./api.device-sync";
import { initializeServer, getServerState } from "~/server";
import { connectionTest } from "~/server/backup";
import { runDeviceSync } from "~/server/actions";
import { getJSON, setJSON } from "~/server/redis";
import {
    tryAcquireSyncSlot,
    releaseSyncSlot,
    currentSyncJobId,
} from "~/server/sync_lock";

vi.mock("~/server", () => ({
    initializeServer: vi.fn(),
    getServerState: vi.fn(),
}));

vi.mock("~/server/backup", () => ({
    connectionTest: vi.fn(),
}));

vi.mock("~/server/actions", () => ({
    runDeviceSync: vi.fn(),
}));

vi.mock("~/server/redis", () => ({
    setJSON: vi.fn(),
    getJSON: vi.fn(),
}));

vi.mock("~/server/sync_lock", () => ({
    tryAcquireSyncSlot: vi.fn(),
    releaseSyncSlot: vi.fn(),
    currentSyncJobId: vi.fn(),
}));

const randomUUIDMock = vi.hoisted(() => vi.fn(() => "job-1"));

vi.mock("node:crypto", () => ({
    randomUUID: randomUUIDMock,
    default: {
        randomUUID: randomUUIDMock,
    },
}));

const buildRequest = (body: unknown) =>
    new Request("http://localhost/api/device-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

const callAction = (body: unknown) =>
    action({ request: buildRequest(body) } as Parameters<typeof action>[0]);

const device = { name: "Alpha" } as EmuDevice;
const defaultServerInfo = { workDir: "/srv/work" } as EmuServer;

const initializeServerMock = vi.mocked(initializeServer);
const getServerStateMock = vi.mocked(getServerState);
const mockServerState = (
    devices: EmuDevice[] = [device],
    serverInfo: EmuServer | null = defaultServerInfo,
) => getServerStateMock.mockResolvedValue({ devices, serverInfo });
const connectionTestMock = vi.mocked(connectionTest);
const runDeviceSyncMock = vi.mocked(runDeviceSync);
const setJSONMock = vi.mocked(setJSON);
const getJSONMock = vi.mocked(getJSON);
const tryAcquireSyncSlotMock = vi.mocked(tryAcquireSyncSlot);
const releaseSyncSlotMock = vi.mocked(releaseSyncSlot);
const currentSyncJobIdMock = vi.mocked(currentSyncJobId);

// The job runs in a detached async IIFE, so the terminal setJSON lands after
// the action resolves.
const flushSyncJob = () => new Promise((resolve) => setTimeout(resolve, 0));

const lastRecord = () =>
    setJSONMock.mock.calls[setJSONMock.mock.calls.length - 1][1] as {
        status: SyncStatus;
        output: string[];
    };

describe("api.device-sync action", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        initializeServerMock.mockResolvedValue(undefined);
        mockServerState();
        connectionTestMock.mockResolvedValue(true);
        runDeviceSyncMock.mockResolvedValue({ logs: [], failures: [] });
        setJSONMock.mockResolvedValue(undefined);
        getJSONMock.mockResolvedValue(null);
        tryAcquireSyncSlotMock.mockReturnValue(true);
        currentSyncJobIdMock.mockReturnValue(null);
    });

    it("rejects missing deviceName", async () => {
        const response = await callAction({});

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "Missing deviceName",
        });
    });

    it("rejects missing emulatorActions", async () => {
        const response = await callAction({ deviceName: "Alpha" });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain("Missing emulatorActions");
    });

    it("rejects empty emulatorActions", async () => {
        const response = await callAction({
            deviceName: "Alpha",
            emulatorActions: [],
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain("emulatorActions must include");
    });

    it("rejects invalid emulator", async () => {
        const response = await callAction({
            deviceName: "Alpha",
            emulatorActions: [{ emulator: "bad", action: "push" }],
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain("Invalid emulator");
    });

    it("rejects invalid action", async () => {
        const response = await callAction({
            deviceName: "Alpha",
            emulatorActions: [{ emulator: Emulator.cemu, action: "bad" }],
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain("Invalid action");
    });

    it("returns 404 for missing device", async () => {
        mockServerState([]);

        const response = await callAction({
            deviceName: "Missing",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error).toContain("not found");
    });

    it("returns failed record on connection error", async () => {
        connectionTestMock.mockResolvedValue(false);

        const response = await callAction({
            deviceName: "Alpha",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });

        const body = await response.json();
        expect(body.deviceSyncRecord.status).toBe(SyncStatus.FAILED);
        expect(body.deviceSyncRecord.output).toContain(
            "Connection test failed",
        );
    });

    it("returns 500 when server info missing", async () => {
        mockServerState([device], null);

        const response = await callAction({
            deviceName: "Alpha",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.error).toContain("Server info not initialized");
    });

    it("returns in-progress response", async () => {
        const response = await callAction({
            deviceName: "Alpha",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });

        const body = await response.json();
        expect(body.deviceSyncRecord.status).toBe(SyncStatus.IN_PROGRESS);
        expect(setJSONMock).toHaveBeenCalled();
    });

    it("records FAILED when any emulator failed", async () => {
        // The whole point: a sync whose transfers all threw used to be stored
        // COMPLETE, because runDeviceSync returned normally.
        runDeviceSyncMock.mockResolvedValue({
            logs: [`push:${Emulator.cemu}`, `error:${Emulator.cemu}:boom`],
            failures: [Emulator.cemu],
        });

        await callAction({
            deviceName: "Alpha",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });
        await flushSyncJob();

        const record = lastRecord();
        expect(record.status).toBe(SyncStatus.FAILED);
        expect(record.output).toContain(`FAILED: ${Emulator.cemu}`);
    });

    it("records COMPLETE when nothing failed", async () => {
        runDeviceSyncMock.mockResolvedValue({
            logs: [`push:${Emulator.cemu}`],
            failures: [],
        });

        await callAction({
            deviceName: "Alpha",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });
        await flushSyncJob();

        expect(lastRecord().status).toBe(SyncStatus.COMPLETE);
    });

    it("returns 409 instead of starting a second concurrent sync", async () => {
        // Two jobs would share the one server workDir, which each pull deletes
        // as its first command.
        tryAcquireSyncSlotMock.mockReturnValue(false);
        currentSyncJobIdMock.mockReturnValue("job-in-flight");

        const response = await callAction({
            deviceName: "Alpha",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.inFlightJobId).toBe("job-in-flight");
        expect(runDeviceSyncMock).not.toHaveBeenCalled();
    });

    it("releases the sync slot after the job finishes", async () => {
        await callAction({
            deviceName: "Alpha",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });
        await flushSyncJob();

        expect(releaseSyncSlotMock).toHaveBeenCalledWith("job-1");
    });

    it("releases the sync slot when the job record cannot be written", async () => {
        // Otherwise the lock is held with no job running behind it, and every
        // later sync 409s until the lease expires.
        setJSONMock.mockRejectedValueOnce(new Error("redis down"));

        const response = await callAction({
            deviceName: "Alpha",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });

        expect(response.status).toBe(500);
        expect(releaseSyncSlotMock).toHaveBeenCalledWith("job-1");
        expect(runDeviceSyncMock).not.toHaveBeenCalled();
    });

    it("releases the sync slot when the job throws", async () => {
        runDeviceSyncMock.mockRejectedValue(new Error("boom"));

        await callAction({
            deviceName: "Alpha",
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        });
        await flushSyncJob();

        expect(lastRecord().status).toBe(SyncStatus.FAILED);
        expect(releaseSyncSlotMock).toHaveBeenCalledWith("job-1");
    });
});
