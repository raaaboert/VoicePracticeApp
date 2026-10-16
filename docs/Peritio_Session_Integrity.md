# Simulation session lifetime and score finality

Registered learner sessions use the immutable server-recorded `serverStartedAt`.
The current organization's configured `maxSimulationMinutes` governs conversation
time (default 20 minutes, existing supported range 1–240). Neither client elapsed
time nor `lastSeenAt` extends that deadline. Openings, turns and re-registration
are denied at the deadline, after usage completion, or after a score is stored.
Unified audio submissions validate runtime before starting transcription.

Usage finalization and first-time scoring have the established 20-minute
completion grace, not extra conversation time. Their absolute deadline is
`serverStartedAt + maxSimulationMinutes + 20 minutes`. Once usage is recorded,
first scoring also expires at `usageRecordedAt + 20 minutes`, whichever deadline
is earlier. The existing null-maximum fallback remains an eight-hour completion
cap, with the final 20 minutes reserved for completion. Paid enterprise requests
normally have an organization-configured maximum.

Usage recording and scoring may arrive in either order. Usage retries return
the original record without charging again. First scoring during grace does not
require another conversation-minute allowance; independent provider budgets and
current account/organization access still apply. Persisted scores can be recovered
after expiry with current user and organization authorization. Unknown session
IDs cannot generate scores. Older clients using recognized session registration
retain their request/recovery contract; unverifiable IDs fail closed.

Ordinary scoring reads current PostgreSQL state before evaluation and inserts
under the existing deterministic `score_<sessionId>` primary key with
`ON CONFLICT DO NOTHING`. Concurrent requests return the persisted winner, never
their losing generated result. No database lock or transaction is held during
provider work. Two simultaneous first requests can both evaluate; this design
guarantees one authoritative result, not exactly-once provider execution. A new
durable generation lease would require separate review if that is later required.
Existing scoring schema, rubrics and prompts are unchanged. No migration is needed.

Abandoned session identities are no longer deleted by the former 48-hour startup
pruning pass, because deleting them would allow an expired ID to be registered
again. Existing account deletion/deidentification remains applicable. This adds
ledger retention/storage growth; it does not retain conversation transcripts.
IDs already deleted before this revision cannot be recognized retrospectively.

Session duration is separate from daily per-user allowances and organization
daily/monthly entitlements. Existing Master Utility controls include monthly org
allotments, default per-user daily minutes, individual overrides and temporary
overages. Organization session maximum and daily quota also remain configurable
through the existing platform-admin API. No dedicated session-maximum input was
found in the current Master Utility UI. Customer Org Admins can adjust default
per-user daily minutes now or next cycle, and authorized individual overrides and
temporary overages; they cannot change the org session maximum or monthly
contractual allotment. User Admins do not gain usage-control authority. No new
allowance controls, allocation rules or permissions are introduced here.

Deployment rollback must not resume historical score upserts or expired-session
pruning: reverting to older code restores those weaknesses. No stored score or
usage history is rewritten by this change.
