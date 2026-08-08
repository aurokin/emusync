import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmuServer } from "./types";
import { EmuOs, SyncType } from "./types";
import {
    SERVER_PATH_FIELDS,
    parseInfo,
    parseOs,
    serverHasFolders,
    shouldLaunch,
    verifyDevices,
    verifyServer,
} from "./verification";

type DeviceInput = {
    name: string;
    ip: string;
    port: number;
    user: string;
    password: string;
    os: string;
};

const fsMocks = vi.hoisted(() => ({
    readFile: vi.fn(),
    access: vi.fn(),
}));

const spawnMocks = vi.hoisted(() => ({
    spawn: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
    default: {
        readFile: fsMocks.readFile,
        access: fsMocks.access,
    },
    readFile: fsMocks.readFile,
    access: fsMocks.access,
}));

vi.mock("node:child_process", () => ({
    spawn: spawnMocks.spawn,
    default: {
        spawn: spawnMocks.spawn,
    },
}));

const buildDeviceInput = (
    overrides: Partial<DeviceInput> = {},
): DeviceInput => ({
    name: "Alpha",
    ip: "192.168.1.10",
    port: 22,
    user: "emu",
    password: "sync",
    os: "linux",
    ...overrides,
});

const buildServer = (overrides: Partial<EmuServer> = {}): EmuServer => ({
    cemuSave: "/srv/cemu",
    azahar: "/srv/azahar",
    dolphinGC: "/srv/dolphin/GC",
    dolphinWii: "/srv/dolphin/Wii",
    nethersx2Save: "/srv/nethersx2",
    melonds: "/srv/melonds",
    mupenFzSave: "/srv/mupen",
    ppssppSave: "/srv/ppsspp",
    ppssppState: "/srv/ppsspp/state",
    retroarchSave: "/srv/retroarch",
    retroarchState: "/srv/retroarch/state",
    retroarchRgState: "/srv/retroarch/rg",
    rpcs3Save: "/srv/rpcs3",
    ryujinxSave: "/srv/ryujinx",
    switchSave: "/srv/switch",
    vita3kSave: "/srv/vita3k",
    xemuSave: "/srv/xemu",
    xeniaSave: "/srv/xenia",
    yuzuSave: "/srv/yuzu",
    workDir: "/srv/work",
    ...overrides,
});

