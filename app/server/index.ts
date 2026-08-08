import type { SimpleDevice, EmuDevice, EmuServer } from "./types";
import { connectRedis } from "./redis";
import { parseInfo, shouldLaunch } from "./verification";
import { convertEmuDeviceToSimpleDevice } from "./utility";

// One-time startup validation only. Device and server config are deliberately
// NOT cached here — see the getters below.
let initialized = false;
let initPromise: Promise<void> | null = null;

export const initializeServer = async (): Promise<void> => {
    if (initialized) return;

    // Prevent multiple simultaneous initializations
    if (initPromise) {
        await initPromise;
        return;
    }

    initPromise = (async () => {
        try {
            // Initialize Redis and verify connectivity
            await connectRedis();

            const { serverInfo } = await parseInfo();
            if (!serverInfo) {
                throw new Error("Server info is not valid");
            }
            if (!(await shouldLaunch(serverInfo))) {
                throw new Error(
                    "Server does not have the proper information in order to launch",
                );
            }

            initialized = true;
            console.log("Server initialized successfully");
        } catch (err) {
            console.error("Failed to initialize server:", err);
            // Clear the promise so a transient failure (Redis not up yet, a
            // save folder briefly unavailable, db.json mid-write) can be
            // retried. Leaving it set made every later request await the same
            // settled rejection until the service was restarted.
            initPromise = null;
            throw err;
        }
    })();

    await initPromise;
};

// Config is read per request rather than cached at boot. It is one small file
// read for a handful of devices, and caching it meant admin edits were
// confirmed by the UI while every sync kept using the boot-time snapshot.
// One snapshot per request. Callers that need both the device and the server
// paths must use this rather than two separate getters: an admin edit landing
// between the two reads would run a sync with a device from one config version
// and server paths from another.
export const getServerState = async (): Promise<{
    devices: EmuDevice[];
    serverInfo: EmuServer | null;
}> => parseInfo();

export const getEmuDevices = async (): Promise<EmuDevice[]> => {
    const { devices } = await parseInfo();
    return devices;
};

export const getSimpleDevices = async (): Promise<SimpleDevice[]> => {
    const devices = await getEmuDevices();
    return devices.map(convertEmuDeviceToSimpleDevice);
};

export const getEmuServer = async (): Promise<EmuServer | null> => {
    const { serverInfo } = await parseInfo();
    return serverInfo;
};

export const isInitialized = (): boolean => initialized;
