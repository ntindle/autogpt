# Private Tasks integration with nightly learning

Design proposal only. Keep this document and all Tasks-specific implementation out of the draft PR against dev.

The user wants general nightly learning across Expert conversations. Tasks is a private feature whose procedural evidence becomes eligible only after the relevant result is accepted. Fable is explicitly trusted to review this internal context.

## Observed behavior

Memory capture is already active. The inspected Expert namespaces contained Rex: 70 episodes/339 relationships; Walt: 12/42; Otto: 42/151; Dax: 32/86. These are storage counts, not proof that each entry is accurate or useful. Skill writing is enabled. The recent batch of 14 skills came from explicit skill-creation assignments; an older software-factory playbook was saved during ordinary task work. These observations do not establish a dependable nightly learning loop.

## Private adapter

The generic learner receives a source identity, immutable revision, scope, evidence references, outcome, verification signals, and eligibility checkpoint. The checkpoint identifies the accepting actor and acceptance event. At apply time the adapter revalidates that exact event and revision against current access, exclusion, and revocation; publication uses the fresh eligibility version as a precondition. The generic learner never imports Tasks models or queries Tasks records. This private branch would implement a producer adapter for that contract.

- Capturing, assigning, decomposing, scheduling, answering questions, or submitting a draft does not approve a procedural skill source.
- Accepting a particular result revision makes only that revision's evidence eligible for nightly review. A parent being complete cannot stand in for acceptance of every child; accepted child results may be eligible independently.
- Reopening work or submitting a newer result does not retroactively approve it. The approved snapshot remains distinguishable from subsequent conversation content.
- A drafted deliverable with unresolved questions stays ineligible. Answering those questions permits work to continue but is not result acceptance.
- The adapter verifies the accepted result is current and has a real evidence snapshot. It does not infer acceptance from a status label or the agent saying it finished.
- Reparenting preserves source identity and history. Reassignment or scope changes require renewed access/scope checks before a pending learning change applies. A project move that removes owner access uses the general evidence-revocation path.
- Canceling unaccepted work prevents new eligibility. Canceling a parent does not withdraw an already accepted child result; an explicit acceptance withdrawal, source exclusion, or access change controls that source separately. Ordinary exclusion stops future learning. Revocation, erasure, or loss of owner access makes dependent versions, including human-edited descendants, unavailable with a visible reason.

Factual memory remains separate: a user's explicit preference or correction in an answered question can be remembered immediately under the answering user's personal scope, with its own source. That does not promote an unaccepted procedure into an active skill.

## Example: robotics deliverables

Acceptance of an architecture document can support its document-production procedure with a “Result accepted once” label. Starter firmware requires separate evidence for claims that it runs correctly. It does not prove that the robot was assembled, a motor-control loop was bench-tested, or a power design was approved. If the deliverable says its parser has not been tested, nightly learning must preserve that limitation. Reuse of the resulting skill still obeys the current user's approvals and execution permissions.

A hardware Expert's unaccepted draft must not acquire a reassuring 'Learned' badge merely because the reviewer accepted some neighboring document. Use a precise private-source status such as 'Waiting for result acceptance' in source details. The source's existing review is the single place to accept the result; the learning UI should not create a second equivalent acceptance action.

## Private UX

When learning is enabled and the source is not excluded, an accepted result can show a quiet line: 'Available for nightly learning.' It is not a promise that a skill will be created. If the review later makes a useful change, link the result to that change and its source evidence. Routine completion and learning remain separate states.

Tasks details, chat, and Home must agree about the accepted revision and any question still awaiting input. A user should not have to repeat an answer or accept the same result through a learning screen. Learning state never removes tools from the linked conversation or changes task ownership.

## Acceptance cases

1. A draft and a question share one task row: no procedural learning before result acceptance.
2. A selected answer is submitted in chat or Tasks: the exact option is recorded in both, but no acceptance is invented.
3. Revision 2 is accepted and revision 3 is later drafted: only revision 2 can feed nightly distillation.
4. A parent contains accepted and unaccepted child work: eligibility follows each concrete accepted source.
5. A task moves to a different project during review: retain its ID/history, recheck scope, and never leak source content across the move.
6. A documented but untested firmware sequence is accepted as a design deliverable: no manufactured test success or permission to operate hardware.
7. The user excludes a source or withdraws acceptance while a nightly job runs: a stale write cannot make it active.
8. A normal Expert conversation without a task binding still benefits from the general nightly loop.

No memory or skill changes are performed by this proposal. Implementation follows agreement on the public learning design and these private acceptance semantics.

## Review and public draft

Fable 5.1 reviewed the internal adapter and the general proposal. Its material
adapter findings are incorporated: live eligibility rechecks, acceptance event
and actor identity, accepted-child independence from parent cancellation,
artifact-production versus embedded-claim evidence, personal scope for answers,
project-move access revocation, and honest visibility when learning is paused.

The general proposal and public review record are in draft PR
[#14541](https://github.com/Significant-Gravitas/AutoGPT/pull/14541). This private document
and branch are not included in that PR.
