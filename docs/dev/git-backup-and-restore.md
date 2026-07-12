# Git Backup And Restore

This repo has a remote emergency snapshot branch for recovering the main
workspace state before the TypeScript voice-worker migration:

- Remote: `origin`
- Branch: `backup/main-workspace-20260711-snapshot`
- Snapshot commit: `d40b695`
- Purpose: restore the `/home/jia/MerismV2` workspace to the exact file tree
  that was backed up on 2026-07-11 before local TS voice experiments continued

## Recommended recovery path

Prefer restoring into a separate worktree first, so you can inspect the backup
 without touching your current checkout:

```bash
git fetch origin backup/main-workspace-20260711-snapshot
git worktree add ../MerismV2-backup-20260711 origin/backup/main-workspace-20260711-snapshot
```

This gives you a clean recovery checkout at `../MerismV2-backup-20260711`.

## Restore the current checkout to the snapshot

If you explicitly want the current checkout to match the remote backup branch:

```bash
git fetch origin backup/main-workspace-20260711-snapshot
git switch backup/main-workspace-20260711-snapshot
```

If the local branch does not exist yet:

```bash
git fetch origin backup/main-workspace-20260711-snapshot:backup/main-workspace-20260711-snapshot
git switch backup/main-workspace-20260711-snapshot
```

## Verify what you restored

```bash
git rev-parse HEAD
git status --short
```

Expected:

- `HEAD` matches `d40b695` or a descendant you intentionally added later
- `git status --short` is empty for a clean restored checkout

## Why this branch exists

The backup branch was pushed as an orphan snapshot instead of a normal feature
branch, because an older local history segment triggered GitHub push-protection.
This snapshot branch contains the backed-up file tree without inheriting that
blocked history.
