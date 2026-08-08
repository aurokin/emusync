import { getServerConfig, updateServerConfig } from "~/server/database";
import type { EmuServer } from "~/server/types";

// GET /api/admin - Returns current server configuration
export async function loader() {
    const serverConfig = await getServerConfig();
    if (!serverConfig) {
        return Response.json(
            { error: "Server config not found" },
            { status: 404 },
        );
    }
    return Response.json(serverConfig);
}

// PUT /api/admin - Updates server configuration
export async function action({ request }: { request: Request }) {
    if (request.method !== "PUT") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const updates = (await request.json()) as Partial<EmuServer>;
    const updatedConfig = await updateServerConfig(updates);

    if (!updatedConfig) {
        // Rejected, not failed: the update would have left a path blank, and
        // the stored config is untouched.
        return Response.json(
            {
                error: "Every server path must be set — the change was not saved",
            },
            { status: 400 },
        );
    }

    return Response.json(updatedConfig);
}
