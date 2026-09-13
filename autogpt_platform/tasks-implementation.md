# Tasks workspace implementation

Interaction reference: `autogpt-tasks-prd-v0.4-platform.html` (September 10, 2026).
Branch: `codex/tasks-workspace`, initially based on `origin/dev` at `7a354df889`,
updated by merging `origin/dev` at `1797a44f71` on September 12, 2026.

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
updates changed locked Python packages, the generated Prisma client,
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


## September 12 runtime verification

The result and management release was deployed as source revision `052a170984`
on the existing `AutoGPT-Tasks` instance. All 21 template variables, the data
mount, port, Edit action, and other AutoGPT instance IDs were verified unchanged.
Seven backend source hashes and the Tasks page bundle matched the tested local
build; the Tasks entry point and sampled frontend assets returned HTTP 200.

Local production-container browser checks submitted a human result, retained it
through reload and reopening its editor, and showed the recoverable Canceled
view. Phone screenshots measured a 390px document at a 390px viewport. The app's
authenticated API moved that result into another project without changing its
identity or evidence, replaced a confirmed owner under a planning hold, and
canceled/reopened the same record without execution. The management tool's
permission and state-preservation paths were tested against the isolated task
database; a separate standalone container tool script was not completed, and
runtime management verification used the authenticated API instead.

A final handoff regression found that answering an inherited question after
reassigning an Expert task to a human queued an agent dispatch. Human answers now
remain recorded without dispatch, completion clears any stale dispatch marker,
and answers cannot implicitly reactivate canceled/completed tasks.

## Execution controls and question synchronization

The task row distinguishes proposed scope, held execution, stopped attempts,
prerequisite waits, and completed work. A stopped-attempt indicator opens its
conversation. Start releases only the selected branch's inherited planning hold;
siblings stay held, parent pauses and unaccepted scope remain barriers, and real
prerequisites still gate dispatch. Applying Hold again revokes descendant Start
overrides and removes ineligible queued dispatches. Human result submission
unblocks linked prerequisites without manufacturing a dependency from numbering.

The current chat question chain now retains the task/question identifiers and
submits through the existing Tasks answer command. It resolves a question moved
into an original-work child, prevents duplicate continuation, retains draft
answers on error, and refreshes Tasks, Home, and the linked chat. Ready connector
and input context accompanies the structured answers. Ordinary chat questions
send their answers directly, following the updated `dev` interaction.

Task question creation and resolution update Home's pending-question marker in
the same database transaction, preserving unrelated session metadata. Stale
answers cannot clear a newer question. Answering held or human-owned work records
the answer without a phantom dispatch; an ordinary injected chat turn cannot
clear an unanswered task question. Canceling a questioned task clears its Home
reminder while preserving history.

`../tasks-breakdown-options.html` retains the D1 and D3 finalists after the
user eliminated A, B, C, and D2. Both support editable titles and deliverables,
expandable prerequisite/owner details, and the original D chat composer. The
preview is hosted at `http://192.168.1.193:3004/tasks-breakdown-options.html`;
its sample data does not create or execute real tasks. Desktop and 390px phone
checks exercised generation, editing, refinement, disclosure, and acceptance.
The selected production layout is D3.

Validation: 61 isolated Tasks database tests, 24 question-tool tests, and 79
frontend integration tests covering Tasks, the real chat action chain, connector
coexistence, and Home Needs You passed. Whole frontend/backend formatting, lint,
and type checks were run. Runtime deployment verification follows separately.


## Execution and question-sync rollout

Source revision `f9c14503d9` was built locally, then deployed to the idle
`AutoGPT-Tasks` instance using its existing Orgs-based template. Health,
all 21 variables, data mount, port, Edit metadata, and other container IDs
were verified. The prior image remains available for rollback.

The local production-container browser started one synthetic task with Play,
verified its sibling stayed held, opened its linked chat, selected Blue in a
real model-generated question, and submitted once. The task recorded the answer,
the Home question disappeared, and the chat showed `Chosen color: Blue` without
a reload. The result remained ready for review; the sibling never dispatched.

The reported live Juno BOM record was linked to the user's completed
configuration through the existing version-checked Tasks command. Its ID,
conversation, owner, attempt state, and parent hold were preserved. This repaired
the missing prerequisite relationship without restarting the previous attempt.


## Compact conversational breakdown (D3)

