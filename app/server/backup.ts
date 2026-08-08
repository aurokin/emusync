import { spawn } from "child_process";
import fs from "node:fs/promises";
import type { EmuDevice, SyncPair, EmuServer } from "./types";
import { SyncType, EmuOs } from "./types";
import { Client as FtpClient } from "basic-ftp";
import { getFolderName } from "./utility";
import { appendLog } from "./redis";

// Exported for tests: these two build the literal text of every destructive
// command, so they are worth asserting directly rather than only through the
// sequences below.
export const esc = (s: string, isWindows: boolean = false): string => {
    if (isWindows) {
        return `"${s}"`;
    }
    return s.replace(/ /g, "\\ ");
};

export const buildRm = (path: string, isWindows: boolean = false): string => {
    if (isWindows) {
        return `if (Test-Path -Path ${path} -PathType Container) { rm -r ${path} }`;
    }
    return `rm -rf ${path}`;
};

const appendJobLog = async (jobId: string | undefined, line: string) => {
    if (!jobId) return;
    try {
        await appendLog(jobId, line);
    } catch (e) {
        // Swallow logging errors to avoid breaking command execution
        console.error("appendJobLog error", e);
    }
};

// Success is the exit code and nothing else. ssh and scp write routine
// notices to stderr ("Warning: Permanently added ... to the list of known
// hosts"), so treating stderr as failure aborted healthy syncs; conversely a
// silent non-zero exit used to resolve as success and let the caller go on to
// delete the target directory. stderr is buffered purely for the error message.
export const createCmd = async (cmd: string, jobId?: string) => {
    const p = spawn("bash", ["-c", cmd]);
    let settled = false;
    const stderrChunks: string[] = [];
    console.log(`?: ${cmd}`);

    // Attach all handlers synchronously: a fast command can exit before any
    // await completes, and an unobserved exit event would hang the job.
    const done = new Promise<number>((resolve, reject) => {
        const rejectOnce = (err: Error) => {
            if (settled) return;
            settled = true;
            // Don't leave a half-finished scp writing into a workDir the next
            // step is about to delete.
            p.kill();
            reject(err);
        };

        const resolveOnce = (value: number) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        p.stdout.on("data", (x) => {
            const msg = x.toString();
            void appendJobLog(jobId, `STDOUT: ${msg.trimEnd()}`);
        });

        p.stderr.on("data", (buf) => {
            const msg = buf.toString();
            stderrChunks.push(msg);
            void appendJobLog(jobId, `STDERR: ${msg.trimEnd()}`);
        });

        p.on("error", (err) => {
            console.error(`N: ${cmd}\n`);
            void appendJobLog(jobId, `ERROR: ${err.message}`);
            rejectOnce(err);
        });

        p.on("exit", (code, signal) => {
            if (code === 0) {
                console.log(`Y: ${cmd}\n`);
                void appendJobLog(jobId, `EXIT: 0 (ok)`);
                resolveOnce(0);
                return;
            }
            const detail = code === null ? `signal ${signal}` : `exit ${code}`;
            const stderr = stderrChunks.join("").trim();
            console.error(`N: ${cmd}\n`);
            void appendJobLog(jobId, `EXIT: ${code ?? signal} (failure)`);
            rejectOnce(
                new Error(
                    `Command failed (${detail}): ${cmd}${stderr ? `\n${stderr}` : ""}`,
                ),
            );
        });
    });

    await appendJobLog(jobId, `CMD: ${cmd}`);
    return done;
};
export const buildSshCommand = (device: EmuDevice, cmd: string) => {
    return `ssh -p ${device.port} ${device.user}@${device.ip} '${cmd}'`;
};
export const buildScpCommand = (
    device: EmuDevice,
    source: string,
    target: string,
    push: boolean,
) => {
    if (push) {
        return `scp -P ${device.port} -r ${source} ${device.user}@${device.ip}:${target}`;
    } else {
        return `scp -P ${device.port} -r ${device.user}@${device.ip}:${source} ${target}`;
    }
};
// A trailing slash on an rsync source means "the contents of", which is what
// makes --delete mirror a directory instead of nesting it one level deeper.
//
// It is applied to the destination as well, purely for symmetry: rsync follows
// a destination that is a symlink to a directory whether or not the slash is
// there (verified both ways on the server), so the slash is not what decides
// that. Following it is also the behaviour we want. The scp path instead
// `rm -rf`s the symlink and drops a real directory in its place, silently
// undoing an operator's deliberate indirection and orphaning whatever the link
// pointed at; rsync mirrors into the referent, which is the location the
// configured path actually names.
const asDir = (path: string) => (path.endsWith("/") ? path : `${path}/`);

