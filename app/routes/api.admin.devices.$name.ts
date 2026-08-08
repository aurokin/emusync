import { getDevice, updateDevice, deleteDevice } from "~/server/database";
import {
    REQUIRED_DEVICE_FIELDS,
    isMissingRequired,
    normalizePort,
} from "~/server/types";

type RouteParams = {
    params: {
        name: string;
    };
};

// GET /api/admin/devices/:name - Returns a single device
export async function loader({ params }: RouteParams) {
    const device = await getDevice(params.name);
    if (!device) {
        return Response.json({ error: "Device not found" }, { status: 404 });
    }
    return Response.json(device);
}

// PUT/DELETE /api/admin/devices/:name - Update or delete a device
export async function action({
    request,
    params,
}: { request: Request } & RouteParams) {
    const { name } = params;

    if (request.method === "PUT") {
        const updates = (await request.json()) as Record<string, unknown>;

        // A blank value unsets a field, which is fine for an emulator path and
        // fatal for these: the device would still be listed and every command
        // built for it would be malformed.
        for (const field of REQUIRED_DEVICE_FIELDS) {
            if (field in updates && isMissingRequired(updates[field])) {
                return Response.json(
                    { error: `Missing required field: ${field}` },
                    { status: 400 },
                );
            }
        }

        if ("port" in updates) {
            const port = normalizePort(updates.port);
            if (port === null) {
                return Response.json(
                    {
                        error: "Port must be a whole number between 1 and 65535",
                    },
                    { status: 400 },
                );
            }
            updates.port = port;
        }

        const result = await updateDevice(name, updates);

        if (!result.success) {
            return Response.json({ error: result.error }, { status: 400 });
        }

        return Response.json({ success: true });
    }

    if (request.method === "DELETE") {
        const result = await deleteDevice(name);

        if (!result.success) {
            return Response.json({ error: result.error }, { status: 404 });
        }

        return Response.json({ success: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
}
