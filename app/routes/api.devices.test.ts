import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./api.devices";
import { getSimpleDevices, initializeServer } from "~/server";
import { EmuOs } from "~/server/types";

vi.mock("~/server", () => ({
    initializeServer: vi.fn(),
    getSimpleDevices: vi.fn(),
}));

const initializeServerMock = vi.mocked(initializeServer);
const getSimpleDevicesMock = vi.mocked(getSimpleDevices);

describe("api.devices loader", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        initializeServerMock.mockResolvedValue(undefined);
        getSimpleDevicesMock.mockResolvedValue([
            { name: "Alpha", os: EmuOs.linux, emulatorsEnabled: [] },
        ]);
    });

    it("returns device list", async () => {
        const response = await loader();

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toEqual([
            { name: "Alpha", os: EmuOs.linux, emulatorsEnabled: [] },
        ]);
    });
});
