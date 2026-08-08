import path from "node:path";
import type { EmuDevice, EmuServer, SyncPair } from "./types";
import { EmuOs, Emulator } from "./types";

export const getManageFn = (
    emulator: Emulator,
): ((
    device: EmuDevice,
    serverInfo: EmuServer,
    isPush: boolean,
) => SyncPair[]) => {
    if (emulator === Emulator.cemu) {
        return manageCemu;
    } else if (emulator === Emulator.azahar) {
        return manageAzahar;
    } else if (emulator === Emulator.dolphin) {
        return manageDolphin;
    } else if (emulator === Emulator.mupen) {
        return manageMupenFz;
    } else if (emulator === Emulator.melonds) {
        return manageMelonds;
    } else if (emulator === Emulator.nethersx2) {
        return manageNethersx2;
    } else if (emulator === Emulator.pcsx2) {
        return managePcsx2;
    } else if (emulator === Emulator.ppsspp) {
        return managePpsspp;
    } else if (emulator === Emulator.retroarch) {
        return manageRetroarch;
    } else if (emulator === Emulator.rpcs3) {
        return manageRpcs3;
    } else if (emulator === Emulator.ryujinx) {
        return manageRyujinx;
    } else if (emulator === Emulator.switch) {
        return manageSwitch;
    } else if (emulator === Emulator.vita3k) {
        return manageVita3k;
    } else if (emulator === Emulator.xemu) {
        return manageXemu;
    } else if (emulator === Emulator.xenia) {
        return manageXenia;
    } else if (emulator === Emulator.yuzu) {
        return manageYuzu;
    } else {
        throw new Error("Unknown Console");
    }
};

const simpleManage = (
    serverPath: string,
    devicePath: string,
    push: boolean,
): SyncPair[] => {
    return [
        {
            source: push ? serverPath : devicePath,
            target: push ? devicePath : serverPath,
        },
    ];
};

const getNetherSX2MemcardsPath = (basePath: string) =>
    path.posix.basename(basePath) === "memcards"
        ? basePath
        : path.posix.join(basePath, "memcards");

const manageCemu = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.cemuSave) return [];
    return simpleManage(serverInfo.cemuSave, device.cemuSave, push);
};

const manageAzahar = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.azahar) return [];

    const pairs: SyncPair[] = [];
    for (const folder of ["nand", "sdmc", "sysdata"]) {
        pairs.push(
            ...simpleManage(
                path.posix.join(serverInfo.azahar, folder),
                path.posix.join(device.azahar, folder),
                push,
            ),
        );
    }
    return pairs;
};

const manageDolphin = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (device.os !== EmuOs.android) {
        const pairs: SyncPair[] = [];
        if (device.dolphinGC)
            pairs.push(
                ...simpleManage(serverInfo.dolphinGC, device.dolphinGC, push),
            );
        if (device.dolphinWii)
            pairs.push(
                ...simpleManage(serverInfo.dolphinWii, device.dolphinWii, push),
            );
        return pairs;
    }
    return [];
};

const manageMupenFz = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.mupenFzSave) return [];
    return simpleManage(serverInfo.mupenFzSave, device.mupenFzSave, push);
};

const manageMelonds = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.melonds) return [];
    return simpleManage(serverInfo.melonds, device.melonds, push);
};

const manageNethersx2 = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.nethersx2Save) return [];
    const deviceMemcardsPath = getNetherSX2MemcardsPath(device.nethersx2Save);
    const serverMemcardsPath = getNetherSX2MemcardsPath(
        serverInfo.nethersx2Save,
    );

    return [
        {
            source: push ? serverMemcardsPath : deviceMemcardsPath,
            target: push ? deviceMemcardsPath : serverMemcardsPath,
        },
    ];
};

const managePcsx2 = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.pcsx2Save) return [];
    // PCSX2 and NetherSX2 share one server field, so they must resolve it to
    // the same depth. Using it raw here pointed pcsx2 at the parent of the
    // memcards directory that nethersx2 syncs, so a pcsx2 pull would delete
    // the whole NetherSX2 tree and leave the cards one level too high.
    const serverMemcardsPath = getNetherSX2MemcardsPath(
        serverInfo.nethersx2Save,
    );
    return [
        {
            source: push ? serverMemcardsPath : device.pcsx2Save,
            target: push ? device.pcsx2Save : serverMemcardsPath,
        },
    ];
};

const managePpsspp = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    const pairs: SyncPair[] = [];
    if (device.ppssppSave)
        pairs.push(
            ...simpleManage(serverInfo.ppssppSave, device.ppssppSave, push),
        );
    if (device.ppssppState)
        pairs.push(
            ...simpleManage(serverInfo.ppssppState, device.ppssppState, push),
        );
    return pairs;
};

const manageRetroarch = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    const serverPairs: SyncPair[] = [];
    if (device.retroarchSave) {
        serverPairs.push(
            ...simpleManage(
                serverInfo.retroarchSave,
                device.retroarchSave,
                push,
            ),
        );
    }
    if (device.retroarchState) {
        if (device.os !== EmuOs.muos) {
            serverPairs.push(
                ...simpleManage(
                    serverInfo.retroarchState,
                    device.retroarchState,
                    push,
                ),
            );
        } else {
            serverPairs.push(
                ...simpleManage(
                    serverInfo.retroarchRgState,
                    device.retroarchState,
                    push,
                ),
            );
        }
    }
    return serverPairs;
};

const manageRpcs3 = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.rpcs3Save) return [];
    return simpleManage(serverInfo.rpcs3Save, device.rpcs3Save, push);
};
const manageRyujinx = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.ryujinxSave) return [];
    return simpleManage(serverInfo.ryujinxSave, device.ryujinxSave, push);
};
const manageSwitch = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.switchSave) return [];
    return simpleManage(serverInfo.switchSave, device.switchSave, push);
};
const manageVita3k = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.vita3kSave) return [];
    return simpleManage(serverInfo.vita3kSave, device.vita3kSave, push);
};
const manageXemu = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.xemuSave) return [];
    return simpleManage(serverInfo.xemuSave, device.xemuSave, push);
};
const manageXenia = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (!device.xeniaSave) return [];
    return simpleManage(serverInfo.xeniaSave, device.xeniaSave, push);
};
const manageYuzu = (
    device: EmuDevice,
    serverInfo: EmuServer,
    push: boolean,
): SyncPair[] => {
    if (device.os !== EmuOs.android) {
        if (!device.yuzuSave) return [];
        return simpleManage(serverInfo.yuzuSave, device.yuzuSave, push);
    } else {
        // Both directions go through the dump directory, as dolphin does on
        // Android: the emulator's own save dir is app-private and not
        // reachable over sftp. Pulling from yuzuSave instead meant an Android
        // device could be listed as yuzu-capable and then pull nothing.
        if (!device.yuzuDroidDump) return [];
        return simpleManage(serverInfo.yuzuSave, device.yuzuDroidDump, push);
    }
};
