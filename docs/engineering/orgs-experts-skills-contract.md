# Organization scope for experts and private skills

Phase one supports one owner working in several organizations. Experts remain
owner-private; `PRIVATE` is a visibility rule, not a synonym for personal org.
The default team remains an internal authorization boundary.

## Expert scope

- `hire_expert` and `create_raised_expert` accept `organization_id`. Omission or
  `None` means the original personal org. Explicit orgs require live membership
  and use their default team. Hire uniqueness is owner + org + template; a
  re-hire revives that org's copy without moving it.
- `resolve_private_expert_tenancy(user_id, expert_id)` returns the expert's
  saved org/team after owner, visibility, active-state and live-access checks.
  Scheduled work and credential matching must use that result.
- `get_expert(..., organization_id=...)` distinguishes three cases. Omitted
  scope uses the saved expert tenancy; explicit `None` restricts the lookup to
  the original personal org; a string restricts it to that exact org. Session
  tools must pass the saved session org, including `None` for legacy sessions.
- Lists, archived identity rosters, setup items and pods accept org scope.
  REST object routes additionally check that the saved expert org matches the
  authenticated request org. Templates remain public and global.

## Skill scope and lifecycle

`resolve_skill_registry_scope(user_id, expert_id=None, organization_id=None)`
returns `SkillRegistryScope(organization_id, team_id)` and checks live access.
For an expert, its saved org is authoritative and an explicit different org is
rejected. Without an expert, `None` resolves the original personal org. It is
available through both local and RPC `skill_learning_db()` accessors.

Registry list/read/write/delete/package/context helpers accept keyword
`organization_id`. They resolve scope before cache access and use regular
org/team workspace files. Private skills no longer use `user_global_config`.
Index, reconciliation, update-notice, backoff and write-lock keys include org.
Built-in read-only skills remain global.

Lifecycle records carry `organization_id`; their owner key is
`org:<organization_id>:<expert_id or personal>`. `owner_key_for` is a pure key
formatter; callers must resolve scope before using its legacy `None` form.
`SkillVersionRecord.organization_id` is durable publication scope. Recovery
writes use the version's saved org and reject a different `user_id`.
Sources, approvals, decisions, history, suppressions and usage are scoped to
the same owner key. Chat evidence checks normalize legacy personal sessions
before comparing them with migrated source records.

`run_skill_learning_pass(user_id, *, source_ids=None, trigger="nightly",
config=None, organization_id=None)` remains once per user in the nightly
wrapper. Omitted org processes sources across saved orgs independently;
explicit org filters selection and reconciliation. Each source/review/version
supplies its own publication scope. Memory publication calls
`link_version_to_memory(user_id, version, organization_id=version.organization_id)`.

Marketplace submissions record their originating org. Private submission
management and package reads stay in that org; approved marketplace listings
remain intentionally public. Marketplace slugs remain globally unique.

## Browser requests

Private hooks live in `services/{experts,skills,skill-learning}/scoped-queries.ts`
and `scoped-mutations.ts`; private skill marketplace hooks are under
`services/skills/marketplace`. They wrap generated hooks and accept an optional
final `PrivateResourceScope` argument after `queryClient`. The default is the
active org/team. Explicit saved-session scope is required for deep-linked chats
when navigation is in another org. `useExpertMap(scope?)` exposes that option.

Query keys include org/team, requests pin the same headers, and previous-scope
placeholder data is disabled. `get*QueryKey` imports remain generated keys for
prefix invalidation. Supplying headers in `options.request` does not override
the wrapper's scope: callers with a saved scope must pass the final scope
argument as well.

## Migration and integration

The migration keeps legacy expert and skill data in the original personal
org. Workspace skills are moved from user-global metadata to that org's
default team, preserving their storage objects. The immutable workspace-scope
trigger is disabled only within the migration transaction/table lock and is
restored before commit. Learning sources use a saved conversation org when
present; legacy personal sources and skill history stay personal.

Drain old API/worker processes before this migration and start the matching
code together: old writers still use global skill files and legacy owner keys.
Back up the database before deployment. New orgs do not inherit private skills
or expert credential grants.

Connections integration supplies `store.scoped(org)`,
`_user_credentials(user_id, organization_id)` and the keyword-only
`organization_id` on `match_user_credentials_to_graph`. Memory integration
supplies the keyword-only org on `link_version_to_memory`. Personal-routine
persistence and memory storage are owned by their separate implementation.