Break down opens an inline preview beneath the selected task and immediately
requests actionable steps. The chosen D3 layout keeps rows compact, with click-
to-edit titles and owners; expanding a row reveals an editable deliverable,
prerequisites, and the reason for its suggested owner. The traditional chat
composer accepts follow-up guidance and shows the user's messages alongside the
preview. No new tasks are created until the selected steps are accepted.

Refinement sends the current edited draft to the planner and validates that it
belongs to the current preview. It preserves dependency links, retains the draft
when model generation fails, and records edited descriptions on accepted tasks.
Explicitly requested refinements update the displayed preview when ready;
background reconsideration retains the existing review-before-replacement rule.
An epic's default breakdown now explicitly calls for actionable deliverables.

A mixed question/connector regression reproduced a second continuation after the
question card disappeared. The task answer now claims the chain's send before
awaiting its state refresh, and releases that claim on failure. Ready connector
context travels with the task answer in one continuation.

Validation: 62 isolated Tasks database tests and 81 frontend integration tests
passed, including the D3 generate/edit/refine/accept flow and the mixed-card
regression. Whole frontend/backend format, lint, and type checks passed; the
production frontend was built on the local Linux host.


## Latest dev integration

The development branch was merged without rebasing. Chat conflicts retain both
`dev`'s direct-send question flow and Tasks' atomic answer submission, error
recovery, and duplicate-continuation guard. The container update also includes
Expert schema migrations, the regenerated Prisma client, locked sandbox SDK
dependencies, and the current single-container entrypoint.

A reassigned task remains in Needs You while its question is unanswered. Saving
the answer clears the matching Home reminder from the previous conversation,
without clearing other questions or dispatching a human-owned task.

Merged-source validation passed: 118 Tasks, question-tool, and Home backend
tests; 17 single-container entrypoint tests; and 558 frontend integration tests
across 37 files. Whole backend/frontend formatting, lint, and types passed.

Production-container browser validation used only the fictional color-card kit.
One click generated three actionable steps and matched Mira, Forge, and Mill to
their roles. Editing a title and deliverable, then refining through the chat
composer, retained the edits without creating tasks. Explicit acceptance created
exactly three children, retained AutoPilot on the parent, saved a further phone
edit verbatim, translated prerequisite links, and dispatched nothing under the
planning hold. Desktop and 390px phone layouts were inspected; phone document
width stayed at 390px, with the composer and acceptance action reachable.

Source revision `717675a42e` is deployed and healthy on `AutoGPT-Tasks`. The image
was built on the local Linux host and transferred to Unraid without a remote
build. All 21 template variables, the data mount, LAN port, and Edit action were
preserved; the other instance IDs and source Orgs Stack template are unchanged.
Live checks matched nine Tasks backend files, the schema, dependency lock,
entrypoint, and Tasks/chat page bundles to the tested build. The Tasks entry and
assets returned HTTP 200. The standalone prototype URL was restored and its
content hash verified. `autogpt-tasks:pre-d3-20260912` retains the prior image.


## Suggested owner controls and mobile header

Suggested owners use one dashed pill around the avatar and name, including
owners in breakdown drafts. Desktop hover and keyboard focus reveal inline
accept/dismiss actions without moving the pill. Touch users tap the pill to
review the reason and use labeled Confirm/Dismiss buttons. Quick keyboard
actions return focus to the owner after saving while respecting focus moved
elsewhere. Confirmed ownership keeps its existing plain appearance.

Dismissal is a separate versioned command bound to the displayed suggestion
request. It keeps the task unassigned and preserves execution state, history,
and work. The current planning context is recorded so the same suggestion does
not immediately return; changed context or an explicit suggestion request can
produce a new one. Late model responses cannot restore a dismissed suggestion.
Legacy suggestions without a request ID use the same durable behavior.

The Tasks subtitle is removed. Status filters have tighter spacing and stay in
one horizontal row on mobile, scrolling within the filter strip when needed.

Validation: 67 task backend tests and 22 Tasks frontend integration tests pass.
Whole backend/frontend formatting, lint, and type checks pass. Coverage includes
quick acceptance, touch-menu dismissal, error recovery, keyboard focus, stale
suggestions, explicit regeneration, and reconsideration after context changes.

