import { spawn } from "child_process";
import fs from "node:fs/promises";
import type { EmuDevice, SyncPair, EmuServer, DeviceSyncRecord } from "./types";
import { SyncType, EmuOs } from "./types";
import { Client as FtpClient } from "basic-ftp";
import { getFolderName } from "./utility";
import { getJSON, setJSON } from "./redis";

const esc = (s: string, isWindows: boolean = false): string => {
    if (isWindows) {
        return `"${s}"`;
    }
    return s.replace(/ /g, "\\ ");
};

const buildRm = (path: string, isWindows: boolean = false): string => {
    if (isWindows) {
        return `if (Test-Path -Path ${path} -PathType Container) { rm -r ${path} }`;
    }
    return `rm -rf ${path}`;
};

const appendJobLog = async (jobId: string | undefined, line: string) => {
    if (!jobId) return;
    try {
        const rec = await getJSON<DeviceSyncRecord>(jobId);
        if (!rec) return;
        rec.output.push(line);
        await setJSON(jobId, rec);
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
    } else {
        const isWindows = device.os === EmuOs.windows;
        const setupCmds = [
            buildSshCommand(
                device,
                buildRm(esc(device.workDir, isWindows), isWindows),
            ),
            buildSshCommand(device, `mkdir ${device.workDir}`),
        ];
        // Stage, delete and move one pair at a time. Batching every delete
        // ahead of every move meant one failed move left several target
        // directories already deleted, with the only copies sitting in the
        // workDir that the next run wipes first.
        const perPairCmds = serverPairs.flatMap(({ source, target }) => [
            buildScpCommand(device, source, device.workDir, true),
            buildSshCommand(device, buildRm(esc(target, isWindows), isWindows)),
            buildSshCommand(
                device,
                `mv ${device.workDir}/${getFolderName(source)} ${esc(target, isWindows)}`,
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
