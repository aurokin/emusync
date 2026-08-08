import type { Stats } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmuDevice, EmuServer } from "./types";
import { EmuOs, Emulator, SyncAction, SyncType } from "./types";

const backupMocks = vi.hoisted(() => ({
    buildScpCommand: vi.fn(),
    buildSshCommand: vi.fn(),
    createCmd: vi.fn(),
    pushPairs: vi.fn(),
    pullPairs: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
    stat: vi.fn(),
    readdir: vi.fn(),
}));

vi.mock("./backup", () => ({
    buildScpCommand: backupMocks.buildScpCommand,
    buildSshCommand: backupMocks.buildSshCommand,
    createCmd: backupMocks.createCmd,
    pushPairs: backupMocks.pushPairs,
    pullPairs: backupMocks.pullPairs,
}));

vi.mock("node:fs/promises", () => ({
    default: {
        stat: fsMocks.stat,
        readdir: fsMocks.readdir,
    },
    stat: fsMocks.stat,
    readdir: fsMocks.readdir,
}));

import * as actions from "./actions";

const buildDevice = (overrides: Partial<EmuDevice> = {}): EmuDevice => ({
    name: "Android",
    ip: "10.0.0.50",
    port: 22,
    user: "emu",
    password: "secret",
    os: EmuOs.android,
    syncType: SyncType.ssh,
    cemuSave: undefined,
    azahar: undefined,
    dolphinDroidDump: "/sdcard/dolphin",
    dolphinGC: undefined,
    dolphinWii: undefined,
    mupenFzSave: undefined,
    nethersx2Save: undefined,
    melonds: undefined,
    pcsx2Save: undefined,
    ppssppSave: undefined,
    ppssppState: undefined,
    retroarchSave: undefined,
    retroarchState: undefined,
    rpcs3Save: undefined,
    ryujinxSave: undefined,
    switchSave: undefined,
    vita3kSave: undefined,
    xemuSave: undefined,
    xeniaSave: undefined,
    yuzuDroid: undefined,
    yuzuDroidDump: undefined,
    yuzuSave: undefined,
    workDir: "/sdcard/work",
    ...overrides,
});

