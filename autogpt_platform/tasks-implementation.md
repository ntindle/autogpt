# Tasks workspace implementation

Interaction reference: `autogpt-tasks-prd-v0.4-platform.html` (September 10, 2026).
Branch: `codex/tasks-workspace`, based on `origin/dev` at `7a354df889`.

The dedicated checklist ties persistent tasks to existing Experts, CoPilot
sessions and worker admission, question cards, result review, and schedules.
Capturing tasks, viewing details, accepting suggestions, and delegating work are
separate actions. Only confirmed agent ownership starts eligible work.

## Implemented

- Capture one or multiple tasks, nest and edit them, mark manual work complete,
  reopen outcomes, filter/search projects, and restore list context after chat.
  Regular chats can list owned tasks and call `add_step` with a parent `task_id`
  to create real children at any depth; this planning action does not grant
  execution authority or require switching to a task-linked conversation.
- Suggested identities, explicit human/AutoPilot/Expert assignments, inherited planning
  holds, pause/retry, dependency gates, and progress over accepted required leaves.
- Task conversations use the existing chat routes and permission intersection.
  Existing executor admission and credential routing remain authoritative.
- Durable questions can be answered from Tasks or the existing chat question card.
  The question ID prevents stale answers; failed submissions retain the draft.
- Agent results require explicit acceptance. Review items remain ordinary tasks;
  AutoPilot can review delegated child results, and changed child work wakes its
  coordinator once. Finishing a chat never implicitly completes an outcome.
- Existing scheduled graphs and CoPilot jobs appear in Scheduled. New task
  schedules use the existing scheduler with separate, idempotent occurrences.
- User-scoped persistence and an advisory transaction lock serialize commands.
  Version checks, dispatch claims, worker turn IDs, and reconciliation prevent
  stale updates and duplicate execution from silently repeating completed work.

## Deliberate initial limits

Tasks are private to their owner. The current user is the supported human
assignee; project labels do not grant access. Eligible Experts use existing
private ownership checks. Shared organizational task access is not introduced.

Owner suggestions now use the configured `CHAT_FAST_STANDARD_MODEL` through the
existing model transport, with task/ancestor/project context and the eligible
Expert roster's actual roles, skills, and identities. Responses can only select
existing owners; model failures are visible and retryable. Recommendation-only
updates do not invalidate a user's pending assignment command. Context edits
invalidate unconfirmed suggestions; background planning keeps confirmed owners in place.

Break down produces a durable, editable preview at milestone, actionable-step,
or smaller-step detail. Acceptance adds selected steps and prerequisite links
atomically and idempotently. Existing children remain untouched; prior leaf work,
its conversation, and its result review are preserved as an original-work child.
An undelegated outcome leaves new owners as suggestions. A delegated outcome
passes its scope to newly accepted steps while inherited holds and dependencies
continue to gate execution. A running attempt must be stopped before accepting
changes to its scope; generating and editing a preview does not stop it.

AutoPilot retains parent ownership and uses the existing task tool to assign
unassigned planned children or add necessary new children to eligible Experts.
AutoPilot can explicitly reroute confirmed owners with the management operations below; background suggestions cannot replace them. A coordinator cannot submit
an outcome result while required child work is unfinished. Linked chats show the task
brief immediately and receive the current outcome, ancestors, steps, questions,
and results in their model context. Review tasks open the deliverable's chat.

Tasks use existing chat permissions and budgets rather than defining a second
execution or authorization system. A workspace is capped at 1,000 tasks.

## Validation

The implementation includes database tests for user isolation, concurrent
confirmation, replayed worker turns, stale answers/results, dependencies,
coordinator wakeups, and separate schedule occurrences. Existing question,
permission, and worker regression suites cover the integration paths. Frontend
integration tests cover capture, delegation, inspection, and manual completion.

The normal single-container Docker Bake definition remains the build contract.
This development deployment reuses the installed single-container runtime and
updates the three changed locked Python packages, generated Prisma client,
application source, and standalone frontend. Final source packaging runs on the
local Linux machine. The new instance uses its own data and private LAN port.

The development image enables the existing frontend overrides
`AUTOGPT_NEW_LAYOUT`, `HIRE_EXPERTS`, `CHAT_WORKSPACE_FILES`, and
`ARTIFACTS_PAGE` using `NEXT_PUBLIC_FORCE_FLAG_*` build variables. The backend
uses `FORCE_FLAG_HIRE_EXPERTS=true` for the matching Expert surfaces.
Task capture supports plain HTTP LAN addresses using the existing UUID library.

