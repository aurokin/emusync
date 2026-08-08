import { beforeEach, describe, expect, it, vi } from "vitest";
import { action as addAction } from "./api.admin.devices";
import { action as editAction } from "./api.admin.devices.$name";
import { addDevice, updateDevice } from "~/server/database";

vi.mock("~/server/database", () => ({
    getRawDevices: vi.fn(),
    addDevice: vi.fn(),
    getDevice: vi.fn(),
    updateDevice: vi.fn(),
    deleteDevice: vi.fn(),
}));

const addDeviceMock = vi.mocked(addDevice);
const updateDeviceMock = vi.mocked(updateDevice);

const post = (body: unknown) =>
    addAction({
        request: new Request("http://x/api/admin/devices", {
            method: "POST",
            body: JSON.stringify(body),
        }),
    });

const put = (body: unknown) =>
    editAction({
        request: new Request("http://x/api/admin/devices/herb", {
            method: "PUT",
            body: JSON.stringify(body),
        }),
        params: { name: "herb" },
    });

const validDevice = {
    name: "odin",
    ip: "odin.home.arpa",
    port: 8022,
    user: "u0_a110",
    password: "unused",
    os: "android",
    workDir: "/sdcard/work",
};

describe("admin device endpoints", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        addDeviceMock.mockResolvedValue({ success: true });
        updateDeviceMock.mockResolvedValue({ success: true });
    });

    it("accepts a fully specified device", async () => {
        expect((await post(validDevice)).status).toBe(201);
        expect(addDeviceMock).toHaveBeenCalledWith(validDevice);
    });

    it.each(["name", "ip", "port", "user", "password", "os", "workDir"])(
        "rejects an add missing %s",
        async (field) => {
            const body: Record<string, unknown> = { ...validDevice };
            delete body[field];

            const response = await post(body);

            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                error: `Missing required field: ${field}`,
            });
            expect(addDeviceMock).not.toHaveBeenCalled();
        },
    );

    it.each(["name", "ip", "port", "user", "password", "os", "workDir"])(
        "rejects an update that blanks %s",
        async (field) => {
            // Blanking an optional path unsets it, which is intended. Doing the
            // same to one of these would leave a device that still renders and
            // whose every command is malformed.
            const response = await put({ [field]: "" });

            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                error: `Missing required field: ${field}`,
            });
            expect(updateDeviceMock).not.toHaveBeenCalled();
        },
    );

    it.each(["name", "ip", "user", "password", "os", "workDir"])(
        "rejects a whitespace-only %s",
        async (field) => {
            // "   " is truthy, so it used to pass validation and then get
            // stripped on save, persisting a device missing that field.
            expect(
                (await post({ ...validDevice, [field]: "   " })).status,
            ).toBe(400);
            expect((await put({ [field]: "   " })).status).toBe(400);
            expect(addDeviceMock).not.toHaveBeenCalled();
            expect(updateDeviceMock).not.toHaveBeenCalled();
        },
    );

    it("coerces a numeric string port to a number", async () => {
        // The admin form's port field is text. Saved verbatim it returned 201
        // and the device then failed verification on the next load.
        expect((await post({ ...validDevice, port: "8022" })).status).toBe(201);
        expect(addDeviceMock).toHaveBeenCalledWith({
            ...validDevice,
            port: 8022,
        });

        expect((await put({ port: "2222" })).status).toBe(200);
        expect(updateDeviceMock).toHaveBeenCalledWith("herb", { port: 2222 });
    });

    it.each([["not-a-port"], [22.5], [0], [70000], [-1]])(
        "rejects the invalid port %s",
        async (port) => {
            expect((await post({ ...validDevice, port })).status).toBe(400);
            expect((await put({ port })).status).toBe(400);
            expect(addDeviceMock).not.toHaveBeenCalled();
            expect(updateDeviceMock).not.toHaveBeenCalled();
        },
    );

    it("allows an update that blanks an optional path", async () => {
        const response = await put({ cemuSave: "" });

        expect(response.status).toBe(200);
        expect(updateDeviceMock).toHaveBeenCalledWith("herb", {
            cemuSave: "",
        });
    });
});