Production-browser validation passed with three fictional, held tasks. The QA
provider key reached its daily cap, so suggestions were seeded in that test
account; fresh model generation was not verified in this pass. Acceptance and
dismissal used the real application and database. Desktop hover preserved pill
geometry, the outline enclosed the avatar and name, and keyboard acceptance
returned focus. At 390px, the phone had no document overflow, the filters stayed
on one row, and Canceled remained reachable by scrolling. Tap-to-review exposed
44px Confirm/Dismiss controls. Dismissal survived reload and background polling;
all three tasks retained their execution hold and created no dispatch.

Source revision `465f567695` is deployed and healthy on `AutoGPT-Tasks`. All 21
editable template variables, the data mount, LAN port, and Edit action remain
intact. Other instance IDs and the source Orgs Stack template are unchanged.
Live checks matched ten Tasks backend files, the schema, dependency lock,
entrypoint, Tasks/chat bundles, and ten CSS assets. Full JavaScript and CSS
responses matched the tested build byte-for-byte, and the Tasks entry returned
HTTP 200. The prototype URL was restored and its content hash verified.

The first image import exhausted Docker's Btrfs metadata allocation. An
incremental archive reused 84 existing layers and transferred ten new layers
(79 MB), retaining the tested image configuration digest. One unused management
preview (`management-release` / `pre-execution-20260912`) was retired after
verifying its local copy and absence of container references. Five unreferenced
metadata records left by failed imports were moved to
`/tmp/tasks-owner-failed-import-metadata-20260912` on Unraid. The current and
immediately preceding releases were preserved; `autogpt-tasks:pre-owner-20260912`
now retains the previous live image. No shared Docker or host restart was used.

The prototype deployment helper now runs nginx configuration checks and reloads
as `autogpt_proxy`. Running the check as root had changed temporary-directory
ownership to `nobody`, truncating large proxied asset responses. The five nginx
temporary directories were restored to their entrypoint-defined service owner;
complete asset downloads and ownership were verified after the corrected reload.

After the host reboot, Unraid returned at `192.168.1.192`. Tasks could not
start because its saved port binding still used `192.168.1.193`. The Tasks
container was recreated from the same image and persistent data, changing only
its template's port host address and `AUTOGPT_PUBLIC_URL`. The current endpoint
is `http://192.168.1.192:3004/tasks`. Startup health, the Tasks page, a complete
CSS download, the restored prototype, and Unraid Edit were verified. All 21
variables and other container IDs were preserved; the host was already online.

## Mobile scroll recovery

The mobile recording showed task rows disappearing during movement while the
header remained stable. Each scroll event updated the whole Tasks page's React
state, then an effect wrote that saved position back to the scrolling element.
That feedback interrupted WebKit's native scrolling. Position now lives in a
ref, with storage saved after a 200ms pause and flushed on navigation, pagehide,
or hiding the tab. Restoring the DOM position happens only when the list mounts
or the user's saved view loads. Existing per-user saved views remain compatible.

The regression failed on the original code with four programmatic position
writes for four native scroll events. All 25 Tasks integration tests now pass,
including position persistence before a pending save completes. Whole frontend
formatting, lint, and types passed, followed by a local production build.

An isolated browser fixture used the actual Tasks list, header, capture form,
and view hook with 42 fictional tasks. WebKit and Chromium both measured zero
page renders and zero programmatic scroll writes during gestures after the fix;
the original code performed both repeatedly. Changing views and reloading still
restored the position. The packaged production frontend's login and complete
asset responses passed before deployment.

Revision `45d746bbe5` is deployed and healthy at
`http://192.168.1.192:3004/tasks`. The update reused the existing backend and
frontend dependencies, adding one frontend layer transferred as a 20 MB archive.
All 21 variables, the data mount, LAN binding, Unraid Edit, other container IDs,
and the Orgs Stack template were preserved. Live Tasks/chat JavaScript and ten
CSS assets matched the tested build byte-for-byte. The prototype route was
restored using nginx's service account. The previous image is retained as
`autogpt-tasks:pre-scroll-20260912`.

## Question recipients and deliverable review (September 13)

Each task question can target You, AutoPilot/Otto, or an eligible Expert without
changing the task's owner. `ask_question` accepts a recipient per question and
uses the existing team roster. Approvals and account setup stay human; specialist
advice returns automatically. Regular chats retain `delegate_to_expert` for ad
hoc teammate communication.

A directed question uses an optional child task and the existing durable worker
queue. Its conversation receives the question and parent context with read-only
tools. Submitting the answer fills its source question, with attribution, and
resumes the original task once all required answers are present. Redirected or
stale replies cannot overwrite a newer question. Human drafts and additional
context survive while other recipients answer. Chat and Home use only the
unanswered human questions for their reminders.

