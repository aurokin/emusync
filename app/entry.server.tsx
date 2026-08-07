import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToReadableStream } from "react-dom/server";
import { isbot } from "isbot";

// Custom entry so SSR runs under Bun: the default React Router entry uses
// renderToPipeableStream, which react-dom's Bun build does not export.
export default async function handleRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    routerContext: EntryContext,
) {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    const stream = await renderToReadableStream(
        <ServerRouter context={routerContext} url={request.url} />,
        {
            onError(error: unknown) {
                responseStatusCode = 500;
                if (shellRendered) {
                    console.error(error);
                }
            },
        },
    );
    shellRendered = true;

    if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
        await stream.allReady;
    }

    responseHeaders.set("Content-Type", "text/html");
    return new Response(stream, {
        headers: responseHeaders,
        status: responseStatusCode,
    });
}
