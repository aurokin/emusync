#!/usr/bin/env bash
# Boot the built server against a throwaway config and confirm it serves.
#
# This is the check CI was missing: `bun run check` passes on a tree that
# cannot start. Both of the deploy breakages we hit — a Dockerfile copying a
# lockfile that does not exist, and the app failing initialisation — are
# invisible to unit tests and obvious here.
#
# Requires: a built tree (bun run build), redis reachable at REDIS_URL, and
# zip/unzip on PATH (initializeServer checks for them).
set -euo pipefail

PORT="${PORT:-3111}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
server_pid=""

cleanup() {
    # Ignore further signals: a TERM landing inside cleanup (CI cancelling
    # while the shell is in the sleep below) used to abort it part-way and
    # leave the server running.
    trap "" INT TERM
    # Kill the group, not the pid: `bun run start` execs bunx which spawns
    # node, and killing only bun leaves the server listening. Trapping TERM
    # and INT as well matters because CI wraps this in a timeout.
    if [ -n "$server_pid" ]; then
        kill -TERM -- "-$server_pid" 2>/dev/null || true
        sleep 1
        kill -KILL -- "-$server_pid" 2>/dev/null || true
        # Reap it so the shell does not print its own "Killed" job notice.
        wait "$server_pid" 2>/dev/null || true
    fi
    rm -rf "$work"
}
# INT/TERM only set an exit status; the EXIT trap is what cleans up. Trapping
# cleanup on the signals directly would run the handler and then *resume* the
# interrupted command, which can carry on to "smoke: ok" after a cancellation.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Every server path must exist: shouldLaunch fs.access()es all of them.
fields=(cemuSave azahar dolphinGC dolphinWii mupenFzSave nethersx2Save melonds
    ppssppSave ppssppState retroarchSave retroarchState retroarchRgState
    rpcs3Save ryujinxSave switchSave vita3kSave xemuSave xeniaSave yuzuSave
    workDir)
server_json=""
for field in "${fields[@]}"; do
    mkdir -p "$work/$field"
    server_json+="\"$field\": \"$work/$field\","
done

cat > "$work/db.json" <<EOF
{
    "devices": [
        {
            "name": "smoke",
            "ip": "127.0.0.1",
            "port": 22,
            "user": "nobody",
            "password": "unused",
            "os": "linux",
            "retroarchSave": "$work/dev/saves",
            "retroarchState": "$work/dev/states",
            "workDir": "$work/dev/work"
        }
    ],
    "server": { ${server_json%,} }
}
EOF

# Refuse to run against someone else's server: if the port is already taken
# the build under test can die with EADDRINUSE while curl happily talks to
# the incumbent, and the smoke check reports a boot that never happened.
if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/devices" \
    > /dev/null 2>&1; then
    echo "smoke: something is already serving port $PORT" >&2
    exit 1
fi

cd "$root"
# Job-control mode so the background job becomes its own process group leader
# and $! is that group's id. `setsid` looks like it would do the same but
# forks, leaving $! pointing at a wrapper that exits immediately — the group
# kill in cleanup then misses the server entirely.
set -m
DB_PATH="$work/db.json" REDIS_URL="$REDIS_URL" PORT="$PORT" \
    bun run start > "$work/server.log" 2>&1 &
server_pid=$!
set +m

# One overall deadline rather than a fixed number of tries: with Redis
# unreachable each request blocks on the client's own retries, so counting
# attempts made the worst case several minutes.
deadline=$((SECONDS + 60))
while [ "$SECONDS" -lt "$deadline" ]; do
    # Liveness first: a dead server whose port was inherited by something
    # else would otherwise let the response below stand in for a boot.
    if ! kill -0 "$server_pid" 2>/dev/null; then
        echo "smoke: server exited during startup" >&2
        cat "$work/server.log" >&2
        exit 1
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/devices" \
        > "$work/devices.json" 2>/dev/null; then
        break
    fi
    sleep 1
done

if ! [ -s "$work/devices.json" ]; then
    echo "smoke: server never served /api/devices on port $PORT" >&2
    cat "$work/server.log" >&2
    exit 1
fi

# Check the shape, not a substring: the device must come back with the
# emulator list derived from its paths. A 200 carrying anything else — an
# empty array, an error body — is a broken endpoint, not a healthy boot.
#
# Explicit process.exit rather than throw: `bun -e` exits 0 on an uncaught
# exception once the script touches require(), so a throwing check would
# always pass (verified on bun 1.3.14).
if ! bun -e '
    const fail = (message) => {
        console.error(`smoke: ${message}`);
        process.exit(1);
    };
    let list;
    try {
        list = JSON.parse(await Bun.file(process.argv[1]).text());
    } catch (e) {
        fail(`/api/devices did not return JSON: ${e}`);
    }
    if (!Array.isArray(list) || list.length !== 1) {
        fail(`expected one device, got ${JSON.stringify(list)}`);
    }
    const [device] = list;
    if (device.name !== "smoke" || device.os !== "linux") {
        fail(`unexpected device ${JSON.stringify(device)}`);
    }
    if (
        !Array.isArray(device.emulatorsEnabled) ||
        !device.emulatorsEnabled.includes("retroarch")
    ) {
        fail(
            "retroarch not derived from the device paths: " +
                JSON.stringify(device.emulatorsEnabled),
        );
    }
' "$work/devices.json"; then
    echo "smoke: /api/devices returned an unusable device list:" >&2
    cat "$work/devices.json" >&2
    exit 1
fi

curl -fsS --max-time 20 "http://127.0.0.1:$PORT/" > /dev/null
echo "smoke: ok"