Tasks and both chat question forms expose an Answer from control for each
question. Human-only purposes explain why their recipient is fixed. Teammate
questions show who is answering and link to the consultation conversation.

A submitted draft with outstanding questions occupies one visible task row;
its former approval row is folded into it, including in task/filter counts.
The same details panel shows the draft, deliverable files, and questions.
Acceptance waits for the questions to be resolved and an updated result to be
submitted. The combined row persists while that update is in progress.

Workspace links in results use the same authenticated URL conversion as chat,
fixing the Markdown renderer's `[blocked]` label. Referenced file cards provide
preview and download, reusing the existing artifact renderer. Files mentioned
by name can be matched against the linked conversation's file list. Preview
returns to the review's Accept result and Request changes controls.

The stopped-attempt circle now has a portaled hover/focus explanation and a
click/tap popover with an explicit Open chat action. Inspecting it does not start
a conversation. Waiting for a teammate does not show a stopped-attempt warning.

Validation: 73 Tasks database tests passed in a separate local database; 24
question-tool tests passed with metadata RPC calls isolated. The final frontend
lint/types checks and 125 relevant integration tests passed. Chromium and WebKit
fixtures exercised the actual changed components at desktop and 390px touch
sizes: help, recipient changes, preserved drafts, preview/download, and return
to review passed without horizontal overflow. Screenshots and proof are in
`/tmp/tasks-collaboration-harness/`. These browser checks used fictional data,
not the user's authenticated browser session.

The release is deployed at `http://192.168.1.192:3004/tasks`, code revision
`c0650ddaadb62c3be0f47632da68801b26154083`, image config
`sha256:66c7182805a847a852086df25d18853c32f262cf3f03f246810e4a310d631764`.
The container is healthy, all 45 live page assets match the tested build, the
installed backend exposes the recipient schema, and the prototype route and
Unraid Edit action work. The Orgs template, 21 variables, appdata mount, and
other container identities are preserved. The active software-factory run was
allowed to finish before deployment.

The first packaging attempt rolled back after startup timed out: the local
shell's restrictive umask left copied backend directories at 0700. Incremental
packaging must set every backend overlay directory to 0755 and files to 0644;
BuildKit's cached copy layer must be invalidated after directory-mode changes.
The corrected image was checked as the production `autogpt` user with a writable
temporary data directory and cached tokenizer data before deployment. Nginx
configuration tests/reloads continue to run as `autogpt_proxy` to preserve its
cache-directory ownership. The previous working image remains available as
`autogpt-tasks:pre-collaboration-20260913` for rollback.


## Clarification conversations retain tools (September 13, 2026)

Tasks no longer construct or narrow tool permissions, including while waiting for
an answer, on a planning hold, or in a teammate consultation. Platform, user,
Expert, and inherited execution permissions remain intact. Task context explains
waiting for input separately from explicit execution constraints; dispatch,
planning holds, dependency checks, and result-approval rules remain in place.

The SDK now consumes the executor's workspace-task context on every turn,
including resumed sessions. Reduced-context retries and queued user follow-ups
fetch a fresh snapshot. The baseline engine receives the same task context.

`manage_tasks answer_question` records selected question answers from saved user
messages, including partial answers and corrections. `source_quote` can identify
an earlier answer when recovering an already-stuck conversation. The database
checks user/session ownership, the current question ID, message timing and role,
and verbatim evidence. Earlier messages cannot overwrite a later recorded answer.
Unrelated replies leave questions open. An empty answer map saves relevant context
without resolving anything. Tasks and Home update atomically, and the active chat
continues without queuing a duplicate dispatch. Recording an answer does not
release a planning hold, accept a result, or complete account authentication.

Validation: 80 isolated Tasks tests; 194 permission/baseline tests; SDK generator
checks for new, resumed, retried, and queued-follow-up turns; whole-backend
formatting, lint, and type checks. Five synthetic Claude Sonnet 5 checks through
the deployed provider selected the expected answer/authentication actions,
preserved a separate publishing approval, left a status request unanswered, and
recovered an answer already in conversation history. Those model checks inspected
proposed calls only; no repository or integration actions were executed.

The broader SDK retry suite has an order-dependent stall around tests that mock
`asyncio.sleep`; the reduced-context transient-retry case passes independently.
The new task-context generator cases pass together. Provider routing and the
independent Unraid bubblewrap failure are outside this change.
