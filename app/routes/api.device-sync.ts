import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import type {
    DeviceSyncRecord,
    DeviceSyncResponse,
    EmulatorActionEntry,
    StoredSyncRecord,
} from "~/server/types";
import { Emulator, SyncAction, SyncStatus } from "~/server/types";
import { initializeServer, getServerState } from "~/server";
import { connectionTest } from "~/server/backup";
import { runDeviceSync } from "~/server/actions";
import { setSyncRecord, getJSON, appendLog } from "~/server/redis";
import {
    tryAcquireSyncSlot,
    releaseSyncSlot,
    currentSyncJobId,
} from "~/server/sync_lock";

// The job status is the thing that matters; losing a log line to a Redis blip
// must never change it, nor stop it from being written.
const logQuietly = async (id: string, ...lines: string[]) => {
    try {
        await appendLog(id, ...lines);
    } catch (e) {
        console.error("Failed to append sync log lines:", e);
    }
};

interface DeviceSyncRequestBody {
    deviceName: string;
    emulatorActions: EmulatorActionEntry[];
}

// POST /api/device-sync - Initiates async sync job
export async function action({ request }: ActionFunctionArgs) {
    await initializeServer();

    const body = (await request.json()) as DeviceSyncRequestBody;

    if (!body || !body.deviceName) {
        return Response.json({ error: "Missing deviceName" }, { status: 400 });
    }

    if (!Array.isArray(body.emulatorActions)) {
        return Response.json(
            {
                error: "Missing emulatorActions (array of { emulator, action })",
            },
            { status: 400 },
        );
    }
    if (body.emulatorActions.length === 0) {
        return Response.json(
            { error: "emulatorActions must include at least one entry" },
            { status: 400 },
        );
    }

    const validActions = Object.values(SyncAction);
    const validEmulators = Object.values(Emulator);

    const actions = body.emulatorActions as EmulatorActionEntry[];
    for (const entry of actions) {
        const { emulator, action } = entry ?? ({} as EmulatorActionEntry);
        if (!validEmulators.includes(emulator as Emulator)) {
            return Response.json(
                {
                    error: `Invalid emulator '${emulator}'. Must be one of: ${validEmulators.join(", ")}`,
                },
                { status: 400 },
            );
        }
        if (!validActions.includes(action as SyncAction)) {
            return Response.json(
                {
                    error: `Invalid action '${action}' for emulator '${emulator}'. Must be one of: ${validActions.join(", ")}`,
                },
                { status: 400 },
            );
        }
    }

    // One config snapshot for the whole request: reading devices and server
    // paths separately could straddle an admin edit and mix two versions.
    const { devices: emuDevices, serverInfo: emuServer } =
        await getServerState();
    const device = emuDevices.find((d) => d.name === body.deviceName);
    if (!device) {
        return Response.json(
            { error: `Device '${body.deviceName}' not found` },
            { status: 404 },
        );
    }

    // Generate a job id
    const id = randomUUID();

    // Run connection test
    const canConnect = await connectionTest(device);

    if (!canConnect) {
        const failedRecord: DeviceSyncRecord = {
            deviceSyncRequest: {
                deviceName: body.deviceName,
                emulatorActions: actions,
            },
            status: SyncStatus.FAILED,
            output: ["Connection test failed"],
        };
        const response: DeviceSyncResponse = {
            id,
            deviceSyncRecord: failedRecord,
        };
        return Response.json(response);
    }

    const inProgressRecord: DeviceSyncRecord = {
        deviceSyncRequest: {
            deviceName: body.deviceName,
            emulatorActions: actions,
        },
        status: SyncStatus.IN_PROGRESS,
        output: [],
    };
    // Stored without `output`: the log lives in a Redis LIST under `<id>:log`
    // and is stitched back on read. Keeping it in the record meant every
    // append was a read-modify-write that dropped concurrent lines.
    const storedRecord: StoredSyncRecord = {
        deviceSyncRequest: inProgressRecord.deviceSyncRequest,
        status: inProgressRecord.status,
    };

    if (!emuServer) {
        return Response.json(
            { error: "Server info not initialized" },
            { status: 500 },
        );
    }

    // Only one sync at a time: every pull stages through emuServer.workDir and
    // deletes it first, so a second job would pull the staging dir out from
    // under the first, between its target deletion and its move.
    const inFlightJobId = currentSyncJobId();
    if (!tryAcquireSyncSlot(id)) {
        return Response.json(
            {
                error: "A sync is already running. Wait for it to finish.",
                inFlightJobId,
            },
            { status: 409 },
        );
    }

    // Store the record in Redis keyed by the job id. If this fails the job
    // never starts, so release the slot here rather than leaving syncing
    // wedged behind a job that does not exist.
    try {
        await setSyncRecord(id, storedRecord);
    } catch (err) {
        releaseSyncSlot(id);
        console.error("Failed to create sync job record:", err);
        return Response.json(
            { error: "Failed to create sync job" },
            { status: 500 },
        );
    }

    // Kick off the sync job asynchronously; update Redis on completion
    (async () => {
        try {
            const { logs, failures } = await runDeviceSync(
                inProgressRecord.deviceSyncRequest,
                device,
                emuServer,
                { jobId: id },
            );
            // Isolated: a transient Redis error while writing log lines must
            // not fall through to the catch below and record a sync that
            // actually succeeded as FAILED.
            await logQuietly(
                id,
                ...logs,
                ...(failures.length > 0
                    ? [`FAILED: ${failures.join(", ")}`]
                    : []),
            );
            const existing =
                (await getJSON<StoredSyncRecord>(id)) ?? storedRecord;
            await setSyncRecord(id, {
                ...existing,
                status:
                    failures.length > 0
                        ? SyncStatus.FAILED
                        : SyncStatus.COMPLETE,
            });
        } catch (err) {
            await logQuietly(
                id,
                `error:${(err as Error)?.message ?? String(err)}`,
            );
            const existing =
                (await getJSON<StoredSyncRecord>(id)) ?? storedRecord;
            await setSyncRecord(id, {
                ...existing,
                status: SyncStatus.FAILED,
            });
        } finally {
            releaseSyncSlot(id);
        }
    })().catch((e) => console.error("Sync job error:", e));

    const response: DeviceSyncResponse = {
        id,
        deviceSyncRecord: inProgressRecord,
    };
    return Response.json(response);
}
