# emusync

A self-hosted server that moves emulator save files between a save store on
the server and the devices that play the games. Push sends the server's copy
to a device; pull brings a device's copy back. There is no merge and no
conflict resolution — whichever direction you choose overwrites the other
side, so the workflow is "pull when you stop playing, push before you start".

There is no authentication, deliberately. The server binds every interface,
so keeping it off the public internet is the operator's job — bind it to a
private interface or firewall the port. Anyone who can reach it can read the
admin page and start a sync that overwrites saves.

## How it works

`db.json` holds the whole configuration: one `server` object with a path per
emulator, and a `devices` array with per-device paths, address and OS. The
admin page at `/admin` edits that file; nothing else is stateful except job
records in Redis.

A sync is a list of source/target directory pairs, built per emulator by
`app/server/emulator_managers.ts`, transferred one pair at a time.

Where both ends have `rsync`, a pair is one `rsync` invocation. Its flags are
picked to match what the `scp` path already did rather than rsync's defaults:
`--checksum` compares contents rather than size and mtime, because a
same-size save rewritten within the timestamp granularity would otherwise be
skipped; `-L` follows symlinks the way `scp -r` does; and `--delete-after`
`--delay-updates` hold back deletions and file contents until the transfer
finishes, so a transfer that fails deletes nothing and publishes no
half-written saves. That is not full atomicity — an interrupted sync can leave
new empty directories, a partial failure promotes whatever did transfer, and
the delete phase is not itself atomic once it has started — but none of those
lose data, and the `scp` path is not atomic either: it deletes the target
before moving the staged copy into place. Where both ends do not have rsync, the pair is staged through the
receiving side's `workDir` — the device's on a push, the server's on a pull:

1. copy the source into the receiving side's `workDir`
2. delete the target directory
3. move the staged copy into its place

Either way the pairs are interleaved, not batched — a failure part-way
through leaves the remaining pairs untouched rather than several directories
already deleted.

Which path a device gets is probed per sync, not configured, so a device that
gains rsync starts using it with no config change. The probe is
the transfer's own flag list plus `--version`, run on the server and again
over ssh on the device: it has to establish that rsync can run the options the
transfer uses, not merely that the binary is on `PATH`, or an rsync too old
for one of them would be selected and then fail mid-sync. Windows devices skip
the
probe entirely — they answer ssh with PowerShell, where its exit status would
not mean what this reads it as. The job log records the reason whenever a
device falls back.

Transfers use `ssh` plus `rsync`/`scp` for everything except Nintendo Switch
devices (`os: "nx"`), which use FTP and always stage. Dolphin on Android goes
through a zip in the device's dump directory because the emulator's own save
directory is app-private.

Only one sync runs at a time. A second request gets a 409 carrying the id of
the job that holds the slot; pulls stage through the single server `workDir`,
so concurrent syncs would overwrite each other's staged copies.

## Requirements

- [Bun](https://bun.sh/) 1.3.14
- Redis, reachable at `REDIS_URL`. `deploy/emusync.service` declares
  `Requires=redis-server.service`, so under systemd it will not start
  without it. Run directly, the process starts either way and it is the
  requests that fail — initialisation is lazy
- `zip` and `unzip` on `PATH` (Dolphin Android sync)
- `ssh`/`scp`, and non-interactive SSH from the server to every device
  except Nintendo Switch (`os: "nx"`), which uses FTP
- `rsync` optionally, on the server and on a device, for the faster
  in-place path. Absent on either end, that device uses `scp`

## Configuration

| Variable    | Default                  | Purpose                         |
| ----------- | ------------------------ | ------------------------------- |
| `DB_PATH`   | `./db.json`              | Device and server configuration |
| `REDIS_URL` | `redis://localhost:6379` | Job records and sync logs       |
| `PORT`      | `3000`                   | Port for `bun run start`        |

See `.env.example`. `db.json` is gitignored: it holds the real paths and
addresses of every device.

All twenty `server` paths must be set, and the nineteen save paths must
already exist on disk: initialisation `access()`es each one and fails if any
is missing. `workDir` is the exception — it is created and destroyed by each
sync. Device paths are optional; an emulator is offered for a device only
when the paths that emulator needs are filled in.

A `db.json` sketch — the `server` block is abbreviated here, but in a real
one all twenty paths must be present:

```json
{
    "devices": [
        {
            "name": "herb",
            "ip": "herb.home.arpa",
            "port": 22,
            "user": "auro",
            "password": "unused",
            "os": "linux",
            "retroarchSave": "/home/auro/Emulation/Saves",
            "retroarchState": "/home/auro/Emulation/States",
            "workDir": "/home/auro/.emusync_tmp"
        }
    ],
    "server": {
        "retroarchSave": "/opt/emusync/saves/retroarch/saves",
        "retroarchState": "/opt/emusync/saves/retroarch/states"
    }
}
```

`os` is one of `linux`, `windows`, `android`, `muos`, `nx`. `password` is
unused for SSH devices (authentication is by key) but the field must be
present; FTP devices do use it.

## Development

```bash
bun install
bun run dev      # http://localhost:5173
bun run health   # format, then typecheck + test + lint
```

`bun run check` is the same as `health` without the reformat, and is what CI
runs. CI additionally builds and runs `deploy/smoke.sh`, which boots the
built server against a throwaway config and asks it for its device list —
`check` passes happily on a tree that cannot start.

## Deployment

The fleet runs it under systemd from a checkout; see
`deploy/emusync.service`. Deploying is:

```bash
git pull && bun install && bun run build && sudo systemctl restart emusync
```

`deploy/README.md` covers the save-store backup job, which runs separately
on the backup host.

A `Dockerfile` is included but is not how the fleet runs it, is not built in
CI, and should be treated as unverified.
