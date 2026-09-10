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
- Suggested identities, explicit human/Auto/Expert assignments, inherited planning
  holds, pause/retry, dependency gates, and progress over accepted required leaves.
- Task conversations use the existing chat routes and permission intersection.
  Existing executor admission and credential routing remain authoritative.
- Durable questions can be answered from Tasks or the existing chat question card.
  The question ID prevents stale answers; failed submissions retain the draft.
- Agent results require explicit acceptance. Review items remain ordinary tasks;
  Auto can review delegated child results, and changed child work wakes its
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

Assignment suggestions use task/project context and existing Expert profiles;
this is a small ranking heuristic, not a new recommendation model or memory
service. Tasks use existing chat permissions and budgets rather than defining a
second execution or authorization system. A workspace is capped at 1,000 tasks.

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
