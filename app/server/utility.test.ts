import { describe, expect, it } from "vitest";
import type { EmuDevice } from "./types";
import { EmuOs, Emulator, SyncType } from "./types";
import {
    convertEmuDeviceToSimpleDevice,
    getFolderName,
    getSyncTypeForOs,
} from "./utility";

const buildDevice = (overrides: Partial<EmuDevice> = {}): EmuDevice => ({
    name: "Main Rig",
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
    workDir: "/srv/emu",
    ...overrides,
});

describe("utility helpers", () => {
    it("returns folder names from paths", () => {
        expect(getFolderName("/srv/emu/config")).toBe("config");
    });

    it("maps sync type based on OS", () => {
        expect(getSyncTypeForOs(EmuOs.nx)).toBe(SyncType.ftp);
        expect(getSyncTypeForOs(EmuOs.linux)).toBe(SyncType.ssh);
    });
});

describe("convertEmuDeviceToSimpleDevice", () => {
    it("detects desktop emulators", () => {
        const device = buildDevice({
            cemuSave: "/emu/cemu",
            azahar: "/storage/emu/azahar",
            melonds: "/emu/melonds",
            dolphinGC: "/emu/dolphin/GC",
            dolphinWii: "/emu/dolphin/Wii",
            pcsx2Save: "/emu/pcsx2",
        });

        const result = convertEmuDeviceToSimpleDevice(device);

        expect(result).toEqual({
            name: device.name,
            os: device.os,
            emulatorsEnabled: [
                Emulator.cemu,
                Emulator.azahar,
                Emulator.dolphin,
                Emulator.melonds,
                Emulator.pcsx2,
            ],
        });
    });

    it("handles android-specific requirements", () => {
        const device = buildDevice({
            os: EmuOs.android,
            dolphinDroidDump: "/sdcard/dolphin",
            nethersx2Save: "/sdcard/nethersx2",
            yuzuDroid: "/sdcard/yuzu",
            yuzuDroidDump: "/sdcard/yuzu/dump",
        });

        const result = convertEmuDeviceToSimpleDevice(device);

        expect(result.emulatorsEnabled).toEqual([
            Emulator.dolphin,
            Emulator.nethersx2,
            Emulator.yuzu,
        ]);
    });

    it("enables android yuzu on the dump dir alone", () => {
        // yuzuDroid is read by nothing; requiring it meant a correctly
        // configured device was not offered yuzu at all.
        const device = buildDevice({
            os: EmuOs.android,
            yuzuDroidDump: "/sdcard/yuzu/dump",
        });

        expect(convertEmuDeviceToSimpleDevice(device).emulatorsEnabled).toEqual(
            [Emulator.yuzu],
        );
    });

    it("does not advertise android yuzu on yuzuSave alone", () => {
        // manageYuzu routes Android through the dump dir, so yuzuSave by
        // itself would offer a sync that copies nothing.
        const device = buildDevice({
            os: EmuOs.android,
            yuzuSave: "/sdcard/yuzu",
        });

        expect(convertEmuDeviceToSimpleDevice(device).emulatorsEnabled).toEqual(
            [],
        );
    });

    it("does not advertise an emulator configured with a blank path", () => {
        // A blank path passed the typeof check and enabled the emulator; the
        // manager then produced no pairs and the sync reported success having
        // copied nothing.
        const device = buildDevice({
            cemuSave: "",
            azahar: "   ",
            melonds: "/emu/melonds",
        });

        expect(convertEmuDeviceToSimpleDevice(device).emulatorsEnabled).toEqual(
            [Emulator.melonds],
        );
    });
});