const mockSpawnExit = (code: number) => {
    spawnMocks.spawn.mockImplementation(() => {
        const emitter = new EventEmitter();
        setTimeout(() => emitter.emit("exit", code), 0);
        return emitter as unknown as {
            on: (event: string, cb: (...args: unknown[]) => void) => void;
        };
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.access.mockResolvedValue(undefined);
    mockSpawnExit(0);
});

describe("parseOs", () => {
    it("maps known OS strings", () => {
        expect(parseOs("android")).toBe(EmuOs.android);
        expect(parseOs("muos")).toBe(EmuOs.muos);
        expect(parseOs("nx")).toBe(EmuOs.nx);
        expect(parseOs("windows")).toBe(EmuOs.windows);
    });

    it("defaults to linux for unknown values", () => {
        expect(parseOs("unknown")).toBe(EmuOs.linux);
    });
});

describe("verifyDevices", () => {
    it("filters, sorts, and enriches devices", () => {
        const devices: unknown[] = [
            buildDeviceInput({ name: "Beta", os: "nx" }),
            { name: "Invalid" },
            buildDeviceInput({ name: "Alpha", os: "android" }),
        ];

        const result = verifyDevices(devices);

        expect(result.map((device) => device.name)).toEqual(["Alpha", "Beta"]);
        expect(result[0].os).toBe(EmuOs.android);
        expect(result[0].syncType).toBe(SyncType.ssh);
        expect(result[1].os).toBe(EmuOs.nx);
        expect(result[1].syncType).toBe(SyncType.ftp);
    });

    it.each(["name", "ip", "user", "password", "os"])(
        "rejects a device whose %s is blank",
        (field) => {
            // Presence alone used to be enough, so "" produced a device that
            // rendered in the UI and built malformed ssh commands.
            const blank = { ...buildDeviceInput(), [field]: "   " };
            expect(verifyDevices([blank])).toEqual([]);

            const missing: Record<string, unknown> = { ...buildDeviceInput() };
            delete missing[field];
            expect(verifyDevices([missing])).toEqual([]);
        },
    );

    it.each([
        ["a fractional port", 22.5],
        ["a zero port", 0],
        ["a port above the valid range", 70000],
        ["a non-numeric port", "ssh"],
    ])("rejects a device with %s", (_label, port) => {
        expect(verifyDevices([{ ...buildDeviceInput(), port }])).toEqual([]);
    });

    it("accepts and normalizes a port stored as a string", () => {
        // The admin form used to save the port verbatim, so existing records
        // hold "22". Rejecting those would delete devices from the fleet on
        // deploy rather than repair them.
        const [device] = verifyDevices([{ ...buildDeviceInput(), port: "22" }]);

        expect(device.port).toBe(22);
    });
});

describe("verifyServer", () => {
    it("accepts a fully populated config", () => {
        const serverInfo = buildServer();
        expect(verifyServer(serverInfo)).toEqual(serverInfo);
    });

    it("requires exactly the documented set of server fields", () => {
        // Spelled out rather than derived: iterating SERVER_PATH_FIELDS below
        // cannot catch a field being dropped from that list.
        expect([...SERVER_PATH_FIELDS].sort()).toEqual(
            [
                "azahar",
                "cemuSave",
                "dolphinGC",
                "dolphinWii",
                "melonds",
                "mupenFzSave",
                "nethersx2Save",
                "ppssppSave",
                "ppssppState",
                "retroarchRgState",
                "retroarchSave",
                "retroarchState",
                "rpcs3Save",
                "ryujinxSave",
                "switchSave",
                "vita3kSave",
                "workDir",
                "xemuSave",
                "xeniaSave",
                "yuzuSave",
            ].sort(),
        );
    });

    it.each(SERVER_PATH_FIELDS)(
        "rejects a config whose %s is blank or missing",
        (field) => {
            // Each of these reaches fs.access, an rm -rf or an scp target.
            expect(verifyServer({ ...buildServer(), [field]: "" })).toBeNull();

            const missing: Record<string, unknown> = { ...buildServer() };
            delete missing[field];
            expect(verifyServer(missing)).toBeNull();
        },
    );
});

describe("server verification", () => {
    it("confirms server folders", async () => {
        const serverInfo = buildServer();
        fsMocks.access.mockResolvedValue(undefined);

        await expect(serverHasFolders(serverInfo)).resolves.toBe(true);
    });

    it("fails when folders are missing", async () => {
        const serverInfo = buildServer();
        fsMocks.access.mockRejectedValue(new Error("missing"));

        await expect(serverHasFolders(serverInfo)).resolves.toBe(false);
    });

    it("parses device and server info", async () => {
        const serverInfo = buildServer();
        fsMocks.readFile.mockResolvedValue(
            JSON.stringify({
                devices: [buildDeviceInput({ os: "android" })],
                server: serverInfo,
            }),
        );

        const result = await parseInfo();

        expect(result.devices).toHaveLength(1);
        expect(result.devices[0].syncType).toBe(SyncType.ssh);
        expect(result.serverInfo).toEqual(serverInfo);
    });

    it("reports launch readiness", async () => {
        const serverInfo = buildServer();
        mockSpawnExit(0);

        await expect(shouldLaunch(serverInfo)).resolves.toBe(true);
    });

    it("fails launch readiness when binaries missing", async () => {
        const serverInfo = buildServer();
        mockSpawnExit(1);

        await expect(shouldLaunch(serverInfo)).resolves.toBe(false);
    });
});
