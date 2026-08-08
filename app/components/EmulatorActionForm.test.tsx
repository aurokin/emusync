import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { EmulatorActionForm } from "~/components/EmulatorActionForm";
import { SyncStatus } from "~/types/device";

const useDevicesMock = vi.fn();

vi.mock("~/contexts/DeviceContext", () => ({
    useDevices: () => useDevicesMock(),
}));

const baseDevices = [
    {
        name: "Alpha",
        os: "linux",
        emulatorsEnabled: ["dolphin", "cemu"],
    },
];

const buildContext = (
    overrides: Partial<ReturnType<typeof useDevicesMock>> = {},
) => ({
    devices: baseDevices,
    loading: false,
    error: null,
    selectedDevice: "Alpha",
    setSelectedDevice: vi.fn(),
    emulatorActions: { dolphin: "ignore", cemu: "ignore" },
    setEmulatorActions: vi.fn(),
    deviceSyncResponse: null,
    setDeviceSyncResponse: vi.fn(),
    requestInProgress: false,
    setRequestInProgress: vi.fn(),
    ...overrides,
});

describe("EmulatorActionForm", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        // Several tests spy on setInterval/clearInterval. Without restoring,
        // the spy leaks into later tests and kills waitFor's own poll timer,
        // which makes those tests pass or fail for unrelated reasons.
        vi.restoreAllMocks();
    });

    it("initializes default actions", async () => {
        const setEmulatorActions = vi.fn();
        const setDeviceSyncResponse = vi.fn();
        const setRequestInProgress = vi.fn();

        useDevicesMock.mockReturnValue(
            buildContext({
                emulatorActions: {},
                setEmulatorActions,
                setDeviceSyncResponse,
                setRequestInProgress,
            }),
        );

        render(<EmulatorActionForm />);

        await waitFor(() =>
            expect(setEmulatorActions).toHaveBeenCalledWith({
                dolphin: "ignore",
                cemu: "ignore",
            }),
        );
        expect(setDeviceSyncResponse).toHaveBeenCalledWith(null);
        expect(setRequestInProgress).toHaveBeenCalledWith(false);
    });

    it("updates action selection", () => {
        const setEmulatorActions = vi.fn();
        useDevicesMock.mockReturnValue(buildContext({ setEmulatorActions }));

        render(<EmulatorActionForm />);

        fireEvent.click(screen.getAllByText("push")[0]);

        expect(setEmulatorActions).toHaveBeenLastCalledWith({
            dolphin: "push",
            cemu: "ignore",
        });
    });

    it("submits sync request", async () => {
        const setDeviceSyncResponse = vi.fn();
        const setRequestInProgress = vi.fn();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [
                                { emulator: "dolphin", action: "push" },
                            ],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        useDevicesMock.mockReturnValue(
            buildContext({
                emulatorActions: { dolphin: "push", cemu: "ignore" },
                setDeviceSyncResponse,
                setRequestInProgress,
            }),
        );

        render(<EmulatorActionForm />);

        fireEvent.click(screen.getByText("Execute Sync"));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());

        const [, options] = fetchMock.mock.calls[0];
        const body = JSON.parse(options.body as string);

        expect(body).toEqual({
            deviceName: "Alpha",
            emulatorActions: [{ emulator: "dolphin", action: "push" }],
        });
        expect(setRequestInProgress).toHaveBeenCalledWith(true);
        await waitFor(() =>
            expect(setDeviceSyncResponse).toHaveBeenCalledWith({
                id: "job-1",
                deviceSyncRecord: {
                    deviceSyncRequest: {
                        deviceName: "Alpha",
                        emulatorActions: [
                            { emulator: "dolphin", action: "push" },
                        ],
                    },
                    status: SyncStatus.IN_PROGRESS,
                    output: [],
                },
            }),
        );
    });

    it("polls for status updates", async () => {
        const setDeviceSyncResponse = vi.fn();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.COMPLETE,
                        output: [],
                    },
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        let intervalCallback: (() => void) | undefined;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
        ) => {
            intervalCallback = cb as () => void;
            return 0 as unknown as ReturnType<typeof setInterval>;
        }) as unknown as typeof setInterval);
        vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {
            return undefined as void;
        });

        useDevicesMock.mockReturnValue(
            buildContext({
                deviceSyncResponse: {
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                },
                setDeviceSyncResponse,
            }),
        );

        render(<EmulatorActionForm />);

        await intervalCallback?.();

        await waitFor(() =>
            expect(setDeviceSyncResponse).toHaveBeenCalledWith({
                id: "job-1",
                deviceSyncRecord: {
                    deviceSyncRequest: {
                        deviceName: "Alpha",
                        emulatorActions: [],
                    },
                    status: SyncStatus.COMPLETE,
                    output: [],
                },
            }),
        );
    });

    it("clears request flag when completed", async () => {
        // The mount effect also calls setRequestInProgress(false), so simply
        // asserting "called with false" passes even if the terminal-status
        // effect is deleted. Compare against the IN_PROGRESS case instead:
        // only a terminal status may clear the flag a second time.
        const renderWith = async (status: SyncStatus) => {
            const setRequestInProgress = vi.fn();
            useDevicesMock.mockReturnValue(
                buildContext({
                    deviceSyncResponse: {
                        id: "job-1",
                        deviceSyncRecord: {
                            deviceSyncRequest: {
                                deviceName: "Alpha",
                                emulatorActions: [],
                            },
                            status,
                            output: [],
                        },
                    },
                    requestInProgress: true,
                    setRequestInProgress,
                }),
            );
            const view = render(<EmulatorActionForm />);
            await waitFor(() =>
                expect(setRequestInProgress).toHaveBeenCalledWith(false),
            );
            const clears = setRequestInProgress.mock.calls.filter(
                ([v]) => v === false,
            ).length;
            view.unmount();
            return clears;
        };

        const whileRunning = await renderWith(SyncStatus.IN_PROGRESS);
        const whenComplete = await renderWith(SyncStatus.COMPLETE);

        expect(whenComplete).toBeGreaterThan(whileRunning);
    });

    it("stops polling once the job reaches a terminal status", async () => {
        // The old version stubbed clearInterval to a no-op, so it could never
        // observe whether polling actually stopped.
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.COMPLETE,
                        output: [],
                    },
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        let intervalCallback: (() => void) | undefined;
        const timerId = 1234 as unknown as ReturnType<typeof setInterval>;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
        ) => {
            intervalCallback = cb as () => void;
            return timerId;
        }) as unknown as typeof setInterval);
        const clearSpy = vi
            .spyOn(globalThis, "clearInterval")
            .mockImplementation(() => undefined);

        useDevicesMock.mockReturnValue(
            buildContext({
                deviceSyncResponse: {
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                },
            }),
        );

        render(<EmulatorActionForm />);
        await intervalCallback?.();

        await waitFor(() => expect(clearSpy).toHaveBeenCalledWith(timerId));
    });

    it("shows the server's reason when a sync is rejected", async () => {
        // A 409 (another sync already running) used to be console-only, so it
        // looked identical to a click that never registered.
        const setRequestInProgress = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        error: "A sync is already running. Wait for it to finish.",
                        inFlightJobId: "job-9",
                    }),
                    { status: 409 },
                ),
            ),
        );

        useDevicesMock.mockReturnValue(
            buildContext({
                emulatorActions: { dolphin: "push", cemu: "ignore" },
                setRequestInProgress,
            }),
        );

        render(<EmulatorActionForm />);
        fireEvent.click(screen.getByText("Execute Sync"));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "A sync is already running",
        );
        expect(setRequestInProgress).toHaveBeenLastCalledWith(false);
        // A rejected POST leaves no deviceSyncResponse, which used to be the
        // sole thing Reset was gated on: the error was unclearable.
        expect(screen.getByText("Reset").closest("button")).toBeEnabled();
    });

    it("retracts a poll error once a later poll succeeds", async () => {
        // Polls overlap, so a slow success can land after a faster failure.
        // Showing "Lost contact" next to a COMPLETE job is a lie.
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response("nope", { status: 500 }))
            .mockResolvedValue(
                new Response(
                    JSON.stringify({
                        id: "job-1",
                        deviceSyncRecord: {
                            deviceSyncRequest: {
                                deviceName: "Alpha",
                                emulatorActions: [],
                            },
                            status: SyncStatus.COMPLETE,
                            output: [],
                        },
                    }),
                    { status: 200 },
                ),
            );
        vi.stubGlobal("fetch", fetchMock);

        // Only capture the component's 3000ms poll: findBy*/waitFor run their
        // own setInterval, and capturing that instead would silently replace
        // the callback under test with testing-library's checker.
        let intervalCallback: (() => void) | undefined;
        const realSetInterval = globalThis.setInterval;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
            delay?: number,
            ...rest: unknown[]
        ) => {
            if (delay === 3000) {
                intervalCallback = cb as () => void;
                return 0 as unknown as ReturnType<typeof setInterval>;
            }
            return (
                realSetInterval as unknown as (
                    ...a: unknown[]
                ) => ReturnType<typeof setInterval>
            )(cb, delay, ...rest);
        }) as unknown as typeof setInterval);

        useDevicesMock.mockReturnValue(
            buildContext({
                deviceSyncResponse: {
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                },
            }),
        );

        render(<EmulatorActionForm />);

        await intervalCallback?.();
        expect(await screen.findByRole("alert")).toBeInTheDocument();

        await intervalCallback?.();
        await waitFor(() =>
            expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
        );
    });

    it("re-arms the running flag when a straggling poll recovers", async () => {
        // Four polls are issued before any of them answers, which is what the
        // 3s interval actually does against a slow server. Three failures make
        // the UI give up; the straggler then proves the job is still running
        // and has to take the controls back.
        const setRequestInProgress = vi.fn();
        const deferred: ((res: Response) => void)[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(
                () =>
                    new Promise<Response>((resolve) => {
                        deferred.push(resolve);
                    }),
            ),
        );

        let intervalCallback: (() => void) | undefined;
        const realSetInterval = globalThis.setInterval;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
            delay?: number,
            ...rest: unknown[]
        ) => {
            if (delay === 3000) {
                intervalCallback = cb as () => void;
                return 0 as unknown as ReturnType<typeof setInterval>;
            }
            return (
                realSetInterval as unknown as (
                    ...a: unknown[]
                ) => ReturnType<typeof setInterval>
            )(cb, delay, ...rest);
        }) as unknown as typeof setInterval);

        useDevicesMock.mockReturnValue(
            buildContext({
                deviceSyncResponse: {
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                },
                requestInProgress: true,
                setRequestInProgress,
            }),
        );

        render(<EmulatorActionForm />);

        // All four in flight before anything resolves.
        for (let i = 0; i < 4; i += 1) void intervalCallback?.();
        await waitFor(() => expect(deferred).toHaveLength(4));

        await act(async () => {
            deferred[1]?.(new Response("nope", { status: 500 }));
            deferred[2]?.(new Response("nope", { status: 500 }));
            deferred[3]?.(new Response("nope", { status: 500 }));
            await Promise.resolve();
        });
        await waitFor(() =>
            expect(setRequestInProgress).toHaveBeenLastCalledWith(false),
        );
        expect(screen.getByRole("alert")).toHaveTextContent(
            /stopped watching it/,
        );

        await act(async () => {
            deferred[0]?.(
                new Response(
                    JSON.stringify({
                        id: "job-1",
                        deviceSyncRecord: {
                            deviceSyncRequest: {
                                deviceName: "Alpha",
                                emulatorActions: [],
                            },
                            status: SyncStatus.IN_PROGRESS,
                            output: [],
                        },
                    }),
                    { status: 200 },
                ),
            );
            await Promise.resolve();
        });
        await waitFor(() =>
            expect(setRequestInProgress).toHaveBeenLastCalledWith(true),
        );
    });

    it("drops a sync response for a device that is no longer selected", async () => {
        // Device switching stays enabled during a sync, so an in-flight POST
        // can resolve after the selection moved on. It must not populate the
        // new device's panel with the old device's job.
        const setDeviceSyncResponse = vi.fn();
        const context = buildContext({
            emulatorActions: { dolphin: "push", cemu: "ignore" },
            setDeviceSyncResponse,
        });
        useDevicesMock.mockReturnValue(context);

        let resolveFetch: ((res: Response) => void) | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn().mockReturnValue(
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                }),
            ),
        );

        const view = render(<EmulatorActionForm />);
        fireEvent.click(screen.getByText("Execute Sync"));

        // The user picks a different device before the POST comes back.
        useDevicesMock.mockReturnValue({ ...context, selectedDevice: "Beta" });
        view.rerender(<EmulatorActionForm />);

        const response = new Response(
            JSON.stringify({
                id: "job-1",
                deviceSyncRecord: {
                    deviceSyncRequest: {
                        deviceName: "Alpha",
                        emulatorActions: [],
                    },
                    status: SyncStatus.IN_PROGRESS,
                    output: [],
                },
            }),
            { status: 200 },
        );
        // Waiting on the body being parsed is what makes the negative
        // assertion meaningful: the handler only reaches the drop decision
        // after res.json() resolves.
        const jsonSpy = vi.spyOn(response, "json");
        resolveFetch?.(response);

        await waitFor(() => expect(jsonSpy).toHaveBeenCalled());
        await jsonSpy.mock.results[0]?.value;
        expect(setDeviceSyncResponse).not.toHaveBeenCalledWith(
            expect.objectContaining({ id: "job-1" }),
        );
    });

    it("drops an abandoned request even after returning to the same device", async () => {
        // Alpha -> Beta -> Alpha. The abandoned first request is still for
        // "Alpha", so a name check would wave it through; only a per-request
        // generation rejects it.
        const setDeviceSyncResponse = vi.fn();
        const context = buildContext({
            emulatorActions: { dolphin: "push", cemu: "ignore" },
            setDeviceSyncResponse,
        });
        useDevicesMock.mockReturnValue(context);

        let resolveFetch: ((res: Response) => void) | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn().mockReturnValue(
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                }),
            ),
        );

        const view = render(<EmulatorActionForm />);
        fireEvent.click(screen.getByText("Execute Sync"));

        useDevicesMock.mockReturnValue({ ...context, selectedDevice: "Beta" });
        view.rerender(<EmulatorActionForm />);
        useDevicesMock.mockReturnValue(context);
        view.rerender(<EmulatorActionForm />);

        const response = new Response(
            JSON.stringify({
                id: "job-1",
                deviceSyncRecord: {
                    deviceSyncRequest: {
                        deviceName: "Alpha",
                        emulatorActions: [],
                    },
                    status: SyncStatus.IN_PROGRESS,
                    output: [],
                },
            }),
            { status: 200 },
        );
        const jsonSpy = vi.spyOn(response, "json");
        resolveFetch?.(response);

        await waitFor(() => expect(jsonSpy).toHaveBeenCalled());
        await jsonSpy.mock.results[0]?.value;
        expect(setDeviceSyncResponse).not.toHaveBeenCalledWith(
            expect.objectContaining({ id: "job-1" }),
        );
    });

    it("surfaces a failed poll and releases the UI", async () => {
        // Previously this left status IN_PROGRESS and requestInProgress true
        // forever: Execute, Reset and device selection all disabled, with a
        // full page reload the only way out.
        const setRequestInProgress = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
        );

        // Only the component's 3000ms poll: findBy*/waitFor schedule their own.
        let intervalCallback: (() => void) | undefined;
        const realSetInterval = globalThis.setInterval;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
            delay?: number,
            ...rest: unknown[]
        ) => {
            if (delay === 3000) {
                intervalCallback = cb as () => void;
                return 0 as unknown as ReturnType<typeof setInterval>;
            }
            return (
                realSetInterval as unknown as (
                    ...a: unknown[]
                ) => ReturnType<typeof setInterval>
            )(cb, delay, ...rest);
        }) as unknown as typeof setInterval);

        useDevicesMock.mockReturnValue(
            buildContext({
                deviceSyncResponse: {
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                },
                requestInProgress: true,
                setRequestInProgress,
            }),
        );

        const view = render(<EmulatorActionForm />);
        // The mount effect already calls setRequestInProgress(false), so only
        // calls made after this point prove the poll failure released the UI.
        const callsBeforePoll = setRequestInProgress.mock.calls.length;

        // One bad response is tolerated and says so; the UI is only released
        // once polling actually gives up.
        await intervalCallback?.();
        expect(await screen.findByRole("alert")).toHaveTextContent(/retrying/);
        expect(
            setRequestInProgress.mock.calls.slice(callsBeforePoll),
        ).not.toContainEqual([false]);

        await intervalCallback?.();
        await intervalCallback?.();

        expect(await screen.findByRole("alert")).toHaveTextContent(
            /Lost contact with the sync job.*stopped watching it/,
        );
        expect(
            setRequestInProgress.mock.calls.slice(callsBeforePoll),
        ).toContainEqual([false]);

        // Re-render with the flag the component just asked for. The stored
        // response is still IN_PROGRESS, which is exactly the state that used
        // to keep Reset disabled forever once polling died.
        useDevicesMock.mockReturnValue({
            ...useDevicesMock(),
            requestInProgress: false,
        });
        view.rerender(<EmulatorActionForm />);
        expect(screen.getByText("Reset").closest("button")).toBeEnabled();
    });

    it("resets the failure budget after a poll succeeds", async () => {
        // Otherwise three failures spread across a long, healthy job would
        // eventually stop the UI watching a sync that is answering fine.
        const inProgress = () =>
            new Response(
                JSON.stringify({
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                }),
                { status: 200 },
            );
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(new Response("nope", { status: 500 }))
                .mockResolvedValueOnce(new Response("nope", { status: 500 }))
                .mockImplementationOnce(async () => inProgress())
                .mockResolvedValue(new Response("nope", { status: 500 })),
        );

        let intervalCallback: (() => void) | undefined;
        const realSetInterval = globalThis.setInterval;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
            delay?: number,
            ...rest: unknown[]
        ) => {
            if (delay === 3000) {
                intervalCallback = cb as () => void;
                return 0 as unknown as ReturnType<typeof setInterval>;
            }
            return (
                realSetInterval as unknown as (
                    ...a: unknown[]
                ) => ReturnType<typeof setInterval>
            )(cb, delay, ...rest);
        }) as unknown as typeof setInterval);

        useDevicesMock.mockReturnValue(
            buildContext({
                deviceSyncResponse: {
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                },
            }),
        );

        render(<EmulatorActionForm />);

        // fail, fail, succeed, fail, fail — five polls, but never three
        // failures in a row, so the UI keeps watching.
        for (let i = 0; i < 5; i += 1) {
            await act(async () => {
                await intervalCallback?.();
            });
        }

        expect(screen.getByRole("alert")).toHaveTextContent(/retrying/);
    });

    it("drops a poll that settles after Reset was clicked", async () => {
        // Reset clears the panel. A poll already in flight must not repopulate
        // it with the job the user just dismissed.
        const setDeviceSyncResponse = vi.fn();
        let resolveFetch: ((res: Response) => void) | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn().mockReturnValue(
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                }),
            ),
        );

        let intervalCallback: (() => void) | undefined;
        const realSetInterval = globalThis.setInterval;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
            delay?: number,
            ...rest: unknown[]
        ) => {
            if (delay === 3000) {
                intervalCallback = cb as () => void;
                return 0 as unknown as ReturnType<typeof setInterval>;
            }
            return (
                realSetInterval as unknown as (
                    ...a: unknown[]
                ) => ReturnType<typeof setInterval>
            )(cb, delay, ...rest);
        }) as unknown as typeof setInterval);

        useDevicesMock.mockReturnValue(
            buildContext({
                deviceSyncResponse: {
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                },
                setDeviceSyncResponse,
            }),
        );

        render(<EmulatorActionForm />);
        void intervalCallback?.();
        fireEvent.click(screen.getByText("Reset"));

        const response = new Response(
            JSON.stringify({
                id: "job-1",
                deviceSyncRecord: {
                    deviceSyncRequest: {
                        deviceName: "Alpha",
                        emulatorActions: [],
                    },
                    status: SyncStatus.COMPLETE,
                    output: [],
                },
            }),
            { status: 200 },
        );
        const jsonSpy = vi.spyOn(response, "json");
        resolveFetch?.(response);

        await waitFor(() => expect(jsonSpy).toHaveBeenCalled());
        await jsonSpy.mock.results[0]?.value;
        expect(setDeviceSyncResponse).not.toHaveBeenCalledWith(
            expect.objectContaining({
                deviceSyncRecord: expect.objectContaining({
                    status: SyncStatus.COMPLETE,
                }),
            }),
        );
    });

    it("drops a POST that lands after the form unmounts", async () => {
        // Deselecting the device card unmounts the form; the POST is still in
        // flight and would otherwise install an abandoned job into the shared
        // context that nothing is left to poll to completion.
        const setDeviceSyncResponse = vi.fn();
        useDevicesMock.mockReturnValue(
            buildContext({
                emulatorActions: { dolphin: "push", cemu: "ignore" },
                setDeviceSyncResponse,
            }),
        );

        let resolveFetch: ((res: Response) => void) | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn().mockReturnValue(
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                }),
            ),
        );

        const view = render(<EmulatorActionForm />);
        fireEvent.click(screen.getByText("Execute Sync"));
        view.unmount();

        const response = new Response(
            JSON.stringify({
                id: "job-1",
                deviceSyncRecord: {
                    deviceSyncRequest: {
                        deviceName: "Alpha",
                        emulatorActions: [],
                    },
                    status: SyncStatus.IN_PROGRESS,
                    output: [],
                },
            }),
            { status: 200 },
        );
        const jsonSpy = vi.spyOn(response, "json");
        resolveFetch?.(response);

        await waitFor(() => expect(jsonSpy).toHaveBeenCalled());
        await jsonSpy.mock.results[0]?.value;
        expect(setDeviceSyncResponse).not.toHaveBeenCalledWith(
            expect.objectContaining({ id: "job-1" }),
        );
    });

    it("drops a poll that settles after a device switch, before teardown", async () => {
        // The poll effect keys on the response, not the selection, so a device
        // switch does not run its cleanup. Without a generation check the poll
        // writes the old job into the new device's panel.
        const setDeviceSyncResponse = vi.fn();
        const setRequestInProgress = vi.fn();
        const inProgressResponse = {
            id: "job-1",
            deviceSyncRecord: {
                deviceSyncRequest: {
                    deviceName: "Alpha",
                    emulatorActions: [],
                },
                status: SyncStatus.IN_PROGRESS,
                output: [],
            },
        };
        const context = buildContext({
            deviceSyncResponse: inProgressResponse,
            setDeviceSyncResponse,
            setRequestInProgress,
        });
        useDevicesMock.mockReturnValue(context);

        let resolveFetch: ((res: Response) => void) | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn().mockReturnValue(
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                }),
            ),
        );

        let intervalCallback: (() => void) | undefined;
        const realSetInterval = globalThis.setInterval;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
            delay?: number,
            ...rest: unknown[]
        ) => {
            if (delay === 3000) {
                intervalCallback = cb as () => void;
                return 0 as unknown as ReturnType<typeof setInterval>;
            }
            return (
                realSetInterval as unknown as (
                    ...a: unknown[]
                ) => ReturnType<typeof setInterval>
            )(cb, delay, ...rest);
        }) as unknown as typeof setInterval);

        const view = render(<EmulatorActionForm />);
        void intervalCallback?.();

        // Same deviceSyncResponse object, different selection: the poll effect
        // is not re-run, so only the generation can invalidate the in-flight
        // request.
        useDevicesMock.mockReturnValue({ ...context, selectedDevice: "Beta" });
        view.rerender(<EmulatorActionForm />);

        const response = new Response(
            JSON.stringify({
                ...inProgressResponse,
                deviceSyncRecord: {
                    ...inProgressResponse.deviceSyncRecord,
                    status: SyncStatus.COMPLETE,
                },
            }),
            { status: 200 },
        );
        const jsonSpy = vi.spyOn(response, "json");
        resolveFetch?.(response);

        await waitFor(() => expect(jsonSpy).toHaveBeenCalled());
        await jsonSpy.mock.results[0]?.value;
        expect(setDeviceSyncResponse).not.toHaveBeenCalledWith(
            expect.objectContaining({
                deviceSyncRecord: expect.objectContaining({
                    status: SyncStatus.COMPLETE,
                }),
            }),
        );
    });

    it("releases the shared request flag when the form unmounts", async () => {
        // Deselecting the active card unmounts the form mid-sync. Nothing is
        // left to poll the job to completion, so a still-set flag would grey
        // out every device card with no way to clear it.
        const setRequestInProgress = vi.fn();
        useDevicesMock.mockReturnValue(
            buildContext({ requestInProgress: true, setRequestInProgress }),
        );

        const view = render(<EmulatorActionForm />);
        const callsBeforeUnmount = setRequestInProgress.mock.calls.length;
        view.unmount();

        expect(
            setRequestInProgress.mock.calls.slice(callsBeforeUnmount),
        ).toContainEqual([false]);
    });

    it("ignores a poll failure that lost the race to a completed poll", async () => {
        // Two polls in flight: the first returns COMPLETE, the second errors.
        // Showing "lost contact" next to a finished job is a lie.
        const complete = () =>
            new Response(
                JSON.stringify({
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.COMPLETE,
                        output: [],
                    },
                }),
                { status: 200 },
            );
        const deferred: ((res: Response) => void)[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(
                () =>
                    new Promise<Response>((resolve) => {
                        deferred.push(resolve);
                    }),
            ),
        );

        let intervalCallback: (() => void) | undefined;
        const realSetInterval = globalThis.setInterval;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
            delay?: number,
            ...rest: unknown[]
        ) => {
            if (delay === 3000) {
                intervalCallback = cb as () => void;
                return 0 as unknown as ReturnType<typeof setInterval>;
            }
            return (
                realSetInterval as unknown as (
                    ...a: unknown[]
                ) => ReturnType<typeof setInterval>
            )(cb, delay, ...rest);
        }) as unknown as typeof setInterval);

        useDevicesMock.mockReturnValue(
            buildContext({
                deviceSyncResponse: {
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                },
            }),
        );

        render(<EmulatorActionForm />);

        // Both polls are in flight before either answers — the interval fires
        // on a timer, not on completion. act() flushes the state updates each
        // resolution queues, so the negative assertion below is made after
        // React has settled rather than before an alert could render.
        void intervalCallback?.();
        void intervalCallback?.();
        await waitFor(() => expect(deferred).toHaveLength(2));

        await act(async () => {
            deferred[0]?.(complete());
            await Promise.resolve();
        });
        await act(async () => {
            deferred[1]?.(new Response("nope", { status: 500 }));
            await Promise.resolve();
        });

        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("drops a poll that lands after the effect was torn down", async () => {
        // Switching devices tears down the poll. A response already in flight
        // must not write the old job into the new device's panel.
        const setDeviceSyncResponse = vi.fn();
        let resolveFetch: ((res: Response) => void) | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn().mockReturnValue(
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                }),
            ),
        );

        // Leave every non-3000ms timer alone: waitFor below needs its own.
        let intervalCallback: (() => void) | undefined;
        const realSetInterval = globalThis.setInterval;
        vi.spyOn(globalThis, "setInterval").mockImplementation(((
            cb: TimerHandler,
            delay?: number,
            ...rest: unknown[]
        ) => {
            if (delay === 3000) {
                intervalCallback = cb as () => void;
                return 0 as unknown as ReturnType<typeof setInterval>;
            }
            return (
                realSetInterval as unknown as (
                    ...a: unknown[]
                ) => ReturnType<typeof setInterval>
            )(cb, delay, ...rest);
        }) as unknown as typeof setInterval);

        useDevicesMock.mockReturnValue(
            buildContext({
                deviceSyncResponse: {
                    id: "job-1",
                    deviceSyncRecord: {
                        deviceSyncRequest: {
                            deviceName: "Alpha",
                            emulatorActions: [],
                        },
                        status: SyncStatus.IN_PROGRESS,
                        output: [],
                    },
                },
                setDeviceSyncResponse,
            }),
        );

        const view = render(<EmulatorActionForm />);
        void intervalCallback?.();
        view.unmount();

        const response = new Response(
            JSON.stringify({
                id: "job-1",
                deviceSyncRecord: {
                    deviceSyncRequest: {
                        deviceName: "Alpha",
                        emulatorActions: [],
                    },
                    status: SyncStatus.COMPLETE,
                    output: [],
                },
            }),
            { status: 200 },
        );
        const jsonSpy = vi.spyOn(response, "json");
        resolveFetch?.(response);

        await waitFor(() => expect(jsonSpy).toHaveBeenCalled());
        await jsonSpy.mock.results[0]?.value;
        expect(setDeviceSyncResponse).not.toHaveBeenCalledWith(
            expect.objectContaining({
                deviceSyncRecord: expect.objectContaining({
                    status: SyncStatus.COMPLETE,
                }),
            }),
        );
    });
});