// Every flag here is chosen against what the scp path already did, not against
// rsync's defaults: the point of this path is to change how a sync gets there,
// not what it does.
//
//   -rLt          scp -r follows symlinks and copies what they point at, so -L
//                 rather than -a's -l (verified against scp on the server).
//                 -a's -pgo are dropped: ownership and permission bits are
//                 meaningless across Linux, Android FUSE storage and Windows,
//                 and failing to set them is the usual spurious non-zero exit.
//   --checksum    Not optional. rsync's default quick check skips any file
//                 whose size and mtime match, and emulator saves are often
//                 fixed-size; verified on the server that the default flags
//                 left stale contents in place and reported success. It costs
//                 a full read of both trees, which these are small enough for.
//   --delete-after
//                 rsync 3 otherwise deletes during the transfer, so a dropped
//                 connection would commit those deletions. Deferred, a failed
//                 transfer never reaches the delete phase.
//   --delay-updates
//                 File contents land in a holding area and are renamed into
//                 place at the end, so an aborted transfer publishes no
//                 half-written saves.
//   --protect-args
//                 rsync otherwise re-splits the remote path in the remote
//                 shell, so a path with a space would need a second layer of
//                 quoting on top of esc(). Present since rsync 3.0 (renamed
//                 --secluded-args in 3.2.4, old spelling kept as an alias).
//
// On failure semantics, since the last two flags invite over-reading and this
// keeps coming up in review: they are not a transaction. An interrupted sync
// can leave new empty directories, the delete phase is not atomic once it has
// begun, a source entry that changes type forces its counterpart to be removed
// early, and a per-file error that rsync survives still promotes whatever did
// transfer. All of that is accepted, because the alternative is worse, not
// better: the scp path this replaces deletes the *entire* target
// unconditionally before moving the staged copy into place (the buildRm call
// in pushPairs below), so every one of those cases is one where rsync destroys
// strictly less than scp did.
const RSYNC_FLAGS = [
    "-rLt",
    "--checksum",
    "--delete-after",
    "--delay-updates",
    "--protect-args",
];

export const buildRsyncCommand = (
    device: EmuDevice,
    source: string,
    target: string,
    push: boolean,
) => {
    const flags = [...RSYNC_FLAGS, `-e ${esc(`ssh -p ${device.port}`)}`].join(
        " ",
    );
    const remote = (path: string) => `${device.user}@${device.ip}:${path}`;
    if (push) {
        return `rsync ${flags} ${esc(asDir(source))} ${esc(remote(asDir(target)))}`;
    }
    return `rsync ${flags} ${esc(remote(asDir(source)))} ${esc(asDir(target))}`;
};

// rsync has to exist on both ends, and on this fleet it does not: the server
// and the Linux devices have it, the Termux devices do not ship it in their
// default package set, and the Windows box answers ssh with PowerShell. So
// this probes instead of assuming, and every device that fails the probe keeps
// the scp stage-delete-move path unchanged.
//
// A probe rather than a per-device config flag: it costs one round trip
// against a whole transfer, there is nothing to keep in sync when a device
// gains rsync, and a probe that itself fails degrades to the path that already
// worked rather than to a broken sync.
// The probe runs the transfer's own flags rather than asking whether the
// binary exists: `command -v rsync` passes on an rsync too old for these
// options (the 2.6.9 Apple still ships, for one) and the transfer would then
// die on an unknown option instead of taking the scp path that works. Built
// from RSYNC_FLAGS, not a copy of it, so a flag can never be added to the
// transfer without the probe starting to require it.
const RSYNC_PROBE = `rsync ${RSYNC_FLAGS.join(" ")} --version >/dev/null`;

const canUseRsync = async (device: EmuDevice, jobId?: string) => {
    if (device.os === EmuOs.windows) {
        await appendJobLog(jobId, "RSYNC: windows device, using scp");
        return false;
    }
    const usable = async (cmd: string) => {
        try {
            await createCmd(cmd, jobId);
            return true;
        } catch {
            return false;
        }
    };
    if (!(await usable(RSYNC_PROBE))) {
        await appendJobLog(jobId, "RSYNC: unusable on the server, using scp");
        return false;
    }
    if (!(await usable(buildSshCommand(device, RSYNC_PROBE)))) {
        await appendJobLog(
            jobId,
            `RSYNC: unusable on ${device.name}, using scp`,
        );
        return false;
    }
    return true;
};

export const connectionTest = async (device: EmuDevice) => {
    if (device.syncType === SyncType.ftp) {
        const client = new FtpClient();
        try {
            await client.access({
                host: device.ip,
                port: device.port,
                user: device.user,
                password: device.password,
                secure: false,
            });
            // Simple no-op that confirms connection works
            void client.close();
            return true;
        } catch (e) {
            console.error("Failed to connect to device via ftp", e);
            try {
                client.close();
            } catch (closeErr) {
                void closeErr;
            }
            return false;
        }
    } else {
        const testCmd = buildSshCommand(device, "echo hello_emusync");
        try {
            await createCmd(testCmd);
            return true;
        } catch (e) {
            console.error("Failed to connect to device via ssh", e);
        }
        return false;
    }
};

const runCommands = async (commands: string[], jobId?: string) => {
    for (const cmd of commands) {
        await createCmd(cmd, jobId);
    }
};

