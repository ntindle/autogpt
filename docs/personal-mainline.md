# Nick's personal AutoGPT mainline

`mainline` combines upstream `dev` with the branches listed in
`.github/personal-mainline.json`. It is the default branch of `ntindle/autogpt`.

- `personal/tasks` contains the Tasks workspace and task-directed agent work.
- `personal/orgs` contains organizations, teams, and scoped resources.

The recurring T3 Code task fetches upstream `dev`, merges it into each listed
feature branch, validates the changes, and merges those branches into the
existing `mainline`. Updates use ordinary merge commits and fast-forward pushes
to this fork. Integration fixes and other commits already on `mainline` remain
in its history. A failed check or unresolved conflict leaves the published
branch at its last validated commit and is reported in the task thread.

Add future installable AutoGPT and release branches to the manifest when they
are ready to participate. Keep release configuration on its own branch until
then. The sync task does not deploy containers, publish releases, or change
upstream branches.

Work uses isolated worktrees so the primary checkout and parked development
worktrees retain their current changes. Run the repository's relevant lint,
type, migration, and regression checks before publishing an update. Verify that
upstream `dev` is an ancestor of each updated feature branch and that every
listed branch is an ancestor of the resulting `mainline`.