const buildServer = (overrides: Partial<EmuServer> = {}): EmuServer => ({
    cemuSave: "/srv/cemu",
    azahar: "/srv/azahar",
    dolphinGC: "/srv/dolphin/GC",
    dolphinWii: "/srv/dolphin/Wii",
    nethersx2Save: "/srv/nethersx2",
    mupenFzSave: "/srv/mupen",
    ppssppSave: "/srv/ppsspp",
    ppssppState: "/srv/ppsspp/state",
    melonds: "/srv/melonds",
    retroarchSave: "/srv/retroarch",
    retroarchState: "/srv/retroarch/states",
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

beforeEach(() => {
    vi.clearAllMocks();
    backupMocks.createCmd.mockResolvedValue(0);
    backupMocks.buildSshCommand.mockImplementation(
        (_device, cmd) => `ssh:${cmd}`,
    );
    backupMocks.buildScpCommand.mockImplementation(
        (_device, source, target, push) =>
            `scp:${source}:${target}:${push ? "push" : "pull"}`,
    );
    fsMocks.stat.mockResolvedValue({ isDirectory: () => true } as Stats);
    fsMocks.readdir.mockResolvedValue([]);
});

describe("dolphin android push", () => {
    it("fails when baseline zip is missing", async () => {
        backupMocks.createCmd.mockImplementation((cmd: string) => {
            if (cmd.includes("missing dolphin zip")) {
                return Promise.reject(new Error("missing dolphin zip"));
            }
            return Promise.resolve(0);
        });

        const device = buildDevice();
        const serverInfo = buildServer();

        await expect(
            actions.push(device, Emulator.dolphin, serverInfo),
        ).rejects.toThrow("missing dolphin zip");

        const commands = backupMocks.createCmd.mock.calls.map(([cmd]) => cmd);
        expect(commands.some((cmd) => cmd.includes("dolphin-emu.zip"))).toBe(
            true,
        );
    });

    it("rebuilds export zip from baseline", async () => {
        const device = buildDevice();
        const serverInfo = buildServer();
        const extractDir = path.posix.join(serverInfo.workDir, "dolphin_emu");
        const baseZipPath = path.posix.join(
            serverInfo.workDir,
            "dolphin-emu.zip",
        );
        const exportZipPath = path.posix.join(
            serverInfo.workDir,
            "dolphin-export.zip",
        );

        await actions.push(device, Emulator.dolphin, serverInfo);

        expect(backupMocks.buildScpCommand).toHaveBeenCalledWith(
            device,
            `${device.dolphinDroidDump}/dolphin-emu.zip`,
            baseZipPath,
            false,
        );
        expect(backupMocks.buildScpCommand).toHaveBeenCalledWith(
            device,
            exportZipPath,
            `${device.dolphinDroidDump}/dolphin-export.zip`,
            true,
        );

        const commands = backupMocks.createCmd.mock.calls.map(([cmd]) => cmd);
        expect(commands).toContain(
            `unzip -o "${baseZipPath}" -d "${extractDir}"`,
        );
        expect(commands).toContain(
            `rm -rf "${extractDir}/GC" "${extractDir}/Wii"`,
        );
        expect(commands).toContain(
            `cd "${extractDir}" && zip -r "${exportZipPath}" .`,
        );
    });

    it("writes updated data into nested dolphin root", async () => {
        const device = buildDevice();
        const serverInfo = buildServer();
        const extractDir = path.posix.join(serverInfo.workDir, "dolphin_emu");
        const nestedRoot = path.posix.join(extractDir, "dolphin-emu");

        fsMocks.stat.mockImplementation(async (targetPath: string) => {
            if (
                targetPath === path.posix.join(extractDir, "GC") ||
                targetPath === path.posix.join(extractDir, "Wii")
            ) {
                throw new Error("ENOENT");
            }
            return { isDirectory: () => true } as Stats;
        });
        fsMocks.readdir.mockResolvedValue([
            { name: "dolphin-emu", isDirectory: () => true },
        ]);

        await actions.push(device, Emulator.dolphin, serverInfo);

        const commands = backupMocks.createCmd.mock.calls.map(([cmd]) => cmd);
        expect(commands).toContain(
            `cp -r "${serverInfo.dolphinGC}" "${nestedRoot}"`,
        );
        expect(commands).toContain(
            `cp -r "${serverInfo.dolphinWii}" "${nestedRoot}"`,
        );
    });
});

describe("dolphin android pull", () => {
    it("uses the dolphin-emu.zip baseline", async () => {
        const device = buildDevice();
        const serverInfo = buildServer();
        const baseZipPath = path.posix.join(
            serverInfo.workDir,
            "dolphin-emu.zip",
        );

        await actions.pull(device, Emulator.dolphin, serverInfo);

        expect(backupMocks.buildScpCommand).toHaveBeenCalledWith(
            device,
            `${device.dolphinDroidDump}/dolphin-emu.zip`,
            baseZipPath,
            false,
        );

        const commands = backupMocks.createCmd.mock.calls.map(([cmd]) => cmd);
        expect(commands.some((cmd) => cmd.includes("dolphin-export.zip"))).toBe(
            false,
        );
    });

    it("attempts zip repair when first extraction scan fails", async () => {
        const device = buildDevice();
        const serverInfo = buildServer();
        const extractDir = path.posix.join(serverInfo.workDir, "dolphin_emu");
        const baseZipPath = path.posix.join(
            serverInfo.workDir,
            "dolphin-emu.zip",
        );
        const fixedZipPath = `${baseZipPath}.fixed`;
        let repaired = false;

        backupMocks.createCmd.mockImplementation(async (cmd: string) => {
            if (cmd === `zip -FF "${baseZipPath}" --out "${fixedZipPath}"`) {
                repaired = true;
            }
            return 0;
        });
        fsMocks.stat.mockImplementation(async (targetPath: string) => {
            if (!repaired) {
                throw new Error("ENOENT");
            }
            if (
                targetPath === path.posix.join(extractDir, "GC") ||
                targetPath === path.posix.join(extractDir, "Wii")
            ) {
                return { isDirectory: () => true } as Stats;
            }
            throw new Error("ENOENT");
        });
        fsMocks.readdir.mockResolvedValue([]);

        await actions.pull(device, Emulator.dolphin, serverInfo);

        const commands = backupMocks.createCmd.mock.calls.map(([cmd]) => cmd);
        expect(commands).toContain(
            `zip -FF "${baseZipPath}" --out "${fixedZipPath}"`,
        );
        expect(commands).toContain(
            `unzip -o "${fixedZipPath}" -d "${extractDir}"`,
        );
    });

    it("reads GC/Wii from nested dolphin root", async () => {
        const device = buildDevice();
        const serverInfo = buildServer();
        const extractDir = path.posix.join(serverInfo.workDir, "dolphin_emu");
        const nestedRoot = path.posix.join(extractDir, "dolphin-emu");

        fsMocks.stat.mockImplementation(async (targetPath: string) => {
            if (
                targetPath === path.posix.join(extractDir, "GC") ||
                targetPath === path.posix.join(extractDir, "Wii")
            ) {
                throw new Error("ENOENT");
            }
            return { isDirectory: () => true } as Stats;
        });
        fsMocks.readdir.mockResolvedValue([
            { name: "dolphin-emu", isDirectory: () => true },
        ]);

        await actions.pull(device, Emulator.dolphin, serverInfo);

        const commands = backupMocks.createCmd.mock.calls.map(([cmd]) => cmd);
        expect(commands).toContain(
            `mv "${nestedRoot}/GC" "${serverInfo.dolphinGC}"`,
        );
        expect(commands).toContain(
            `mv "${nestedRoot}/Wii" "${serverInfo.dolphinWii}"`,
        );

        // GC must be fully swapped before Wii is deleted: deleting both up
        // front let a failed GC move strand the Wii replacement in extractDir,
        // which the cleanup in the finally then removes.
        expect(
            commands.indexOf(`rm -rf "${serverInfo.dolphinWii}"`),
        ).toBeGreaterThan(
            commands.indexOf(`mv "${nestedRoot}/GC" "${serverInfo.dolphinGC}"`),
        );
    });

    it("reads GC/Wii from deeply nested dolphin root", async () => {
        const device = buildDevice();
        const serverInfo = buildServer();
        const extractDir = path.posix.join(serverInfo.workDir, "dolphin_emu");
        const deepRoot = path.posix.join(
            extractDir,
            "storage/emulated/0/Android/data/org.dolphinemu.dolphinemu/files",
        );

        fsMocks.stat.mockImplementation(async (targetPath: string) => {
            if (
                targetPath === path.posix.join(deepRoot, "GC") ||
                targetPath === path.posix.join(deepRoot, "Wii")
            ) {
                return { isDirectory: () => true } as Stats;
            }
            throw new Error("ENOENT");
        });
        fsMocks.readdir.mockImplementation(async (targetPath: string) => {
            if (targetPath === extractDir) {
                return [{ name: "storage", isDirectory: () => true }];
            }
            if (targetPath === path.posix.join(extractDir, "storage")) {
                return [{ name: "emulated", isDirectory: () => true }];
            }
            if (
                targetPath ===
                path.posix.join(extractDir, "storage", "emulated")
            ) {
                return [{ name: "0", isDirectory: () => true }];
            }
            if (
                targetPath ===
                path.posix.join(extractDir, "storage", "emulated", "0")
            ) {
                return [{ name: "Android", isDirectory: () => true }];
            }
            if (
                targetPath ===
                path.posix.join(
                    extractDir,
                    "storage",
                    "emulated",
                    "0",
                    "Android",
                )
            ) {
                return [{ name: "data", isDirectory: () => true }];
            }
            if (
                targetPath ===
                path.posix.join(
                    extractDir,
                    "storage",
                    "emulated",
                    "0",
                    "Android",
                    "data",
                )
            ) {
                return [
                    {
                        name: "org.dolphinemu.dolphinemu",
                        isDirectory: () => true,
                    },
                ];
            }
            if (
                targetPath ===
                path.posix.join(
                    extractDir,
                    "storage",
                    "emulated",
                    "0",
                    "Android",
                    "data",
                    "org.dolphinemu.dolphinemu",
                )
            ) {
                return [{ name: "files", isDirectory: () => true }];
            }
            return [];
        });

        await actions.pull(device, Emulator.dolphin, serverInfo);

        const commands = backupMocks.createCmd.mock.calls.map(([cmd]) => cmd);
        expect(commands).toContain(
            `mv "${deepRoot}/GC" "${serverInfo.dolphinGC}"`,
        );
        expect(commands).toContain(
            `mv "${deepRoot}/Wii" "${serverInfo.dolphinWii}"`,
        );
    });
});

describe("runDeviceSync", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("logs action flow", async () => {
        const device = buildDevice();
        const serverInfo = buildServer();
        const request = {
            deviceName: device.name,
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
                { emulator: Emulator.azahar, action: SyncAction.pull },
                { emulator: Emulator.dolphin, action: SyncAction.ignore },
            ],
        };
        const { logs, failures } = await actions.runDeviceSync(
            request,
            device,
            serverInfo,
        );

        expect(logs).toEqual([
            `push:${Emulator.cemu}`,
            `pull:${Emulator.azahar}`,
            `ignore:${Emulator.dolphin}`,
        ]);
        expect(failures).toEqual([]);
        expect(backupMocks.pushPairs).toHaveBeenCalledWith(
            device,
            expect.any(Array),
            undefined,
        );
        expect(backupMocks.pullPairs).toHaveBeenCalledWith(
            device,
            expect.any(Array),
            serverInfo,
            undefined,
        );
    });

    it("logs errors per emulator", async () => {
        const device = buildDevice();
        const serverInfo = buildServer();
        const request = {
            deviceName: device.name,
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
            ],
        };
        backupMocks.pushPairs.mockRejectedValue(new Error("boom"));

        const { logs, failures } = await actions.runDeviceSync(
            request,
            device,
            serverInfo,
        );

        expect(logs).toEqual([
            `push:${Emulator.cemu}`,
            `error:${Emulator.cemu}:boom`,
        ]);
        // The caller keys the job status off this; an empty array here is what
        // used to report a fully failed sync as COMPLETE.
        expect(failures).toEqual([Emulator.cemu]);
    });

    it("reports failures while still running the remaining emulators", async () => {
        const device = buildDevice();
        const serverInfo = buildServer();
        const request = {
            deviceName: device.name,
            emulatorActions: [
                { emulator: Emulator.cemu, action: SyncAction.push },
                { emulator: Emulator.azahar, action: SyncAction.pull },
            ],
        };
        backupMocks.pushPairs.mockRejectedValue(new Error("boom"));

        const { failures } = await actions.runDeviceSync(
            request,
            device,
            serverInfo,
        );

        expect(failures).toEqual([Emulator.cemu]);
        expect(backupMocks.pullPairs).toHaveBeenCalled();
    });
});