## Development deployment verification

Verified September 10, 2026 on `AutoGPT-Tasks` at
`http://192.168.1.193:3004/tasks`, using image `autogpt-tasks:release` with source
revision `40dc02d846`. It runs as one healthy container with dedicated data at
`/mnt/user/appdata/autogpt-tasks`. The existing AutoGPT instances remain healthy.

- Backend-wide formatting, lint, and type checks passed; 12 Tasks tests and 131
  existing chat/question/permission regression tests passed.
- Frontend-wide formatting, lint, and type checks passed. The full suite passed
  6,960 tests; after the HTTP-origin capture correction, all five Tasks page
  integration tests passed, including its new regression test.
- The production frontend was built locally. The final image was recreated and
  became healthy with persistent task data intact. Frontend asset permissions
  are normalized for the unprivileged runtime user.
- Live UI/API checks passed for multiline capture without dispatch, human
  assignment and completion, required-child completion guards, linked-chat
  navigation without execution, a separate scheduled occurrence, pause/resume,
  and completion of an occurrence without completing its definition.
- Desktop and 390px mobile layouts were inspected; the mobile document has no
  horizontal overflow. Screenshots are in `/tmp/autogpt-tasks-desktop.png` and
  `/tmp/autogpt-tasks-mobile.png` on the local development machine.

The instance is managed by Unraid Docker Manager, using the user template
`/boot/config/plugins/dockerMan/templates-user/my-AutoGPT-Tasks.xml`, based on
`my-AutoGPT-Orgs-Stack-Latest.xml`. It has a working Edit action, editable provider
settings, masked credential fields, and the existing LAN binding. The Tasks
template and dedicated appdata are preserved during updates; the source Orgs
Stack template and other instances are unchanged.

After adopting the Orgs Stack model configuration, a live test completed the
existing worker -> question -> answer -> resumed result -> human acceptance flow
in one linked conversation. The previous local-model outage is no longer a
blocker for this deployment. The test schedule remains paused.

## UX correction validation

The September 10 correction replaces heuristic routing with configured-model
selection, adds nested decomposition previews, restores the real AutoPilot
identity, and supplies immediate chat context. The v0.4 demo is the interaction
reference. Goblin Tools Magic ToDo was exercised with two large outcomes and a
nested branch to compare progressive decomposition.

Frontend task and affected chat integration tests passed: 364 tests across 34
files. Frontend-wide formatting, lint, types, and the local production build also
passed. Database regressions cover stale planning responses, concurrent explicit
assignment, preview acceptance without execution, inherited prerequisites,
planning holds, existing-step delegation, and preserved results/conversations.
The configured provider also passed a live model test using only synthetic
profiles: AutoPilot retained the parent and each of five specialist workstreams
was routed to its matching fictional Expert. No private Expert profile or real
user task was submitted during that model acceptance test.

The regular-chat nesting report was reproduced and covered by a tool-through-
database regression. Late additions also cover stable checklist ordering and
rejection of premature coordinator results. The task suite now has 30 passing
tests, alongside 131 existing worker/question/permission regressions.

Shared AutoPilot prompt guidance now teaches actual Expert selection, durable
capture and nesting from regular chat, task-owned versus ad hoc delegation,
AutoPilot parent ownership, prerequisite-aware handoffs, and result acceptance.
The shared notes reach both baseline and SDK transports after the configurable
base prompt, while Expert-specific guidance remains gated by the existing team
feature flag.

Downstream task turns also receive prerequisite results and recent activity from
parent outcomes, so an Expert gets the accepted handoff details with its task
brief instead of only prerequisite IDs.

## Cross-project prerequisites

The task editor supports multiple prerequisites across the user's projects,
with task/project search and visible completion state. Editing a title preserves
all prerequisite links. Project filters do not hide other projects from the
picker; parent outcomes and their descendants cannot be selected as their own
prerequisites.

The existing dependency engine gates nested work until every prerequisite is
completed. The task tool now accepts owned prerequisite IDs outside the current
outcome and can discover them using `list(all_projects=true)` or
`list(project="Procurement")`. Linked chats default to their existing branch;
Experts reading or depending on another project do not gain permission to assign or
approve its work. AutoPilot has explicit workspace management operations. Shared prompt guidance explains these rules, and prerequisite
handoffs include their source project. Database tests cover cross-project
unblocking, cycles, chat discovery, and rejection of another user's task IDs.

