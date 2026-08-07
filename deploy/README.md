# Deployment

Host-agnostic deployment pieces. Nothing here assumes a specific machine —
paths and hosts are configured per install so the whole setup can move.

## Save store backup

`backup-saves.sh` snapshots the save store as `saves-<timestamp>-<hash>.tar.gz`:

- **Dedup:** the filename hash is a deterministic content hash of the store;
  if nothing changed since the newest archive, no new archive is written.
- **Retention:** archives beyond `EMUSYNC_BACKUP_KEEP` (default 14) are
  pruned, oldest first.
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
