import type { LoaderFunctionArgs } from "react-router";
import type { DeviceSyncResponse, StoredSyncRecord } from "~/server/types";
import { initializeServer } from "~/server";
import { getJSON, getLog } from "~/server/redis";

// GET /api/device-sync/:id - Polls sync job status
export async function loader({ params }: LoaderFunctionArgs) {
    await initializeServer();

    const id = params.id;
    if (!id) {
        return Response.json({ error: "Missing id param" }, { status: 400 });
    }

    try {
        // The legacy `output` is what the pre-migration writer stored inline.
        const record = await getJSON<StoredSyncRecord & { output?: string[] }>(
            id,
        );
        if (!record) {
            return Response.json(
                { error: `Record '${id}' not found` },
                { status: 404 },
            );
        }
        // The log is a separate LIST key; the record on its own has no output.
        //
        // The fallback covers exactly one deploy: records written by the
        // previous version carry their lines inside the JSON and have no list,
        // so without it every job from the last TTL window would come back
        // with an empty log. Safe to delete once no pre-migration record can
        // still be alive.
        const log = await getLog(id);
        const output = log.length > 0 ? log : (record.output ?? []);
        const response: DeviceSyncResponse = {
            id,
            deviceSyncRecord: { ...record, output },
        };
        return Response.json(response);
    } catch (err) {
        console.error("Failed to retrieve record:", err);
        return Response.json(
            { error: "Failed to retrieve record" },
            { status: 500 },
        );
    }
}
