import { useEffect, useRef, useState } from "react";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { useDevices } from "~/contexts/DeviceContext";
import type { EmulatorAction } from "~/types/emulatorAction";
import type { DeviceSyncRequest, DeviceSyncResponse } from "~/types/device";
import { SyncStatus } from "~/types/device";
import { capitalize } from "~/utilities/utils";

// One bad response should not abandon a running job, but the UI must not
// pretend to be watching forever either.
const MAX_POLL_FAILURES = 3;

function TerminalLoader() {
    return (
        <Box
            sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 1,
            }}
        >
            {[0, 1, 2].map((i) => (
                <Box
                    key={i}
                    sx={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        backgroundColor: "#f6c177",
                        animation: "loader-bounce 1.2s ease-in-out infinite",
                        animationDelay: `${i * 0.2}s`,
                        "@keyframes loader-bounce": {
                            "0%, 100%": {
                                transform: "scale(0.8)",
                                opacity: 0.4,
                            },
                            "50%": {
                                transform: "scale(1)",
                                opacity: 1,
                                boxShadow: "0 0 10px rgba(246, 193, 119, 0.6)",
                            },
                        },
                    }}
                />
            ))}
        </Box>
    );
}

export function EmulatorActionForm() {
    const {
        devices,
        selectedDevice,
        emulatorActions,
        setEmulatorActions,
        deviceSyncResponse,
        setDeviceSyncResponse,
        requestInProgress,
        setRequestInProgress,
    } = useDevices();

    const outputRef = useRef<HTMLPreElement | null>(null);
    // Anything that stops a sync from being observed: a rejected POST, a
    // conflicting job, or polling losing contact. Previously all of these were
    // console.error only, so a failed request looked exactly like a click that
    // never registered.
    const [syncError, setSyncError] = useState<string | null>(null);

    const selectedDeviceData = devices.find(
        (device) => device.name === selectedDevice,
    );

    // Device switching is intentionally allowed mid-sync (gating it on
    // requestInProgress is what used to make the UI unrecoverable). That means
    // an in-flight POST or poll can resolve after the selection moved on, so
    // every async write below is guarded against landing on the wrong device.
    // Matching on device name alone is not enough: going Alpha -> Beta -> Alpha
    // and submitting again would revalidate the abandoned first request. A
    // generation bumped on every submit and every selection change identifies
    // exactly one live request.
    // Every async write below — POST and poll alike — is checked against it,
    // rather than against effect lifetime: the poll effect does not depend on
    // selectedDevice, so a switch does not tear it down, and unmounting the
    // form (deselecting the card) tears down no POST at all.
    const requestGenRef = useRef(0);
    useEffect(() => {
        requestGenRef.current += 1;
        return () => {
            requestGenRef.current += 1;
        };
    }, [selectedDevice]);

    useEffect(() => {
        if (selectedDeviceData) {
            const defaultActions: { [key: string]: EmulatorAction } = {};
            selectedDeviceData.emulatorsEnabled.forEach((emulator) => {
                defaultActions[emulator] = "ignore";
            });
            setEmulatorActions(defaultActions);
        }
        setDeviceSyncResponse(null);
        setRequestInProgress(false);
        setSyncError(null);
    }, [
        selectedDeviceData,
        setDeviceSyncResponse,
        setEmulatorActions,
        setRequestInProgress,
    ]);

    const handleActionChange = (emulator: string, action: EmulatorAction) => {
        setEmulatorActions({
            ...emulatorActions,
            [emulator]: action,
        });
    };

    const handleSubmit = async () => {
        const requestedDevice = selectedDeviceData!.name;
        const payload: DeviceSyncRequest = {
            deviceName: requestedDevice,
            emulatorActions: Object.entries(emulatorActions)
                .filter(([, action]) => action !== "ignore")
                .map(([emulator, action]) => ({ emulator, action })),
        };
        const generation = ++requestGenRef.current;
        const isCurrent = () => requestGenRef.current === generation;

        try {
            setDeviceSyncResponse(null);
            setSyncError(null);
            setRequestInProgress(true);
            const res = await fetch("/api/device-sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                // The server explains itself (409 names the in-flight job, 404
                // an unknown device); show that rather than a bare status.
                const detail = await res
                    .json()
                    .then((body) => (body as { error?: string }).error)
                    .catch(() => undefined);
                throw new Error(
                    detail ?? `Request failed (HTTP ${res.status})`,
                );
            }
            const data = (await res.json()) as DeviceSyncResponse;
            // The job is running server-side either way; only the display is
            // dropped if the user has moved to another device.
            if (!isCurrent()) return;
            setDeviceSyncResponse(data);
        } catch (err) {
            console.error("Failed to request device sync", err);
            if (!isCurrent()) return;
            setSyncError(
                err instanceof Error ? err.message : "Failed to start sync",
            );
            setRequestInProgress(false);
        }
    };

    // Deselecting the card unmounts this form. Nothing is left to observe the
    // job, so leaving the shared flag set would grey out every device card.
    useEffect(() => () => setRequestInProgress(false), [setRequestInProgress]);

    useEffect(() => {
        if (
            deviceSyncResponse &&
            deviceSyncResponse.deviceSyncRecord.status ===
                SyncStatus.IN_PROGRESS
        ) {
            const id = deviceSyncResponse.id;
            // A poll issued before the user switched devices (or before this
            // effect was torn down) must not write into the new selection.
            // Both conditions are needed: this effect keys on the response, so
            // a device switch alone does not run its cleanup.
            const generation = requestGenRef.current;
            let cancelled = false;
            // Overlapping polls also need ordering: once one of them has seen a
            // terminal status, a slower sibling's failure must not paint "lost
            // contact" over a job that finished.
            let settled = false;
            const stale = () =>
                cancelled || settled || requestGenRef.current !== generation;
            let consecutiveFailures = 0;
            const interval = setInterval(async () => {
                try {
                    const res = await fetch(`/api/device-sync/${id}`);
                    if (!res.ok) {
                        throw new Error(`HTTP ${res.status}`);
                    }
                    const data = (await res.json()) as DeviceSyncResponse;
                    if (stale()) return;
                    setDeviceSyncResponse(data);
                    // Polls overlap, so a slow success can land after a faster
                    // failure; a recovered poll must retract the stale alert.
                    consecutiveFailures = 0;
                    setSyncError(null);
                    if (
                        data.deviceSyncRecord.status !== SyncStatus.IN_PROGRESS
                    ) {
                        settled = true;
                        clearInterval(interval);
                    } else {
                        // The failure that cleared this flag may have been the
                        // overlapping poll we just recovered from; the job is
                        // demonstrably still running, so re-arm the UI.
                        setRequestInProgress(true);
                    }
                } catch (e) {
                    if (stale()) return;
                    console.error("Polling device sync failed", e);
                    // An expired record will not come back; anything else may
                    // be one bad response, so keep watching for a few rounds
                    // rather than abandoning a running job on a blip.
                    const expired =
                        e instanceof Error && e.message.includes("404");
                    consecutiveFailures += 1;
                    const givingUp =
                        expired || consecutiveFailures >= MAX_POLL_FAILURES;
                    setSyncError(
                        expired
                            ? "Lost track of this sync job — its record expired. The sync may still be running on the server; check the device before retrying."
                            : `Lost contact with the sync job: ${
                                  e instanceof Error ? e.message : String(e)
                              }${
                                  givingUp
                                      ? " — stopped watching it. The sync may still be running on the server."
                                      : " — retrying."
                              }`,
                    );
                    if (givingUp) {
                        // Not settled: a poll still in flight may yet answer,
                        // and it is allowed to take the controls back. Leaving
                        // this flag set was the original bug — Execute, Reset
                        // and device selection stayed disabled forever, with a
                        // page reload the only way out.
                        clearInterval(interval);
                        setRequestInProgress(false);
                    }
                }
            }, 3000);
            return () => {
                cancelled = true;
                clearInterval(interval);
            };
        }
    }, [deviceSyncResponse, setDeviceSyncResponse, setRequestInProgress]);

    useEffect(() => {
        if (!deviceSyncResponse) return;
        if (
            deviceSyncResponse.deviceSyncRecord.status !==
            SyncStatus.IN_PROGRESS
        ) {
            setRequestInProgress(false);
        }
    }, [deviceSyncResponse, setRequestInProgress]);

    useEffect(() => {
        if (!outputRef.current) return;
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }, [deviceSyncResponse?.deviceSyncRecord.output?.length]);

    if (!selectedDevice || !selectedDeviceData) {
        return null;
    }

    const hasActions = selectedDeviceData.emulatorsEnabled.some(
        (emu) =>
            emulatorActions[emu] === "push" || emulatorActions[emu] === "pull",
    );
    const isActionDisabled = requestInProgress || !hasActions;
    // Reset stays available whenever nothing is actually running. Gating it on
    // the last status alone meant a job whose polling died left Reset disabled
    // with no running sync behind it.
    const isResetDisabled =
        requestInProgress || (!deviceSyncResponse && !syncError);
    const statusColor = deviceSyncResponse
        ? deviceSyncResponse.deviceSyncRecord.status === SyncStatus.IN_PROGRESS
            ? "#f6c177"
            : deviceSyncResponse.deviceSyncRecord.status === SyncStatus.COMPLETE
              ? "#4fd1c5"
              : "#f28fad"
        : "#7aa2f7";

    return (
        <Box
            sx={{
                mt: 4,
                border: "1px solid rgba(122, 162, 247, 0.2)",
                borderRadius: "18px",
                backgroundColor: "rgba(17, 24, 37, 0.84)",
                boxShadow: "0 18px 40px rgba(6, 9, 16, 0.35)",
                position: "relative",
                overflow: "hidden",
            }}
        >
            <Box
                sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: "2px",
                    background:
                        "linear-gradient(90deg, transparent 0%, rgba(79, 209, 197, 0.7) 30%, rgba(122, 162, 247, 0.7) 70%, transparent 100%)",
                }}
            />

            <Box
                sx={{
                    px: 3,
                    py: 2,
                    borderBottom: "1px solid rgba(122, 162, 247, 0.2)",
                    backgroundColor: "rgba(12, 16, 27, 0.6)",
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                }}
            >
                <Typography
                    variant="caption"
                    sx={{
                        color: "#7aa2f7",
                        letterSpacing: "0.2em",
                        fontSize: "0.65rem",
                    }}
                >
                    CONFIGURATION
                </Typography>
                <Typography
                    sx={{
                        fontSize: "1rem",
                        fontWeight: 600,
                        letterSpacing: "0.02em",
                    }}
                >
                    Sync actions
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Typography
                    sx={{
                        color: "text.secondary",
                        fontSize: "0.75rem",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                    }}
                >
                    {selectedDeviceData.name}
                </Typography>
            </Box>

            <Box sx={{ p: { xs: 2.5, md: 3 } }}>
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 3,
                    }}
                >
                    <Box
                        sx={{
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            backgroundColor: "#7aa2f7",
                        }}
                    />
                    <Typography
                        sx={{
                            color: "text.secondary",
                            fontSize: "0.85rem",
                        }}
                    >
                        Configure sync behavior for each emulator before running
                        the transfer.
                    </Typography>
                </Box>

                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                    }}
                >
                    {selectedDeviceData.emulatorsEnabled.map((emulator) => {
                        const indicatorColor =
                            emulatorActions[emulator] === "ignore"
                                ? "rgba(169, 178, 199, 0.5)"
                                : emulatorActions[emulator] === "push"
                                  ? "#f6c177"
                                  : "#7aa2f7";
                        const actionColors = {
                            ignore: {
                                border: "rgba(169, 178, 199, 0.4)",
                                bg: "rgba(169, 178, 199, 0.12)",
                                color: "#a9b2c7",
                                shadow: "rgba(169, 178, 199, 0.2)",
                            },
                            push: {
                                border: "rgba(246, 193, 119, 0.6)",
                                bg: "rgba(246, 193, 119, 0.18)",
                                color: "#f6c177",
                                shadow: "rgba(246, 193, 119, 0.35)",
                            },
                            pull: {
                                border: "rgba(122, 162, 247, 0.6)",
                                bg: "rgba(122, 162, 247, 0.18)",
                                color: "#7aa2f7",
                                shadow: "rgba(122, 162, 247, 0.35)",
                            },
                        };

                        return (
                            <Box
                                key={emulator}
                                sx={{
                                    display: "flex",
                                    flexDirection: { xs: "column", sm: "row" },
                                    alignItems: {
                                        xs: "stretch",
                                        sm: "center",
                                    },
                                    gap: 2,
                                    p: 2,
                                    borderRadius: "14px",
                                    backgroundColor: "rgba(10, 14, 22, 0.6)",
                                    border: "1px solid rgba(122, 162, 247, 0.15)",
                                }}
                            >
                                <Box
                                    sx={{
                                        minWidth: 140,
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1.2,
                                    }}
                                >
                                    <Box
                                        sx={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: 999,
                                            backgroundColor: indicatorColor,
                                            boxShadow:
                                                indicatorColor ===
                                                "rgba(169, 178, 199, 0.5)"
                                                    ? "none"
                                                    : `0 0 12px ${indicatorColor}`,
                                        }}
                                    />
                                    <Typography
                                        sx={{
                                            color:
                                                emulatorActions[emulator] ===
                                                "ignore"
                                                    ? "text.secondary"
                                                    : "text.primary",
                                            fontSize: "0.8rem",
                                            fontWeight: 600,
                                            letterSpacing: "0.06em",
                                            textTransform: "uppercase",
                                        }}
                                    >
                                        {capitalize(emulator)}
                                    </Typography>
                                </Box>

                                <Box
                                    sx={{
                                        display: "flex",
                                        gap: 1,
                                        flexWrap: "wrap",
                                    }}
                                >
                                    {(
                                        [
                                            "ignore",
                                            "push",
                                            "pull",
                                        ] as EmulatorAction[]
                                    ).map((action) => {
                                        const isSelected =
                                            emulatorActions[emulator] ===
                                            action;
                                        const colors = actionColors[action];

                                        return (
                                            <Box
                                                key={action}
                                                onClick={() =>
                                                    handleActionChange(
                                                        emulator,
                                                        action,
                                                    )
                                                }
                                                sx={{
                                                    px: 2,
                                                    py: 0.7,
                                                    cursor: "pointer",
                                                    borderRadius: 999,
                                                    border: "1px solid",
                                                    borderColor: isSelected
                                                        ? colors.border
                                                        : "rgba(122, 162, 247, 0.2)",
                                                    backgroundColor: isSelected
                                                        ? colors.bg
                                                        : "rgba(12, 16, 27, 0.4)",
                                                    color: isSelected
                                                        ? colors.color
                                                        : "text.secondary",
                                                    fontSize: "0.7rem",
                                                    fontWeight: 600,
                                                    letterSpacing: "0.12em",
                                                    textTransform: "uppercase",
                                                    transition: "all 0.2s ease",
                                                    "&:hover": {
                                                        borderColor:
                                                            colors.border,
                                                        backgroundColor:
                                                            colors.bg,
                                                        color: colors.color,
                                                    },
                                                    ...(isSelected && {
                                                        boxShadow: `0 10px 22px ${colors.shadow}`,
                                                    }),
                                                }}
                                            >
                                                {action}
                                            </Box>
                                        );
                                    })}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>

                <Box
                    sx={{
                        my: 3,
                        height: "1px",
                        background:
                            "linear-gradient(90deg, transparent 0%, rgba(122, 162, 247, 0.3) 50%, transparent 100%)",
                    }}
                />

                <Box
                    sx={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 1.5,
                        flexWrap: "wrap",
                    }}
                >
                    <Box
                        component="button"
                        onClick={() => {
                            const resetActions: {
                                [key: string]: EmulatorAction;
                            } = {};
                            selectedDeviceData.emulatorsEnabled.forEach(
                                (emulator) => {
                                    resetActions[emulator] = "ignore";
                                },
                            );
                            // Anything still in flight belongs to the state the
                            // user just cleared; invalidate it now so it cannot
                            // repopulate the form.
                            requestGenRef.current += 1;
                            setEmulatorActions(resetActions);
                            setDeviceSyncResponse(null);
                            setSyncError(null);
                        }}
                        disabled={isResetDisabled}
                        sx={{
                            px: 2.5,
                            py: 1,
                            borderRadius: 999,
                            border: "1px solid",
                            borderColor: isResetDisabled
                                ? "rgba(122, 162, 247, 0.15)"
                                : "rgba(122, 162, 247, 0.35)",
                            backgroundColor: "rgba(122, 162, 247, 0.08)",
                            color: isResetDisabled
                                ? "rgba(169, 178, 199, 0.5)"
                                : "text.secondary",
                            fontSize: "0.75rem",
                            fontFamily: '"Commissioner", sans-serif',
                            fontWeight: 600,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            cursor: isResetDisabled ? "not-allowed" : "pointer",
                            transition: "all 0.2s ease",
                            "&:hover:not(:disabled)": {
                                borderColor: "rgba(79, 209, 197, 0.5)",
                                color: "#eef1f7",
                            },
                        }}
                    >
                        Reset
                    </Box>
                    <Box
                        component="button"
                        onClick={handleSubmit}
                        disabled={isActionDisabled}
                        sx={{
                            px: 3,
                            py: 1,
                            borderRadius: 999,
                            border: "1px solid",
                            borderColor: isActionDisabled
                                ? "rgba(122, 162, 247, 0.15)"
                                : "rgba(246, 193, 119, 0.6)",
                            backgroundImage: isActionDisabled
                                ? "none"
                                : "linear-gradient(135deg, #f6c177 0%, #f28fad 100%)",
                            backgroundColor: isActionDisabled
                                ? "rgba(122, 162, 247, 0.08)"
                                : undefined,
                            color: isActionDisabled
                                ? "rgba(169, 178, 199, 0.6)"
                                : "#0b0f17",
                            fontSize: "0.8rem",
                            fontFamily: '"Commissioner", sans-serif',
                            fontWeight: 700,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            cursor: isActionDisabled
                                ? "not-allowed"
                                : "pointer",
                            transition: "all 0.2s ease",
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            boxShadow: isActionDisabled
                                ? "none"
                                : "0 12px 28px rgba(246, 193, 119, 0.35)",
                            "&:hover:not(:disabled)": {
                                transform: "translateY(-1px)",
                                boxShadow:
                                    "0 16px 32px rgba(246, 193, 119, 0.45)",
                            },
                        }}
                    >
                        {requestInProgress ? (
                            <>
                                <TerminalLoader />
                                <span>Syncing</span>
                            </>
                        ) : (
                            "Execute Sync"
                        )}
                    </Box>
                </Box>

                {syncError && (
                    <Box
                        role="alert"
                        sx={{
                            mt: 2.5,
                            px: 2,
                            py: 1.5,
                            borderRadius: "12px",
                            border: "1px solid rgba(242, 143, 173, 0.5)",
                            backgroundColor: "rgba(242, 143, 173, 0.12)",
                            color: "#f28fad",
                            fontSize: "0.8rem",
                        }}
                    >
                        {syncError}
                    </Box>
                )}
            </Box>

            {deviceSyncResponse && (
                <Box
                    sx={{
                        borderTop: "1px solid rgba(122, 162, 247, 0.2)",
                        backgroundColor: "rgba(10, 14, 22, 0.6)",
                    }}
                >
                    <Box
                        sx={{
                            px: 3,
                            py: 1.6,
                            borderBottom: "1px solid rgba(122, 162, 247, 0.2)",
                            display: "flex",
                            alignItems: "center",
                            gap: 2,
                        }}
                    >
                        <Typography
                            variant="caption"
                            sx={{
                                color: "#7aa2f7",
                                letterSpacing: "0.2em",
                                fontSize: "0.6rem",
                            }}
                        >
                            RESPONSE
                        </Typography>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                            }}
                        >
                            <Box
                                sx={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 999,
                                    backgroundColor: statusColor,
                                    boxShadow: `0 0 12px ${statusColor}66`,
                                    animation:
                                        deviceSyncResponse.deviceSyncRecord
                                            .status === SyncStatus.IN_PROGRESS
                                            ? "pulse-glow 1s ease-in-out infinite"
                                            : "none",
                                    "@keyframes pulse-glow": {
                                        "0%, 100%": { opacity: 1 },
                                        "50%": { opacity: 0.5 },
                                    },
                                }}
                            />
                            <Typography
                                sx={{
                                    fontSize: "0.75rem",
                                    fontWeight: 700,
                                    letterSpacing: "0.12em",
                                    color: statusColor,
                                }}
                            >
                                {deviceSyncResponse.deviceSyncRecord.status}
                            </Typography>
                        </Box>
                        <Box sx={{ flexGrow: 1 }} />
                        <Typography
                            sx={{
                                color: "text.secondary",
                                fontSize: "0.65rem",
                                fontFamily: '"Fragment Mono", monospace',
                            }}
                        >
                            ID: {deviceSyncResponse.id}
                        </Typography>
                    </Box>

                    <Box sx={{ p: { xs: 2.5, md: 3 } }}>
                        <Box sx={{ mb: 2.5 }}>
                            <Typography
                                variant="caption"
                                sx={{
                                    color: "#7aa2f7",
                                    fontSize: "0.6rem",
                                    letterSpacing: "0.2em",
                                    display: "block",
                                    mb: 1,
                                }}
                            >
                                EXECUTED ACTIONS
                            </Typography>
                            <Box
                                sx={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 1,
                                }}
                            >
                                {deviceSyncResponse.deviceSyncRecord.deviceSyncRequest.emulatorActions.map(
                                    (item) => (
                                        <Box
                                            key={item.emulator}
                                            sx={{
                                                px: 1.5,
                                                py: 0.6,
                                                borderRadius: 999,
                                                border: "1px solid",
                                                borderColor:
                                                    item.action === "push"
                                                        ? "rgba(246, 193, 119, 0.6)"
                                                        : "rgba(122, 162, 247, 0.6)",
                                                color:
                                                    item.action === "push"
                                                        ? "#f6c177"
                                                        : "#7aa2f7",
                                                fontSize: "0.65rem",
                                                fontWeight: 600,
                                                letterSpacing: "0.08em",
                                                textTransform: "uppercase",
                                                backgroundColor:
                                                    item.action === "push"
                                                        ? "rgba(246, 193, 119, 0.12)"
                                                        : "rgba(122, 162, 247, 0.12)",
                                            }}
                                        >
                                            {capitalize(item.emulator)}:{" "}
                                            {item.action.toUpperCase()}
                                        </Box>
                                    ),
                                )}
                            </Box>
                        </Box>

                        {deviceSyncResponse.deviceSyncRecord.output?.length ? (
                            <Box>
                                <Typography
                                    variant="caption"
                                    sx={{
                                        color: "#7aa2f7",
                                        fontSize: "0.6rem",
                                        letterSpacing: "0.2em",
                                        display: "block",
                                        mb: 1,
                                    }}
                                >
                                    OUTPUT
                                </Typography>
                                <Box
                                    component="pre"
                                    ref={outputRef}
                                    sx={{
                                        m: 0,
                                        p: 2,
                                        borderRadius: "12px",
                                        backgroundColor:
                                            "rgba(9, 12, 19, 0.75)",
                                        border: "1px solid rgba(122, 162, 247, 0.2)",
                                        fontSize: "0.75rem",
                                        fontFamily:
                                            '"Fragment Mono", monospace',
                                        lineHeight: 1.7,
                                        color: "#eef1f7",
                                        overflowX: "auto",
                                        maxHeight: 300,
                                        "&::-webkit-scrollbar": {
                                            width: 6,
                                            height: 6,
                                        },
                                        "&::-webkit-scrollbar-track": {
                                            backgroundColor: "#0b0f17",
                                        },
                                        "&::-webkit-scrollbar-thumb": {
                                            backgroundColor:
                                                "rgba(122, 162, 247, 0.35)",
                                        },
                                    }}
                                >
                                    {deviceSyncResponse.deviceSyncRecord.output.join(
                                        "\n",
                                    )}
                                </Box>
                            </Box>
                        ) : null}
                    </Box>
                </Box>
            )}
        </Box>
    );
}
