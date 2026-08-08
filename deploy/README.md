# Deployment

Host-agnostic deployment pieces. Nothing here assumes a specific machine —
paths and hosts are configured per install so the whole setup can move.

## Save store backup

`backup-saves.sh` snapshots the save store as `saves-<timestamp>-<hash>.tar.gz`:

- **Dedup:** the filename hash is a deterministic content hash of the store;
  if nothing changed since the newest archive, no new archive is written.
- **Retention:** archives beyond `EMUSYNC_BACKUP_KEEP` (default 14) are
  pruned, oldest first. That is a count of archives, not a span of time —
  and because dedup only suppresses a run that matches the _newest_ archive,
  a store that flips back and forth still burns a slot per change. What
  fills those slots is _runs that saw a change_, not syncs: the timer fires
  daily and only the state at that moment is observed, so a dozen syncs
  between two runs collapse into one archive, or none if the store ends up
  matching the newest one. With the default daily timer, then, a store that
  changes every day gives you roughly the 13 days between the oldest and
  newest of 14 archives — less if anyone runs the unit by hand, and the
  boundaries drift by up to the timer's `RandomizedDelaySec=15m`. A store
  that changes monthly gives you a year from the same 14. Nothing here
  guarantees a window: if you need one, keep N dailies regardless of dedup,
  or use hardlink snapshots.
- **Remote source:** when `EMUSYNC_BACKUP_SOURCE` is `user@host:/path`, the
  script first rsyncs into `EMUSYNC_BACKUP_MIRROR` (a live mirror of the
  store) and archives that.

Install on the backup host (currently bront, pulling from infra):

```bash
sudo mkdir -p /opt/emusync/deploy /etc/emusync
sudo cp deploy/backup-saves.sh /opt/emusync/deploy/
sudo chmod +x /opt/emusync/deploy/backup-saves.sh
sudo tee /etc/emusync/backup.env <<'EOF'
EMUSYNC_BACKUP_SOURCE=auro@infra.home.arpa:/opt/emusync/saves/
EMUSYNC_BACKUP_MIRROR=/pluto/game/save
EMUSYNC_BACKUP_ARCHIVES=/pluto/backup/save
EMUSYNC_BACKUP_KEEP=14
EOF
sudo cp deploy/emusync-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now emusync-backup.timer
```

Moving the job to another host is: repeat the above there, adjust
`backup.env`, disable the old timer. Requires `rsync` on both ends and
non-interactive SSH from the backup host to the source host.

Retention globs `saves-*.tar.gz` and prunes by name order — it does not
check that a match has the `<timestamp>-<hash>` shape. Do not park a
hand-made `saves-something.tar.gz` in the archive directory expecting it to
survive; give it any other prefix. Files that do not match the glob are
ignored entirely and will accumulate.