export const pushPairs = async (
    device: EmuDevice,
    serverPairs: SyncPair[],
    jobId?: string,
) => {
    if (device.syncType === SyncType.ftp) {
        const client = new FtpClient();
        client.ftp.verbose = true;
        try {
            await client.access({
                host: device.ip,
                user: device.user,
                port: device.port,
                password: device.password,
                secure: false,
            });
            for (const { source, target } of serverPairs) {
                await client.ensureDir(device.workDir);
                await client.clearWorkingDir();
                await client.uploadFromDir(source);
                await client.removeDir(target);
                await client.rename(device.workDir, target);
            }
        } catch (e) {
            const message = (e as Error)?.message ?? String(e);
            console.error(e);
            await appendJobLog(jobId, `FTP ERROR: ${message}`);
            // Rethrow: swallowing this reported a half-completed device swap
            // as a successful sync.
            throw e;
        } finally {
            client.close();
        }
    } else if (await canUseRsync(device, jobId)) {
        // No workDir, no delete step: rsync updates the target in place, so
        // there is never a moment where the target is gone and the only copy
        // is sitting in a staging directory the next run wipes first.
        await runCommands(
            serverPairs.map(({ source, target }) =>
                buildRsyncCommand(device, source, target, true),
            ),
            jobId,
        );
    } else {
        const isWindows = device.os === EmuOs.windows;
        const setupCmds = [
            buildSshCommand(
                device,
                buildRm(esc(device.workDir, isWindows), isWindows),
            ),
            buildSshCommand(device, `mkdir ${esc(device.workDir, isWindows)}`),
        ];
        // Stage, delete and move one pair at a time. Batching every delete
        // ahead of every move meant one failed move left several target
        // directories already deleted, with the only copies sitting in the
        // workDir that the next run wipes first.
        // Every path that reaches a shell is escaped, including workDir: it is
        // operator-supplied and lands in an rm -rf.
        const perPairCmds = serverPairs.flatMap(({ source, target }) => [
            buildScpCommand(
                device,
                esc(source),
                esc(device.workDir, isWindows),
                true,
            ),
            buildSshCommand(device, buildRm(esc(target, isWindows), isWindows)),
            buildSshCommand(
                device,
                `mv ${esc(
                    `${device.workDir}/${getFolderName(source)}`,
                    isWindows,
                )} ${esc(target, isWindows)}`,
            ),
        ]);

        await runCommands([...setupCmds, ...perPairCmds], jobId);
    }
};

export const pullPairs = async (
    device: EmuDevice,
    serverPairs: SyncPair[],
    serverInfo: EmuServer,
    jobId?: string,
) => {
    if (device.syncType === SyncType.ftp) {
        const client = new FtpClient();
        client.ftp.verbose = true;
        try {
            await client.access({
                host: device.ip,
                user: device.user,
                port: device.port,
                password: device.password,
                secure: false,
            });
            const workDir = esc(serverInfo.workDir);
            for (const { source, target } of serverPairs) {
                // The move below consumes workDir, so re-create it per pair.
                await createCmd(`rm -rf ${workDir}`, jobId);
                await createCmd(`mkdir -p ${workDir}`, jobId);
                // cd, not ensureDir: ensureDir CREATES a missing remote
                // directory, so a stale source path used to yield an empty
                // download that then replaced the canonical store.
                await client.cd(source);
                await client.downloadToDir(serverInfo.workDir);
                const downloaded = await fs.readdir(serverInfo.workDir);
                if (downloaded.length === 0) {
                    throw new Error(
                        `Refusing to replace ${target}: downloaded nothing from ${source}`,
                    );
                }
                await createCmd(`rm -rf ${esc(target)}`, jobId);
                await createCmd(`mv ${workDir} ${esc(target)}`, jobId);
            }
        } catch (e) {
            const message = (e as Error)?.message ?? String(e);
            console.error(e);
            await appendJobLog(jobId, `FTP ERROR: ${message}`);
            // Rethrow: swallowing this reported a failed pull as a success.
            throw e;
        } finally {
            client.close();
        }
    } else if (await canUseRsync(device, jobId)) {
        // serverInfo.workDir is untouched on this path — see pushPairs. That
        // also removes the reason pulls cannot overlap, but the single-job
        // lock stays: the scp path below still stages through it.
        await runCommands(
            serverPairs.map(({ source, target }) =>
                buildRsyncCommand(device, source, target, false),
            ),
            jobId,
        );
    } else {
        const isWindows = device.os === EmuOs.windows;
        // workDir is escaped here too: it reaches an rm -rf, and leaving it
        // bare made a path containing a space delete the wrong directory.
        const workDir = esc(serverInfo.workDir);
        const setupCmds = [`rm -rf ${workDir}`, `mkdir -p ${workDir}`];

        // One pair at a time — see the note in pushPairs.
        const perPairCmds = serverPairs.flatMap(({ source, target }) => [
            buildScpCommand(device, esc(source, isWindows), workDir, false),
            `rm -rf ${esc(target)}`,
            `mv ${workDir}/${getFolderName(source)} ${esc(target)}`,
        ]);

        await runCommands([...setupCmds, ...perPairCmds], jobId);
    }
};
