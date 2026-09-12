# Tasks UX correction

The reference is the interactive v0.4 demo, with the user's clarification that
explicit Expert assignment already starts work correctly. The missing routing
must use a configured model rather than keyword overlap.

| Interaction | Deviation in the first implementation | Correction |
| --- | --- | --- |
| Capture and routing | Generic Auto fallback and keyword matching; suggestions do not refresh after context changes | Model-based selection from eligible existing Experts, AutoPilot, and the user; show the selected identity, reason, alternatives, and a pending/error state |
| Decomposition | Only manual Add step exists | Visible Break down action with a model-generated, editable/selectable preview; acceptance adds nested steps without losing existing work |
| Coordinator | Auto has a separate name and sparkle avatar | Reuse the actual AutoPilot identity, avatar, conversation, and coordination behavior |
| Open chat | Only the session title is populated; context is fetched indirectly after a message | Show the task brief immediately and include the outcome, parent/project, ownership, steps, and waiting decisions in model context |
| Assignment | Expert execution works, but the unconfirmed recommendation is too generic | Preserve one-click confirmed assignment and automatic queueing; routing never silently changes confirmed ownership |

Validation will follow the first-session journey: paste work, receive a real
Expert recommendation, inspect its reason without dispatching, break work into
editable steps, keep a human step, confirm an Expert, and open its contextual
conversation. Planning holds and existing work must survive decomposition.

The user confirmed that AutoPilot retains the outcome while Experts own subtasks.
The acceptance example has five workstreams: grid design, product assortment from
orders, website listings, bulk printing support, and procurement. Suggestions must
reflect whichever of those capabilities actually exist in the user's roster;
missing Experts must never be invented.

Additional integration fixes found during the audit:

- AutoPilot can delegate existing unassigned planned steps without duplicating
  them or overriding a confirmed owner.
- Prerequisites inherited from a parent gate both automatic dispatch and chat
  worker admission.
- After preserving prior work as a child, questions use the current persisted
  task ID even if the session metadata was cached before the split.
- Opening a review item uses the original deliverable's conversation.

A running attempt must be stopped before accepting a decomposition that changes
its scope. The preview itself remains available while work is running.

The later regular-chat report exposed a separate boundary error: `add_step`
ignored its supplied parent ID unless the current chat was already task-linked.
It now accepts an owned parent ID, creates actual nested tasks, and supports
workspace/branch reads from regular chat. Those children remain unassigned with
suggested owners until execution is authorized through delegation.

The live synthetic coordinator test also found premature parent-result submission
with unfinished child steps. The result lifecycle now rejects that submission
and directs the coordinator to finish delegation and child-result review first.
Phone inspection led to placing row controls below task text on narrow screens.


The result-submission and management follow-up addresses two further gaps. Human
work now has a result form, with evidence passed into dependent task context.
AutoPilot now edits and moves existing task records directly, explicitly reroutes
owners, and cancels duplicate branches with recoverable history. It no longer
needs to copy an existing task to change its parent or project. Automatic
reconsideration remains limited to unassigned work, and current-user identities
are displayed as **You**.
