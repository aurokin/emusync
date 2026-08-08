import fs from "node:fs/promises";
import type { EmuDevice, EmuServer } from "./types";
import { verifyDevices, verifyServer } from "./verification";

// Every mutation below is read-modify-write against one file. Without a queue
// two concurrent admin saves both read the old contents and the second one
// silently discards the first one's change.
let writeQueue: Promise<unknown> = Promise.resolve();
const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const run = writeQueue.then(work, work);
    writeQueue = run.catch(() => undefined);
    return run;
};

// A blank field means "not configured", not "configured as an empty string":
// "" passes an `in` check and a truthiness check differently in different
// places, so it is removed rather than stored.
const isBlank = (v: unknown) => typeof v === "string" && v.trim() === "";

const dropBlanks = (record: Record<string, unknown>) =>
    Object.fromEntries(
        Object.entries(record).filter(([, v]) => !isBlank(v)),
    ) as Record<string, unknown>;

// For an update, a blank value is an instruction to unset the field: merging
// it in would leave the old path in place, so the key is deleted instead.
const applyUpdates = (
    existing: Record<string, unknown>,
    updates: Record<string, unknown>,
): Record<string, unknown> => {
    const merged = { ...existing, ...dropBlanks(updates) };
    for (const [key, value] of Object.entries(updates)) {
        if (isBlank(value)) delete merged[key];
    }
    return merged;
};

// Database structure matching db.json
interface Database {
    devices: Record<string, unknown>[];
    server: Record<string, unknown>;
}

// Get database path from environment or default
const getDbPath = (): string => {
    return process.env.DB_PATH || "./db.json";
};

// Load database from file
export const loadDatabase = async (): Promise<Database> => {
    const dbPath = getDbPath();
    const content = await fs.readFile(dbPath, "utf-8");
    return JSON.parse(content) as Database;
};

// Save database to file with atomic write
export const saveDatabase = async (data: Database): Promise<void> => {
    const dbPath = getDbPath();
    // A fixed temp name is safe because every caller goes through serialize():
    // there is never a second write in flight to collide with it.
    const tempPath = `${dbPath}.tmp`;

    // Write to temp file first
    await fs.writeFile(tempPath, JSON.stringify(data, null, 4), "utf-8");

    // Rename atomically
    await fs.rename(tempPath, dbPath);
};

// Get current server configuration
export const getServerConfig = async (): Promise<EmuServer | null> => {
    const db = await loadDatabase();
    return verifyServer(db.server);
};

// Update server configuration
export const updateServerConfig = async (
    updates: Partial<EmuServer>,
): Promise<EmuServer | null> =>
    serialize(async () => {
        const db = await loadDatabase();
        const candidate = applyUpdates(
            db.server,
            updates as Record<string, unknown>,
        );
        // Verify before writing. verifyServer requires every path field, so
        // saving first and checking after would let one blank field in the
        // admin form persist a config the app can no longer load.
        const verified = verifyServer(candidate);
        if (!verified) return null;

        db.server = candidate;
        await saveDatabase(db);
        return verified;
    });

// Get all devices (raw from db.json, before verification transforms)
export const getRawDevices = async (): Promise<Record<string, unknown>[]> => {
    const db = await loadDatabase();
    return db.devices;
};

// Get all devices (verified)
export const getDevices = async (): Promise<EmuDevice[]> => {
    const db = await loadDatabase();
    return verifyDevices(db.devices);
};

// Get a single device by name
export const getDevice = async (
    name: string,
): Promise<Record<string, unknown> | null> => {
    const db = await loadDatabase();
    const device = db.devices.find(
        (d) => (d as { name?: string }).name === name,
    );
    return device || null;
};

// Add a new device
export const addDevice = async (
    device: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> =>
    serialize(async () => {
        const db = await loadDatabase();

        // Check for duplicate name
        const existingIndex = db.devices.findIndex(
            (d) => (d as { name?: string }).name === device.name,
        );
        if (existingIndex !== -1) {
            return {
                success: false,
                error: "Device with this name already exists",
            };
        }

        db.devices.push(dropBlanks(device));
        await saveDatabase(db);
        return { success: true };
    });

// Update an existing device
export const updateDevice = async (
    name: string,
    updates: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> =>
    serialize(async () => {
        const db = await loadDatabase();

        const index = db.devices.findIndex(
            (d) => (d as { name?: string }).name === name,
        );
        if (index === -1) {
            return { success: false, error: "Device not found" };
        }

        // If name is being changed, check for conflicts
        if (updates.name && updates.name !== name) {
            const conflictIndex = db.devices.findIndex(
                (d) => (d as { name?: string }).name === updates.name,
            );
            if (conflictIndex !== -1) {
                return {
                    success: false,
                    error: "A device with that name already exists",
                };
            }
        }

        db.devices[index] = applyUpdates(db.devices[index], updates);
        await saveDatabase(db);
        return { success: true };
    });

// Delete a device
export const deleteDevice = async (
    name: string,
): Promise<{ success: boolean; error?: string }> =>
    serialize(async () => {
        const db = await loadDatabase();

        const index = db.devices.findIndex(
            (d) => (d as { name?: string }).name === name,
        );
        if (index === -1) {
            return { success: false, error: "Device not found" };
        }

        db.devices.splice(index, 1);
        await saveDatabase(db);
        return { success: true };
    });
