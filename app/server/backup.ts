import { spawn } from "child_process";
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

export const createCmd = async (
    cmd: string,
    isSftp: boolean = false,
    jobId?: string,
) => {
    const p = spawn("bash", ["-c", cmd]);
    let failed = false;
    let settled = false;
    console.log(`?: ${cmd}`);

    // Attach all handlers synchronously: a fast command can exit before any
    // await completes, and an unobserved exit event would hang the job.
    const done = new Promise((resolve, reject) => {
        const rejectOnce = (err: unknown) => {
            if (settled) return;
            settled = true;
            reject(err);
        };

        const resolveOnce = (value: unknown) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        p.stdout.on("data", (x) => {
            const msg = x.toString();
            // process.stdout.write(`STDOUT: ${msg}`);
            void appendJobLog(jobId, `STDOUT: ${msg.trimEnd()}`);
        });

        p.stderr.on("data", (buf) => {
            const msg = buf.toString();
            const shouldFail = !isSftp || msg.includes("Connection closed");
            if (shouldFail) {
                failed = true;
            }

            // process.stderr.write(`STDERR: ${msg}`);
            void appendJobLog(jobId, `STDERR: ${msg.trimEnd()}`);

            if (shouldFail) {
                rejectOnce(new Error("Failure in command"));
            }
        });

        p.on("exit", (code) => {
            const exitCode = code ?? 0;
            if (failed) {
                console.error(`N: ${cmd}\n`);
                void appendJobLog(
                    jobId,
                    `EXIT: ${code ?? "unknown"} (failure)`,
                );
                rejectOnce(exitCode);
            } else if (exitCode === 0) {
                console.log(`Y: ${cmd}\n`);
                void appendJobLog(jobId, `EXIT: ${exitCode} (ok)`);
                resolveOnce(exitCode);
            } else {
                console.log(`~: ${cmd}\n`);
                void appendJobLog(jobId, `EXIT: ${exitCode} (non-zero)`);
                resolveOnce(exitCode);
            }
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
            console.error(e);
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
        const copyToDeviceCmds: string[] = [];
        const deleteOldSavesOnDeviceCmds: string[] = [];
        const moveNewSavesOnDeviceCmds: string[] = [];

        serverPairs.forEach(({ source, target }) => {
            copyToDeviceCmds.push(
                buildScpCommand(device, source, device.workDir, true),
            );
            deleteOldSavesOnDeviceCmds.push(
                buildSshCommand(
                    device,
                    buildRm(esc(target, isWindows), isWindows),
                ),
            );
            moveNewSavesOnDeviceCmds.push(
                buildSshCommand(
                    device,
                    `mv ${device.workDir}/${getFolderName(source)} ${esc(target, isWindows)}`,
                ),
            );
        });

        const commands = [
            ...setupCmds,
            ...copyToDeviceCmds,
            ...deleteOldSavesOnDeviceCmds,
            ...moveNewSavesOnDeviceCmds,
        ];

        for (const cmd of commands) {
            await createCmd(cmd, false, jobId);
        }
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
            const setupCmds = [
                `rm -rf ${serverInfo.workDir}`,
                `mkdir ${serverInfo.workDir}`,
            ];
            for (const cmd of setupCmds) {
                await createCmd(cmd, false, jobId);
            }
            for (const { source, target } of serverPairs) {
                await client.ensureDir(source);
                await client.downloadToDir(serverInfo.workDir);
                await createCmd(`rm -rf ${target}`, false, jobId);
                await createCmd(
                    `mv ${serverInfo.workDir} ${target}`,
                    false,
                    jobId,
                );
            }
        } catch (e) {
            console.error(e);
        } finally {
            client.close();
        }
    } else {
        const isWindows = device.os === EmuOs.windows;
        const setupCmds = [
            `rm -rf ${serverInfo.workDir}`,
            `mkdir ${serverInfo.workDir}`,
        ];
        const copyToServerCmds: string[] = [];
        const deleteOldSavesOnServerCmds: string[] = [];
        const moveNewSavesOnServerCmds: string[] = [];

        serverPairs.forEach(({ source, target }) => {
            copyToServerCmds.push(
                buildScpCommand(
                    device,
                    esc(source, isWindows),
                    serverInfo.workDir,
                    false,
                ),
            );
            deleteOldSavesOnServerCmds.push(`rm -rf ${esc(target)}`);
            moveNewSavesOnServerCmds.push(
                `mv ${serverInfo.workDir}/${getFolderName(source)} ${esc(target)}`,
            );
        });

        const commands = [
            ...setupCmds,
            ...copyToServerCmds,
            ...deleteOldSavesOnServerCmds,
            ...moveNewSavesOnServerCmds,
        ];

        for (const cmd of commands) {
            await createCmd(cmd, false, jobId);
        }
    }
};
