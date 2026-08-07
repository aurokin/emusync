#!/usr/bin/env bash
set -euo pipefail

# Snapshot backup for the emusync save store.
#
# - Optionally rsyncs the store from a remote host into a local mirror.
# - Archives the store as saves-<timestamp>-<hash>.tar.gz, skipping the
#   archive entirely when content is identical to the newest one (the hash
#   in the filename is a content hash, not an archive hash).
# - Prunes archives beyond EMUSYNC_BACKUP_KEEP, oldest first.
#
# Configuration (env vars, e.g. via a systemd EnvironmentFile):
#   EMUSYNC_BACKUP_SOURCE    save store to back up; a local dir, or an rsync
#                            remote like auro@infra.home.arpa:/opt/emusync/saves/
#   EMUSYNC_BACKUP_MIRROR    local mirror dir; required when SOURCE is remote
#   EMUSYNC_BACKUP_ARCHIVES  dir that receives the tar.gz snapshots
#   EMUSYNC_BACKUP_KEEP      archives to retain (default 14)

SOURCE=${EMUSYNC_BACKUP_SOURCE:?EMUSYNC_BACKUP_SOURCE is required}
MIRROR=${EMUSYNC_BACKUP_MIRROR:-}
ARCHIVES=${EMUSYNC_BACKUP_ARCHIVES:?EMUSYNC_BACKUP_ARCHIVES is required}
KEEP=${EMUSYNC_BACKUP_KEEP:-14}

if [[ "$SOURCE" == *:* ]]; then
    [[ -n "$MIRROR" ]] || {
        echo "EMUSYNC_BACKUP_MIRROR is required for a remote source" >&2
        exit 1
    }
    mkdir -p "$MIRROR"
    rsync -a --delete "${SOURCE%/}/" "$MIRROR/"
    STORE=$MIRROR
else
    STORE=$SOURCE
fi

[[ -d "$STORE" ]] || {
    echo "save store not found: $STORE" >&2
    exit 1
}
mkdir -p "$ARCHIVES"

# Deterministic content hash: file contents plus a listing of every entry
# with its type and symlink target, so new/removed empty dirs and symlink
# changes produce a new archive. Permission-only changes are deliberately
# excluded: hashing modes portably (BSD vs GNU stat) isn't worth it for
# save data.
store_hash() {
    cd "$STORE"
    {
        find . -type f -print0 | sort -z | xargs -0r sha256sum
        find . -mindepth 1 -not -type f -print0 | sort -z |
            while IFS= read -r -d '' entry; do
                if [[ -L "$entry" ]]; then
                    printf 'link %s -> %s\n' "$entry" "$(readlink "$entry")"
                elif [[ -d "$entry" ]]; then
                    printf 'dir %s\n' "$entry"
                else
                    printf 'other %s\n' "$entry"
                fi
            done
    } | sha256sum | cut -c1-12
}

# The hash names the archive, so the store must not change between hashing
# and tar (a live local source can). Re-hash after archiving and retry when
# the store moved mid-run.
for attempt in 1 2 3; do
    HASH=$(store_hash)

    LATEST=$(ls -1 "$ARCHIVES"/saves-*.tar.gz 2>/dev/null | sort | tail -n 1 || true)
    if [[ -n "$LATEST" && "$LATEST" == *"-$HASH.tar.gz" ]]; then
        echo "unchanged ($HASH), skipping archive"
        break
    fi

    STAMP=$(date -u +%Y%m%dT%H%M%SZ)
    ARCHIVE="$ARCHIVES/saves-$STAMP-$HASH.tar.gz"
    if ! tar -czf "$ARCHIVE.tmp" -C "$STORE" . ||
        [[ "$(store_hash)" != "$HASH" ]]; then
        rm -f "$ARCHIVE.tmp"
        echo "store changed during archiving (attempt $attempt), retrying"
        if [[ "$attempt" == 3 ]]; then
            echo "store would not settle, giving up" >&2
            exit 1
        fi
        continue
    fi
    mv "$ARCHIVE.tmp" "$ARCHIVE"
    echo "wrote $ARCHIVE"
    break
done

COUNT=$(ls -1 "$ARCHIVES"/saves-*.tar.gz | wc -l)
if (( COUNT > KEEP )); then
    ls -1 "$ARCHIVES"/saves-*.tar.gz | sort | head -n $((COUNT - KEEP)) |
        while read -r old; do
            rm -f "$old"
            echo "pruned $old"
        done
fi
