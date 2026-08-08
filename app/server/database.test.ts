import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./database";

// database.ts is the only module that writes db.json, and a bad write costs
// the whole device fleet's configuration. These run against a real temp file
// rather than a mock so the atomic-write path is actually exercised.
//
// Setting DB_PATH in beforeEach (rather than before importing the module) is
// correct: database.ts resolves the path inside getDbPath() on every call, not
// once at module load, so each test is isolated to its own temp file.
let dbDir: string;
let dbPath: string;
const originalDbPath = process.env.DB_PATH;

const seed = async (data: unknown) =>
    fs.writeFile(dbPath, JSON.stringify(data, null, 4), "utf-8");

const read = async () => JSON.parse(await fs.readFile(dbPath, "utf-8"));

const baseServer = {
    cemuSave: "/srv/cemu",
    azahar: "/srv/azahar",
    dolphinGC: "/srv/GC",
    dolphinWii: "/srv/Wii",
    mupenFzSave: "/srv/mupen",
    nethersx2Save: "/srv/nsx2/memcards",
    melonds: "/srv/melonds",
    ppssppSave: "/srv/psp",
    ppssppState: "/srv/psp/state",
    retroarchSave: "/srv/ra/saves",
    retroarchState: "/srv/ra/states",
    retroarchRgState: "/srv/ra/rg",
    rpcs3Save: "/srv/rpcs3",
    ryujinxSave: "/srv/ryujinx",
    switchSave: "/srv/switch",
    vita3kSave: "/srv/vita3k",
    xemuSave: "/srv/xemu",
    xeniaSave: "/srv/xenia",
    yuzuSave: "/srv/yuzu",
    workDir: "/srv/work",
};

beforeEach(async () => {
    dbDir = await fs.mkdtemp(path.join(os.tmpdir(), "emusync-db-"));
    dbPath = path.join(dbDir, "db.json");
    process.env.DB_PATH = dbPath;
    await seed({
        devices: [
            { name: "herb", ip: "herb.home.arpa", port: 22, os: "linux" },
            { name: "haste", ip: "haste.home.arpa", port: 22, os: "windows" },
        ],
        server: baseServer,
    });
});

afterEach(async () => {
    if (originalDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = originalDbPath;
    await fs.rm(dbDir, { recursive: true, force: true });
});

describe("devices", () => {
    it("adds a device and leaves the existing ones intact", async () => {
        expect(await db.addDevice({ name: "odin", os: "android" })).toEqual({
            success: true,
        });

        const saved = await read();
        expect(saved.devices.map((d: { name: string }) => d.name)).toEqual([
            "herb",
            "haste",
            "odin",
        ]);
        expect(saved.server).toEqual(baseServer);
    });

    it("refuses a duplicate name without writing", async () => {
        const before = await read();

        expect(await db.addDevice({ name: "herb", os: "linux" })).toEqual({
            success: false,
            error: "Device with this name already exists",
        });
        expect(await read()).toEqual(before);
    });

    it("merges updates rather than replacing the device", async () => {
        expect(await db.updateDevice("herb", { port: 2222 })).toEqual({
            success: true,
        });

        const saved = await read();
        const herb = saved.devices.find(
            (d: { name: string }) => d.name === "herb",
        );
        expect(herb).toEqual({
            name: "herb",
            ip: "herb.home.arpa",
            port: 2222,
            os: "linux",
        });
    });

    it("refuses to rename a device onto an existing name", async () => {
        const before = await read();

        expect(await db.updateDevice("herb", { name: "haste" })).toEqual({
            success: false,
            error: "A device with that name already exists",
        });
        expect(await read()).toEqual(before);
    });

    it("allows a rename to an unused name", async () => {
        expect(await db.updateDevice("herb", { name: "herb2" })).toEqual({
            success: true,
        });

        const saved = await read();
        expect(saved.devices.map((d: { name: string }) => d.name)).toEqual([
            "herb2",
            "haste",
        ]);
    });

    it("reports a missing device on update and delete", async () => {
        expect(await db.updateDevice("ghost", { port: 1 })).toEqual({
            success: false,
            error: "Device not found",
        });
        expect(await db.deleteDevice("ghost")).toEqual({
            success: false,
            error: "Device not found",
        });
    });

    it("deletes only the named device", async () => {
        expect(await db.deleteDevice("herb")).toEqual({ success: true });

        const saved = await read();
        expect(saved.devices.map((d: { name: string }) => d.name)).toEqual([
            "haste",
        ]);
    });

    it("returns null for an unknown device lookup", async () => {
        expect(await db.getDevice("ghost")).toBeNull();
        expect(await db.getDevice("herb")).toMatchObject({ name: "herb" });
    });
});

describe("server config", () => {
    it("merges updates and leaves untouched fields alone", async () => {
        const result = await db.updateServerConfig({ workDir: "/srv/work2" });

        expect(result?.workDir).toBe("/srv/work2");
        const saved = await read();
        expect(saved.server).toEqual({ ...baseServer, workDir: "/srv/work2" });
    });

    it("reads back the stored config", async () => {
        expect(await db.getServerConfig()).toEqual(baseServer);
    });
});

describe("saveDatabase", () => {
    it("leaves no temp file behind", async () => {
        await db.addDevice({ name: "odin", os: "android" });

        expect(await fs.readdir(dbDir)).toEqual(["db.json"]);
    });

    it("writes the committed file complete and parseable", async () => {
        await db.addDevice({ name: "odin", os: "android" });

        const raw = await fs.readFile(dbPath, "utf-8");
        expect(() => JSON.parse(raw)).not.toThrow();
        expect(JSON.parse(raw).devices).toHaveLength(3);
    });

    it("commits by renaming a temp file, never writing db.json in place", async () => {
        // This is the assertion that actually pins atomicity. Reading the file
        // after the write completes cannot distinguish an atomic commit from a
        // direct in-place write; asserting the mechanism can. A reader must
        // only ever see the old file or the new one.
        const writeSpy = vi.spyOn(fs, "writeFile");
        const renameSpy = vi.spyOn(fs, "rename");

        await db.addDevice({ name: "odin", os: "android" });

        const written = writeSpy.mock.calls.map(([target]) => target);
        expect(written).not.toContain(dbPath);
        expect(written).toHaveLength(1);
        expect(renameSpy).toHaveBeenCalledWith(written[0], dbPath);

        writeSpy.mockRestore();
        renameSpy.mockRestore();
    });
});
