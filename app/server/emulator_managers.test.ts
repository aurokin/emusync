import { describe, expect, it } from "vitest";
import type { EmuDevice, EmuServer } from "./types";
import { EmuOs, Emulator, SyncType } from "./types";
import { getManageFn } from "./emulator_managers";

const buildDevice = (overrides: Partial<EmuDevice> = {}): EmuDevice => ({
    name: "Rig",
    ip: "10.0.0.10",
    port: 22,
    user: "root",
    password: "secret",
    os: EmuOs.linux,
    syncType: SyncType.ssh,
    cemuSave: undefined,
    azahar: undefined,
    dolphinDroidDump: undefined,
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
    workDir: "/tmp/emu",
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

describe("emulator managers", () => {
    it("throws for unknown emulator", () => {
        expect(() => getManageFn("bad" as Emulator)).toThrow("Unknown Console");
    });

    it("builds dolphin pairs for desktop", () => {
        const device = buildDevice({
            dolphinGC: "/device/GC",
            dolphinWii: "/device/Wii",
        });
        const serverInfo = buildServer();
        const manage = getManageFn(Emulator.dolphin);

        const pairs = manage(device, serverInfo, true);

        expect(pairs).toEqual([
            { source: serverInfo.dolphinGC, target: device.dolphinGC },
            { source: serverInfo.dolphinWii, target: device.dolphinWii },
        ]);
    });

    it("skips dolphin pairs for android", () => {
        const device = buildDevice({
            os: EmuOs.android,
            dolphinDroidDump: "/sdcard/dolphin",
        });
        const serverInfo = buildServer();
        const manage = getManageFn(Emulator.dolphin);

        expect(manage(device, serverInfo, true)).toEqual([]);
    });

    it("syncs Azahar subdirectories", () => {
        const device = buildDevice({ azahar: "/device/Azahar" });
        const serverInfo = buildServer();
        const manage = getManageFn(Emulator.azahar);

        expect(manage(device, serverInfo, true)).toEqual([
            { source: "/srv/azahar/nand", target: "/device/Azahar/nand" },
            { source: "/srv/azahar/sdmc", target: "/device/Azahar/sdmc" },
            {
                source: "/srv/azahar/sysdata",
                target: "/device/Azahar/sysdata",
            },
        ]);
    });

    it("syncs nethersx2 memcards on both push and pull", () => {
        const device = buildDevice({
            os: EmuOs.android,
            nethersx2Save: "/sdcard/nethersx2",
        });
        const serverInfo = buildServer();
        const manage = getManageFn(Emulator.nethersx2);

        expect(manage(device, serverInfo, true)).toEqual([
            {
                source: `${serverInfo.nethersx2Save}/memcards`,
                target: `${device.nethersx2Save}/memcards`,
            },
        ]);

        expect(manage(device, serverInfo, false)).toEqual([
            {
                source: `${device.nethersx2Save}/memcards`,
                target: `${serverInfo.nethersx2Save}/memcards`,
            },
        ]);
    });

    it("manages melonds with a single shared path", () => {
        const device = buildDevice({
            melonds: "/device/melonds",
        });
        const serverInfo = buildServer();
        const manage = getManageFn(Emulator.melonds);

        expect(manage(device, serverInfo, true)).toEqual([
            {
                source: serverInfo.melonds,
                target: device.melonds,
            },
        ]);
        expect(manage(device, serverInfo, false)).toEqual([
            {
                source: device.melonds,
                target: serverInfo.melonds,
            },
        ]);
    });

    it("routes retroarch muos to rg states", () => {
        const device = buildDevice({
            os: EmuOs.muos,
            retroarchSave: "/roms/retroarch",
            retroarchState: "/roms/retroarch/states",
        });
        const serverInfo = buildServer();
        const manage = getManageFn(Emulator.retroarch);

        const pairs = manage(device, serverInfo, false);

        expect(pairs).toEqual([
            {
                source: device.retroarchSave,
                target: serverInfo.retroarchSave,
            },
            {
                source: device.retroarchState,
                target: serverInfo.retroarchRgState,
            },
        ]);
    });

    it("handles android yuzu sync", () => {
        const device = buildDevice({
            os: EmuOs.android,
            yuzuSave: "/sdcard/yuzu",
            yuzuDroidDump: "/sdcard/yuzu/dump",
        });
        const serverInfo = buildServer();
        const manage = getManageFn(Emulator.yuzu);

        expect(manage(device, serverInfo, true)).toEqual([
            {
                source: serverInfo.yuzuSave,
                target: device.yuzuDroidDump,
            },
        ]);
        expect(manage(device, serverInfo, false)).toEqual([
            {
                source: device.yuzuSave,
                target: serverInfo.yuzuSave,
            },
        ]);
    });

    it("maps pcsx2 to the same memcards dir nethersx2 uses", () => {
        // Both emulators read the one nethersx2Save server field, so they must
        // resolve it to the same depth or a pcsx2 pull deletes the tree that
        // nethersx2 syncs.
        const device = buildDevice({ pcsx2Save: "/device/pcsx2" });
        const serverInfo = buildServer({ nethersx2Save: "/srv/pcsx2" });

        expect(getManageFn(Emulator.pcsx2)(device, serverInfo, true)).toEqual([
            { source: "/srv/pcsx2/memcards", target: "/device/pcsx2" },
        ]);
        expect(getManageFn(Emulator.pcsx2)(device, serverInfo, false)).toEqual([
            { source: "/device/pcsx2", target: "/srv/pcsx2/memcards" },
        ]);

        const nethersx2Device = buildDevice({ nethersx2Save: "/device/nsx2" });
        expect(
            getManageFn(Emulator.nethersx2)(nethersx2Device, serverInfo, true)
                .length,
        ).toBe(1);
        expect(
            getManageFn(Emulator.nethersx2)(
                nethersx2Device,
                serverInfo,
                true,
            )[0].source,
        ).toBe("/srv/pcsx2/memcards");
    });
});
