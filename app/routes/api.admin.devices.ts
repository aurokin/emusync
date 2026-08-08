import { getRawDevices, addDevice } from "~/server/database";
import {
    REQUIRED_DEVICE_FIELDS,
    isMissingRequired,
    normalizePort,
} from "~/server/types";

// GET /api/admin/devices - Returns all devices (full config)
export async function loader() {
    const devices = await getRawDevices();
    return Response.json(devices);
}

// POST /api/admin/devices - Add a new device
export async function action({ request }: { request: Request }) {
    if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const device = (await request.json()) as Record<string, unknown>;

    for (const field of REQUIRED_DEVICE_FIELDS) {
        if (isMissingRequired(device[field])) {
            return Response.json(
                { error: `Missing required field: ${field}` },
                { status: 400 },
            );
        }
    }

    const port = normalizePort(device.port);
    if (port === null) {
        return Response.json(
            { error: "Port must be a whole number between 1 and 65535" },
            { status: 400 },
        );
    }

    const result = await addDevice({ ...device, port });

    if (!result.success) {
        return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({ success: true }, { status: 201 });
}
