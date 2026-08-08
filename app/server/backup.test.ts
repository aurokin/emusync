import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmuDevice, EmuServer } from "./types";
import { EmuOs, SyncType } from "./types";
import * as backup from "./backup";

const ftpMocks = vi.hoisted(() => ({
    access: vi.fn(),
    close: vi.fn(),
    ftp: { verbose: false },
}));

const spawnMocks = vi.hoisted(() => ({
    spawn: vi.fn(),
}));

vi.mock("basic-ftp", () => ({
    Client: class {
        ftp = ftpMocks.ftp;
        access = ftpMocks.access;
        close = ftpMocks.close;
    },
}));

vi.mock("child_process", () => ({
    spawn: spawnMocks.spawn,
    default: {
        spawn: spawnMocks.spawn,
    },
}));

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
    workDir: "/tmp/work",
    ...overrides,
});

const killMock = vi.fn();

const mockSpawn = (stderrMessage?: string, exitCode = 0) => {
    spawnMocks.spawn.mockImplementation(() => {
        const emitter = new EventEmitter();
        const stdout = new EventEmitter();
        const stderr = new EventEmitter();
        if (stderrMessage) {
            setTimeout(() => {
                stderr.emit("data", Buffer.from(stderrMessage));
            }, 0);
        }
        setTimeout(() => emitter.emit("exit", exitCode), 0);
        return {
            stdout,
            stderr,
            on: emitter.on.bind(emitter),
            kill: killMock,
        } as unknown as {
            stdout: EventEmitter;
            stderr: EventEmitter;
            on: (event: string, cb: (...args: unknown[]) => void) => void;
            kill: () => void;
        };
    });
};

describe("backup helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSpawn();
    });

    it("builds ssh and scp commands", () => {
        const device = buildDevice();
        expect(backup.buildSshCommand(device, "ls")).toBe(
            "ssh -p 22 root@10.0.0.10 'ls'",
        );
        expect(
            backup.buildScpCommand(device, "/srv/save", "/tmp/save", true),
        ).toBe("scp -P 22 -r /srv/save root@10.0.0.10:/tmp/save");
        expect(
            backup.buildScpCommand(device, "/srv/save", "/tmp/save", false),
        ).toBe("scp -P 22 -r root@10.0.0.10:/srv/save /tmp/save");
    });

    it("runs ftp connection tests", async () => {
        ftpMocks.access.mockResolvedValue(undefined);
        const device = buildDevice({ syncType: SyncType.ftp });

        const result = await backup.connectionTest(device);

        expect(result).toBe(true);
        expect(ftpMocks.access).toHaveBeenCalledWith({
            host: device.ip,
            port: device.port,
            user: device.user,
            password: device.password,
            secure: false,
        });
        expect(ftpMocks.close).toHaveBeenCalled();
    });

    it("fails ftp connection tests on error", async () => {
        ftpMocks.access.mockRejectedValue(new Error("nope"));
        const device = buildDevice({ syncType: SyncType.ftp });

        const result = await backup.connectionTest(device);

        expect(result).toBe(false);
        expect(ftpMocks.close).toHaveBeenCalled();
    });

    it("runs ssh connection tests", async () => {
        const device = buildDevice({ syncType: SyncType.ssh });

        const result = await backup.connectionTest(device);

        expect(result).toBe(true);
        expect(spawnMocks.spawn).toHaveBeenCalledWith("bash", [
            "-c",
            backup.buildSshCommand(device, "echo hello_emusync"),
        ]);
    });

    it("returns false when ssh test fails", async () => {
        mockSpawn("ssh-error", 255);
        const device = buildDevice({ syncType: SyncType.ssh });

        const result = await backup.connectionTest(device);

        expect(result).toBe(false);
    });

    it("treats a zero exit as success even when the command wrote to stderr", async () => {
        // ssh writes "Warning: Permanently added ... to the list of known
        // hosts" to stderr on a first connection. Failing on that aborted
        // healthy syncs partway through.
        mockSpawn(
            "Warning: Permanently added 'host' to the list of known hosts.",
            0,
        );
        const device = buildDevice({ syncType: SyncType.ssh });

        await expect(backup.connectionTest(device)).resolves.toBe(true);
    });

    it("rejects on a non-zero exit that printed nothing", async () => {
        mockSpawn(undefined, 3);

        await expect(backup.createCmd("false")).rejects.toThrow(
            /Command failed \(exit 3\)/,
        );
    });
});

// Batching every target deletion ahead of every move meant one failed move
// left several target directories already deleted, with the only copies in a
// workDir the next run wipes first. Each pair must be staged, deleted and
// moved before the next pair is touched.
describe("sync pair ordering", () => {
    const ranCommands = () =>
        spawnMocks.spawn.mock.calls.map(([, args]) => (args as string[])[1]);

    beforeEach(() => {
        vi.clearAllMocks();
        mockSpawn();
    });

    const pairs = [
        { source: "/srv/a", target: "/device/a" },
        { source: "/srv/b", target: "/device/b" },
    ];

    it("finishes each pair before staging the next on push", async () => {
        const device = buildDevice({ syncType: SyncType.ssh });

        await backup.pushPairs(device, pairs);

        const commands = ranCommands();
        const firstMove = commands.findIndex((c) => c.includes("/device/a"));
        const secondScp = commands.findIndex((c) => c.includes("/srv/b"));
        const secondDelete = commands.findIndex(
            (c) => c.includes("rm -rf") && c.includes("/device/b"),
        );

        expect(firstMove).toBeGreaterThan(-1);
        expect(secondScp).toBeGreaterThan(firstMove);
        expect(secondDelete).toBeGreaterThan(secondScp);
    });

    it("finishes each pair before staging the next on pull", async () => {
        const device = buildDevice({ syncType: SyncType.ssh });
        const serverInfo = { workDir: "/srv/work" } as EmuServer;

        await backup.pullPairs(device, pairs, serverInfo);

        const commands = ranCommands();
        const firstDelete = commands.findIndex(
            (c) => c.startsWith("rm -rf") && c.includes("/device/a"),
        );
        const secondScp = commands.findIndex((c) => c.includes("scp"));
        const lastScp = commands
            .map((c) => c.includes("scp"))
            .lastIndexOf(true);

        expect(firstDelete).toBeGreaterThan(secondScp);
        expect(lastScp).toBeGreaterThan(firstDelete);
    });

    it("escapes a workDir containing a space before it reaches rm -rf", async () => {
        const device = buildDevice({ syncType: SyncType.ssh });
        const serverInfo = { workDir: "/srv/emu sync/work" } as EmuServer;

        await backup.pullPairs(device, pairs, serverInfo);

        expect(ranCommands()[0]).toBe("rm -rf /srv/emu\\ sync/work");
    });
});
