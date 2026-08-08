import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import Admin from "./admin";

// Admin renders a <Link>, so it needs a router context.
const renderAdmin = () =>
    render(
        <RouterProvider
            router={createMemoryRouter([{ path: "/", element: <Admin /> }])}
        />,
    );

describe("Admin page loaders", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const stubFetch = (statuses: { config: number; devices: number }) =>
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(async (url: string) => {
                const failing =
                    url === "/api/admin" ? statuses.config : statuses.devices;
                return failing === 200
                    ? new Response(
                          JSON.stringify(
                              url === "/api/admin"
                                  ? { workDir: "/opt/emusync/work" }
                                  : [],
                          ),
                          { status: 200 },
                      )
                    : new Response(JSON.stringify({ error: "boom" }), {
                          status: failing,
                      });
            }),
        );

    // Both loaders used to call res.json() unconditionally, so a 500's
    // { error: ... } body was accepted as the config or the device list and
    // nothing was reported. The form then showed it as saved state.
    it("reports a failed server-config load", async () => {
        stubFetch({ config: 500, devices: 200 });

        renderAdmin();

        expect(
            await screen.findByText("Failed to load server config"),
        ).toBeVisible();
    });

    it("reports a failed device load", async () => {
        stubFetch({ config: 200, devices: 500 });

        renderAdmin();

        expect(await screen.findByText("Failed to load devices")).toBeVisible();
    });

    it("populates the form when both loads succeed", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockImplementation(async (url: string) =>
                    url === "/api/admin"
                        ? new Response(
                              JSON.stringify({ workDir: "/opt/emusync/work" }),
                              { status: 200 },
                          )
                        : new Response(JSON.stringify([]), { status: 200 }),
                ),
        );

        renderAdmin();

        expect(
            await screen.findByDisplayValue("/opt/emusync/work"),
        ).toBeInTheDocument();
        expect(
            screen.queryByText("Failed to load server config"),
        ).not.toBeInTheDocument();
    });
});
