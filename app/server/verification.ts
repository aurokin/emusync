import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import type { EmuDevice, EmuServer } from "./types";
import { EmuOs } from "./types";
import { getSyncTypeForOs } from "./utility";
import { normalizePort } from "./types";

// Database interface for db.json
interface Database {
    devices: unknown[];
    server: unknown;
}

// Load database from environment-configurable path or default
const loadDatabase = async (): Promise<Database> => {
    const dbPath = process.env.DB_PATH || "./db.json";
    const content = await fs.readFile(dbPath, "utf-8");
    return JSON.parse(content) as Database;
};

const hasBinary = async (binary: string): Promise<boolean> => {
    return new Promise((resolve) => {
        const proc = spawn("bash", ["-c", `command -v ${binary}`]);
        proc.on("error", () => resolve(false));
        proc.on("exit", (code) => resolve(code === 0));
    });
};

const serverHasBinaries = async (binaries: string[]) => {
    const results = await Promise.all(
        binaries.map((binary) => hasBinary(binary)),
    );
    const missing = binaries.filter((_, index) => !results[index]);
    if (missing.length > 0) {
        console.error(`Missing required binaries: ${missing.join(", ")}`);
        return false;
    }
    return true;
};

// Presence is not enough: `"name" in device` is satisfied by undefined, null
// and "", each of which produces a device that renders in the UI and then
// builds nonsense commands. A field must actually hold a usable value.
const hasText = (record: object, key: string): boolean => {
    const value = (record as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim().length > 0;
};

const DEVICE_TEXT_FIELDS = ["name", "ip", "user", "password", "os"];

const isEmuDevice = (device: unknown): device is EmuDevice => {
    if (device === null || typeof device !== "object") return false;
    // normalizePort, not a bare typeof check: the admin form used to store the
    // port verbatim as a string, so existing records hold "22" and rejecting
    // them here would make those devices vanish from the fleet. It also
    // applies the same 1-65535 bound the write endpoints enforce.
    return (
        DEVICE_TEXT_FIELDS.every((field) => hasText(device, field)) &&
        normalizePort((device as Record<string, unknown>).port) !== null
    );
};

// Every one of these reaches fs.access, an rm -rf or an scp target, so a blank
// or missing value has to fail verification rather than travel as "".
export const SERVER_PATH_FIELDS = [
    "cemuSave",
    "azahar",
    "dolphinGC",
    "dolphinWii",
    "mupenFzSave",
    "nethersx2Save",
    "melonds",
    "ppssppSave",
    "ppssppState",
    "retroarchSave",
    "retroarchState",
    "retroarchRgState",
    "rpcs3Save",
    "ryujinxSave",
    "switchSave",
    "vita3kSave",
    "xemuSave",
    "xeniaSave",
    "yuzuSave",
    "workDir",
];

const isEmuServer = (server: unknown): server is EmuServer => {
    if (server === null || typeof server !== "object") return false;
    const missing = SERVER_PATH_FIELDS.filter(
        (field) => !hasText(server, field),
    );
    if (missing.length > 0) {
        console.error(
            `Server config is missing or blank: ${missing.join(", ")}`,
        );
        return false;
    }
    return true;
};

export const parseOs = (os: string): EmuOs => {
    if (typeof os !== "string") {
        return EmuOs.linux;
    }

    if (os === "muos") {
        return EmuOs.muos;
    } else if (os === "android") {
        return EmuOs.android;
    } else if (os === "nx") {
        return EmuOs.nx;
    } else if (os === "windows") {
        return EmuOs.windows;
    }

    return EmuOs.linux;
};

export const verifyDevices = (devices: unknown[]): EmuDevice[] => {
    const verifiedDevices: EmuDevice[] = devices
        .filter(isEmuDevice)
        .map((device) => {
            const os = parseOs(device.os as string);
            return {
                ...device,
                os,
                port: normalizePort(device.port)!,
                syncType: getSyncTypeForOs(os),
            };
        });

    const sortedDevices = verifiedDevices.sort((a, b) => {
        if (a.name > b.name) {
            return 1;
        } else if (a.name < b.name) {
            return -1;
        }

        return 0;
    });
    return sortedDevices;
};

export const verifyServer = (server: unknown): EmuServer | null => {
    if (isEmuServer(server)) {
        return { ...server };
    }
    return null;
};

export const serverHasFolders = async (server: EmuServer) => {
    try {
        // workDir is deliberately absent from this list: every sync deletes
        // and recreates it, so requiring it to pre-exist would fail a
        // perfectly good config on first boot.
        const paths = [
            server.cemuSave,
            server.azahar,
            server.dolphinGC,
            server.dolphinWii,
            server.mupenFzSave,
            server.nethersx2Save,
            server.melonds,
            server.ppssppSave,
            server.ppssppState,
            server.retroarchSave,
            server.retroarchState,
            server.retroarchRgState,
            server.rpcs3Save,
            server.ryujinxSave,
            server.switchSave,
            server.vita3kSave,
            server.xemuSave,
            server.xeniaSave,
            server.yuzuSave,
        ];
        await Promise.all(paths.map((p) => fs.access(p)));
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
};

export const parseInfo = async () => {
    const database = await loadDatabase();
    const devices: EmuDevice[] = verifyDevices(database.devices);
    const serverInfo: EmuServer | null = verifyServer(database.server);
    return { devices, serverInfo };
};

export const shouldLaunch = async (serverInfo: EmuServer) => {
    const [foldersOk, binariesOk] = await Promise.all([
        serverHasFolders(serverInfo),
        serverHasBinaries(["zip", "unzip"]),
    ]);
    return foldersOk && binariesOk;
};
