// Serializes sync jobs.
//
// Every pull stages through the one server workDir and deletes it as its first
// command, so two jobs running at once corrupt each other. This app is a single
// process (one systemd unit running react-router-serve), so two syncs can only
// ever originate from two requests to this process — an in-process guard is
// therefore sufficient and, because the check-and-set below is synchronous,
// genuinely atomic.
//
// Deliberately not a Redis lease: a lease needs a TTL, which is either too
// short (it expires under a slow transfer and lets a second job in) or too long
// (a crash wedges syncing until it expires), and it can lapse mid-job, which
// no amount of cancellation checking can make airtight. Holding the slot in
// memory means it is released exactly when the job ends or the process dies.
// If this ever runs as more than one process, this must become a real
// distributed lock and the transfers must become interruptible.
let heldBy: string | null = null;

export const tryAcquireSyncSlot = (jobId: string): boolean => {
    if (heldBy !== null) return false;
    heldBy = jobId;
    return true;
};

export const releaseSyncSlot = (jobId: string): void => {
    if (heldBy === jobId) heldBy = null;
};

export const currentSyncJobId = (): string | null => heldBy;