## September 11 deployment verification

The UX correction and cross-project follow-up are live on `AutoGPT-Tasks` at
`http://192.168.1.193:3004/tasks`, with source revision `6915b6ba73` and image
`autogpt-tasks:release`. Both builds ran on the local Linux development machine.
The running backend source hashes match the committed files, the container is
healthy, and the login page and frontend assets return HTTP 200.

The update used Unraid's native Docker Manager command generated from the current
Orgs Stack-based Tasks template. All 21 editable variables, the dedicated data
mount, LAN port, and working Edit action were verified after replacement. The
other AutoGPT/Orgs/Executor container IDs and the source Orgs template are
unchanged. The previous release image remains available for rollback.

Validation passed: whole-backend and whole-frontend formatting, lint, and types;
33 Tasks backend tests; 73 shared prompt tests; 10 Tasks frontend integration
tests; and a local production frontend build. In the isolated local container,
browser-driven selection saved two prerequisites across three projects while a
project filter was active. Editing the title preserved both links in the database
without starting execution. Desktop and 390px phone layouts were inspected; the
phone document width remained 390px. Screenshots are saved locally at
`/tmp/tasks-cross-project-desktop.png` and `/tmp/tasks-cross-project-mobile.png`.
The disposable QA container and temporary source/build copies were removed after
deployment; the worktree and release images were retained.


## Automatic reconsideration and self identity

Unassigned active tasks are reconsidered when relevant context changes: their
brief or ancestors, prerequisite status/results, their linked or source chat,
and eligible Expert roles, skills, identities, or availability. Tasks list loads
and an independent 30-second scheduler job trigger checks. Recent or running
chats settle first; stable fingerprints, request leases, and bounded concurrency
prevent repeated model calls. Assigned tasks are excluded.

An existing unaccepted breakdown preview can refresh with the same detail and
guidance; the system does not automatically create a new breakdown or accept it.
A refreshed preview keeps the user's editing draft visible until they choose
**Review updated suggestion**. Stale acceptance and late model responses cannot
overwrite changed ownership or context. Failed refreshes retain the older preview
and show a retryable error.

The current human is consistently **You**, including cached suggestions,
alternatives, and breakdown steps. Profile display-name changes do not require
another model recommendation.

## Human results and AutoPilot management

Human or unassigned work has a **Submit result** form in task details for written
outcomes and deliverable links. A successful submission records the result and
version, completes the work, and passes the evidence to the coordinator and
cross-project dependents. Failed submissions retain the draft. Results can also
be added after quick checkbox completion. Agent work still requires result review,
and required unfinished children still block parent completion.

AutoPilot's `manage_tasks` tool supports `edit`, `reparent`, `assign`, `cancel`,
`reopen`, `pause`, `resume`, and `retry` across the user's workspace, including
regular conversations. `reparent(task_id, new_parent_id, project?)` edits the
existing record; null detaches it to the top level. It inherits the new parent's
project unless overridden, carries matching child project labels and review
items along, and preserves ID, ownership, conversations, answered questions,
results, dispatch history, and activity. Versions advance normally. Dependency
cycles, foreign task IDs, and adding execution barriers to active work are rejected.

Metadata corrections and moves can preserve an active attempt. Reassignment and
cancellation require stopping active attempts with `pause` and waiting for the
existing worker cancellation to finish. Reassignment preserves the previous
conversation and handoff evidence, retires stale review items, and keeps the pause
until `resume`. AutoPilot should release only a pause it introduced for that
handoff. Existing planning holds and Expert permissions continue to apply.

`cancel` retires a task and its unfinished branch without hard deletion. Completed
child evidence remains available in the **Canceled** view, and individual tasks
can be reopened. Expert sessions retain delegated-branch assignment/review scope;
only an authenticated AutoPilot session can use workspace management. The
persisted current conversation binding remains authoritative after breakdowns
preserve original work in a child.


Validation for this follow-up: 53 Tasks database tests and 19 shared-prompt tests
passed. Whole-backend and whole-frontend formatting, lint, and type checks passed,
as did all 15 Tasks page integration tests and a local production frontend build.
Coverage includes human-result persistence and prerequisite handoffs, moving an
active Expert task without losing state, safe owner changes, cancellation and
recovery, current session authority, and background reconsideration with draft
preservation. Deployment verification is recorded separately after rollout.
