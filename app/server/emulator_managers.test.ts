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

    it("routes android yuzu through the dump dir in both directions", () => {
        // The emulator's own save dir is app-private, so both directions go
        // through the dump dir — as dolphin does on Android. Pulling from
        // yuzuSave meant an Android device advertised yuzu and pulled nothing.
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
                source: device.yuzuDroidDump,
                target: serverInfo.yuzuSave,
            },
        ]);
    });

    it("produces no android yuzu pairs without a dump dir", () => {
        const device = buildDevice({
            os: EmuOs.android,
            yuzuSave: "/sdcard/yuzu",
        });
        const serverInfo = buildServer();
        const manage = getManageFn(Emulator.yuzu);

        expect(manage(device, serverInfo, true)).toEqual([]);
        expect(manage(device, serverInfo, false)).toEqual([]);
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

// Every Emulator value, both directions, with every device path populated.
// Nine of the sixteen managers previously had no test at all, and retroarch
// was only exercised through the muos branch — not the desktop/android mapping
// that herb, haste, odin and thor actually use.
describe("emulator pair matrix", () => {
    const fullDevice = buildDevice({
        os: EmuOs.linux,
        cemuSave: "/dev/cemu",
        azahar: "/dev/azahar",
        dolphinGC: "/dev/GC",
        dolphinWii: "/dev/Wii",
        mupenFzSave: "/dev/mupen",
        melonds: "/dev/melonds",
        nethersx2Save: "/dev/nsx2",
        pcsx2Save: "/dev/pcsx2",
        ppssppSave: "/dev/psp/save",
        ppssppState: "/dev/psp/state",
        retroarchSave: "/dev/ra/saves",
        retroarchState: "/dev/ra/states",
        rpcs3Save: "/dev/rpcs3",
        ryujinxSave: "/dev/ryujinx",
        switchSave: "/dev/switch",
        vita3kSave: "/dev/vita3k",
        xemuSave: "/dev/xemu",
        xeniaSave: "/dev/xenia",
        yuzuSave: "/dev/yuzu",
    });
    const serverInfo = buildServer();

    // source/target for push; pull is asserted as the exact mirror image.
    const expected: Record<Emulator, [string, string][]> = {
        [Emulator.cemu]: [["/srv/cemu", "/dev/cemu"]],
        [Emulator.azahar]: [
            ["/srv/azahar/nand", "/dev/azahar/nand"],
            ["/srv/azahar/sdmc", "/dev/azahar/sdmc"],
            ["/srv/azahar/sysdata", "/dev/azahar/sysdata"],
        ],
        [Emulator.dolphin]: [
            ["/srv/dolphin/GC", "/dev/GC"],
            ["/srv/dolphin/Wii", "/dev/Wii"],
        ],
        [Emulator.mupen]: [["/srv/mupen", "/dev/mupen"]],
        [Emulator.melonds]: [["/srv/melonds", "/dev/melonds"]],
        [Emulator.nethersx2]: [
            ["/srv/nethersx2/memcards", "/dev/nsx2/memcards"],
        ],
        [Emulator.pcsx2]: [["/srv/nethersx2/memcards", "/dev/pcsx2"]],
        [Emulator.ppsspp]: [
            ["/srv/ppsspp", "/dev/psp/save"],
            ["/srv/ppsspp/state", "/dev/psp/state"],
        ],
        [Emulator.retroarch]: [
            ["/srv/retroarch", "/dev/ra/saves"],
            ["/srv/retroarch/state", "/dev/ra/states"],
        ],
        [Emulator.rpcs3]: [["/srv/rpcs3", "/dev/rpcs3"]],
        [Emulator.ryujinx]: [["/srv/ryujinx", "/dev/ryujinx"]],
        [Emulator.switch]: [["/srv/switch", "/dev/switch"]],
        [Emulator.vita3k]: [["/srv/vita3k", "/dev/vita3k"]],
        [Emulator.xemu]: [["/srv/xemu", "/dev/xemu"]],
        [Emulator.xenia]: [["/srv/xenia", "/dev/xenia"]],
        [Emulator.yuzu]: [["/srv/yuzu", "/dev/yuzu"]],
    };

    it("covers every emulator in the enum", () => {
        // Guards the table itself: a new Emulator must be added here too.
        expect(Object.keys(expected).sort()).toEqual(
            Object.values(Emulator).sort(),
        );
    });

    it.each(Object.values(Emulator))("maps %s on push", (emulator) => {
        const pairs = getManageFn(emulator)(fullDevice, serverInfo, true);
        expect(pairs).toEqual(
            expected[emulator].map(([source, target]) => ({ source, target })),
        );
    });

    it.each(Object.values(Emulator))("maps %s on pull", (emulator) => {
        const pairs = getManageFn(emulator)(fullDevice, serverInfo, false);
        expect(pairs).toEqual(
            expected[emulator].map(([serverPath, devicePath]) => ({
                source: devicePath,
                target: serverPath,
            })),
        );
    });

    it.each(Object.values(Emulator))(
        "produces no pairs for %s when the device has no path",
        (emulator) => {
            // An unconfigured emulator must sync nothing rather than build a
            // pair against undefined.
            const bare = buildDevice({ os: EmuOs.linux });
            expect(getManageFn(emulator)(bare, serverInfo, true)).toEqual([]);
            expect(getManageFn(emulator)(bare, serverInfo, false)).toEqual([]);
        },
    );
});
