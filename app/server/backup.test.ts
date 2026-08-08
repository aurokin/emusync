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

// Emits "exit" as a microtask, not via setTimeout.
//
// setTimeout is a macrotask, so it always fires after the microtask queue has
// drained — meaning a handler attached after any number of awaits still saw
// the event, and the mock structurally could not reproduce the hang that took
// the app down once (createCmd awaited a Redis write between spawn() and
// attaching the exit handler). Resolving a promise instead makes the ordering
// realistic: attach late and the event is missed, exactly as in production.
const mockSpawn = (stderrMessage?: string, exitCode = 0) => {
    spawnMocks.spawn.mockImplementation(() => {
        const emitter = new EventEmitter();
        const stdout = new EventEmitter();
        const stderr = new EventEmitter();
        void Promise.resolve().then(() => {
            if (stderrMessage) {
                stderr.emit("data", Buffer.from(stderrMessage));
            }
            emitter.emit("exit", exitCode);
        });
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

    it("emits the exact push sequence for a linux device", async () => {
        const device = buildDevice({ syncType: SyncType.ssh });

        await backup.pushPairs(device, pairs);

        expect(ranCommands()).toEqual([
            "ssh -p 22 root@10.0.0.10 'rm -rf /tmp/work'",
            "ssh -p 22 root@10.0.0.10 'mkdir /tmp/work'",
            "scp -P 22 -r /srv/a root@10.0.0.10:/tmp/work",
            "ssh -p 22 root@10.0.0.10 'rm -rf /device/a'",
            "ssh -p 22 root@10.0.0.10 'mv /tmp/work/a /device/a'",
            "scp -P 22 -r /srv/b root@10.0.0.10:/tmp/work",
            "ssh -p 22 root@10.0.0.10 'rm -rf /device/b'",
            "ssh -p 22 root@10.0.0.10 'mv /tmp/work/b /device/b'",
        ]);
    });

    it("escapes spaces in every push path, workDir included", async () => {
        // workDir is operator-supplied and lands in an rm -rf on the device.
        const device = buildDevice({
            syncType: SyncType.ssh,
            workDir: "/tmp/emu work",
        });

        await backup.pushPairs(device, [
            { source: "/srv/my saves", target: "/device/my saves" },
        ]);

        expect(ranCommands()).toEqual([
            "ssh -p 22 root@10.0.0.10 'rm -rf /tmp/emu\\ work'",
            "ssh -p 22 root@10.0.0.10 'mkdir /tmp/emu\\ work'",
            "scp -P 22 -r /srv/my\\ saves root@10.0.0.10:/tmp/emu\\ work",
            "ssh -p 22 root@10.0.0.10 'rm -rf /device/my\\ saves'",
            "ssh -p 22 root@10.0.0.10 'mv /tmp/emu\\ work/my\\ saves /device/my\\ saves'",
        ]);
    });

    it("emits the exact pull sequence for a linux device", async () => {
        const device = buildDevice({ syncType: SyncType.ssh });
        const serverInfo = { workDir: "/srv/work" } as EmuServer;

        await backup.pullPairs(device, pairs, serverInfo);

        expect(ranCommands()).toEqual([
            "rm -rf /srv/work",
            "mkdir -p /srv/work",
            "scp -P 22 -r root@10.0.0.10:/srv/a /srv/work",
            "rm -rf /device/a",
            "mv /srv/work/a /device/a",
            "scp -P 22 -r root@10.0.0.10:/srv/b /srv/work",
            "rm -rf /device/b",
            "mv /srv/work/b /device/b",
        ]);
    });

    // haste is a Windows device, so this branch runs in production. It had no
    // coverage at all: buildRm emits PowerShell here, and esc quotes instead
    // of backslash-escaping.
    it("emits PowerShell deletes and quoted paths for a windows device", async () => {
        const device = buildDevice({
            os: EmuOs.windows,
            syncType: SyncType.ssh,
            workDir: "C:/Users/auro/.emusync_tmp",
        });

        await backup.pushPairs(device, [
            { source: "/srv/retroarch", target: "D:/RetroArch/saves" },
        ]);

        expect(ranCommands()).toEqual([
            `ssh -p 22 root@10.0.0.10 'if (Test-Path -Path "C:/Users/auro/.emusync_tmp" -PathType Container) { rm -r "C:/Users/auro/.emusync_tmp" }'`,
            `ssh -p 22 root@10.0.0.10 'mkdir "C:/Users/auro/.emusync_tmp"'`,
            `scp -P 22 -r /srv/retroarch root@10.0.0.10:"C:/Users/auro/.emusync_tmp"`,
            `ssh -p 22 root@10.0.0.10 'if (Test-Path -Path "D:/RetroArch/saves" -PathType Container) { rm -r "D:/RetroArch/saves" }'`,
            `ssh -p 22 root@10.0.0.10 'mv "C:/Users/auro/.emusync_tmp/retroarch" "D:/RetroArch/saves"'`,
        ]);
    });

    it("does not delete any target after a transfer fails", async () => {
        // The point of interleaving: a failed scp must abort before the rm -rf
        // that would follow it, and must never reach the second pair.
        const device = buildDevice({ syncType: SyncType.ssh });
        const serverInfo = { workDir: "/srv/work" } as EmuServer;
        spawnMocks.spawn.mockImplementation((_bin, args) => {
            const cmd = (args as string[])[1];
            const emitter = new EventEmitter();
            const stdout = new EventEmitter();
            const stderr = new EventEmitter();
            void Promise.resolve().then(() =>
                emitter.emit("exit", cmd.includes("scp") ? 1 : 0),
            );
            return {
                stdout,
                stderr,
                on: emitter.on.bind(emitter),
                kill: killMock,
            } as never;
        });

        await expect(
            backup.pullPairs(device, pairs, serverInfo),
        ).rejects.toThrow(/Command failed/);

        const deletes = ranCommands().filter(
            (c) => c.startsWith("rm -rf") && c.includes("/device/"),
        );
        expect(deletes).toEqual([]);
        expect(ranCommands().some((c) => c.includes("/srv/b"))).toBe(false);
    });
});

describe("command string builders", () => {
    it("escapes spaces for posix and quotes for windows", () => {
        expect(backup.esc("/srv/emu sync/work")).toBe("/srv/emu\\ sync/work");
        expect(backup.esc("D:/Program Files/saves", true)).toBe(
            `"D:/Program Files/saves"`,
        );
    });

    it("builds a guarded recursive delete for windows", () => {
        expect(backup.buildRm("/srv/work")).toBe("rm -rf /srv/work");
        expect(backup.buildRm(`"D:/saves"`, true)).toBe(
            `if (Test-Path -Path "D:/saves" -PathType Container) { rm -r "D:/saves" }`,
        );
    });
});

describe("createCmd event timing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSpawn();
    });

    // Regression for the bug that hung every sync in production: createCmd
    // awaited a Redis write between spawn() and attaching the exit handler, so
    // a fast command exited unobserved. Fails by timeout if handlers are ever
    // attached after an await again.
    it("observes an exit that happens while the job log write is pending", async () => {
        await expect(backup.createCmd("true", "job-1")).resolves.toBe(0);
    }, 1000);
});
