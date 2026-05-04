# Peritio State Summary (2026-04-23)

This document records the major work completed across this chat session after the prior `2026-04-22` state summary.

It is intentionally detailed and handoff-oriented.

This period was not another broad productization pass. It was a focused remediation cycle across:

- structural trust fixes
- risk-closure hardening
- semantics and workflow cleanup
- one final narrow audit across the same findings
- one final mobile simulation-orb containment fix

The scope in this chat was tightly centered on the ten previously identified findings:

- `F-01` through `F-05`: structural trust / scope / lifecycle issues
- `F-06` through `F-10`: lower-risk semantics / trust-language / workflow clarity issues

The final state at the end of this chat is materially stronger than the prior `2026-04-22` baseline.

The biggest truth now is:

- the major structural issues from the hostile audit were implemented, hardened, and re-audited
- the lower-risk semantics and workflow issues were cleaned up
- one adjacent mobile UI bug on the simulation orb was then fixed responsively
- the final pushed code baseline is now much closer to a trustworthy handoff point

## Current Baseline

As of the end of this summary:

- branch: `main`
- current `HEAD`: `24f0c48`
- latest pushed commit on `main`: `Close audit remediation and fix mobile orb overflow`
- previous summary baseline commit: `8f9264b`

Recent pushed commits, newest first:

- `24f0c48` - `Close audit remediation and fix mobile orb overflow`
- `8f9264b` - `Polish dashboard wording and evidence clarity`
- `53338e7` - `Clean up dashboard language and reporting hierarchy`
- `67aa6ff` - `Tighten simulation engine polish and dock separation`
- `806c831` - `Refine simulation action dock and engine emphasis`
- `235757f` - `Polish mobile status clarity and contrast`
- `d2ffa5b` - `Refine mobile simulation and landing polish`
- `0b59a34` - `Polish mobile landing and simulation surfaces`
- `14e84c7` - `Align brand assets and add adaptive icon foreground`
- `334ae82` - `Polish dashboard trust and mobile app startup flow`

Important git-history note:

- the work in this chat happened through multiple focused implementation and audit passes
- it was pushed as one final commit at the end, so the git history compresses a long remediation cycle into a single commit

## Executive Summary

This chat broke down into five major workstreams.

### 1. Phase 1 structural remediation

The first major objective was to fix the five highest-priority structural trust issues:

- `F-01` mobile scoped config fail-open
- `F-02` division-filter drilldown scope drift
- `F-03` disabled users still assignable to training packs
- `F-04` orphan assignments after user delete
- `F-05` reporting drift after user delete

Those were addressed as real logic fixes, not copy workarounds.

The main outcomes were:

- authenticated enterprise mobile flows no longer fail open to generic `/config`
- division-scoped dashboard drilldowns now preserve and enforce scope much deeper into detail pages
- disabled users are blocked from training-pack assignment at the API layer
- user deletion now deactivates live assignments
- user deletion no longer leaves reporting-backed usage/score records behind while the user row is already gone

### 2. Phase 1 risk-closure hardening

After the first structural fixes, a second pass hardened the remaining risk areas left by the initial remediation.

The important follow-up work included:

- tightening mobile fail-closed behavior around stored session boot, onboarding completion, verification completion, and protected-screen access
- auto-cleaning stale invalid training-pack assignments on assignment modal load and save
- reducing dependence on startup-only assignment cleanup by adding targeted cleanup hooks on user mutation and join-approval paths
- removing remaining user-visible delete drift for AI usage stats and support cases
- tightening dashboard/admin read behavior so stale invalid assignment rows stop surfacing as trustworthy live state

### 3. Phase 2 semantics and workflow cleanup

After the structural trust work, the next pass handled the remaining lower-risk but still trust-relevant items:

- `F-06` mobile scorecard placeholder copy
- `F-07` admin industries / segments semantics drift
- `F-08` org-join approval vs dashboard-access ambiguity
- `F-09` dashboard active-users metric label drift
- `F-10` internal / storage-oriented detail-page language

The important result from this phase was not new backend architecture.

It was:

- cleaner, more truthful wording
- less internal/storage-doc phrasing
- better cross-surface consistency
- explicit workflow semantics where ambiguity had existed

### 4. Final narrow audit of F-01 through F-10

After both remediation phases, one final narrow audit was run against only the original ten findings and their immediate adjacent sibling risks.

That audit concluded:

- `F-03` through `F-10` were closed
- `F-01` and `F-02` were closed pending runtime validation
- two small adjacent wording leaks still existed and were corrected immediately:
  - an admin Accounts page still labeled `activeIndustries` as `Segments`
  - a customer-detail helper still used internal `forward-only` / `backend storage provider` language

That final narrow audit was important because it prevented the chat from ending on self-congratulation instead of a real closure check.

### 5. Final narrow mobile simulation-orb containment fix

After the audit work was effectively complete, one final very narrow mobile fix was made:

- the animated halo/pulse behind the main AI visual on the simulation screen could extend outside the AI card on some device widths

This was fixed responsively, not by simply shrinking the halo.

The orb now:

- sizes from measured available width
- scales halo and core proportionally
- grows the visual lane enough to contain the animated halo
- keeps overflow clipping as a safety backstop

## What Was Fixed

## F-01 — Mobile Scoped Config Fail-Open

### Original problem

Authenticated enterprise mobile users could end up falling back to generic global config if scoped config loading failed.

That created a real trust problem:

- the wrong catalog could appear
- the app could silently widen into generic content after authentication

### What changed

The mobile app now has an explicit authenticated scoped-config guard.

Key changes:

- authenticated scoped config is loaded through a dedicated path instead of fail-open fallback behavior
- protected authenticated screens require valid scoped config
- scoped-config failure routes to a fail-closed error state
- retry and sign-out behavior were made explicit
- superuser active-org behavior was preserved
- unauthenticated/global bootstrap behavior was preserved

New helper files added:

- `mobile/src/lib/scopedConfigGuard.ts`
- `mobile/src/lib/scopedConfigGuard.test.ts`

Main mobile integration point:

- `mobile/App.tsx`

### Current status

This is now closed in code.

Remaining practical note:

- it still benefits from manual device/emulator confirmation under forced scoped-config failure

## F-02 — Division-Filter Drilldown Scope Drift

### Original problem

Division-filtered aggregate dashboard views could still drill into broader org-level pages deeper in the stack, especially:

- training-pack detail
- assignment detail
- attempt detail

### What changed

Division scope is now threaded and enforced end-to-end:

- links preserve `divisionId`
- route-level fetch helpers preserve `divisionId`
- page-level `searchParams` preserve `divisionId`
- backend route handlers re-resolve division scope using explicit org context
- backend builders and query filters enforce the requested scope
- out-of-scope assignment detail and attempt detail fail closed with `404`

Main touched areas:

- `peritio-web/src/components/dashboardDivisionFilterState.ts`
- `peritio-web/src/components/dashboardDivisionFilterState.test.ts`
- `peritio-web/src/lib/auth.ts`
- `peritio-web/app/app/customers/[customerId]/page.tsx`
- `peritio-web/app/app/training/[trainingPackId]/page.tsx`
- `peritio-web/app/app/training/[trainingPackId]/assignments/[assignmentId]/page.tsx`
- `peritio-web/app/app/users/[userId]/page.tsx`
- `peritio-web/app/app/attempts/[attemptId]/page.tsx`
- `peritio-web/src/components/CustomerDetailTabs.tsx`
- `api/src/index.ts`

### Policy outcome

The final behavior is:

- training-pack detail may remain visible if the pack itself is valid, even when scoped evidence is empty
- assignment detail and attempt detail hard-fail when out of scope
- training-pack detail explicitly explains when a division scope yields empty evidence instead of widening back to company totals

### Current status

This is closed in code and code-trace validation.

Remaining practical note:

- it still deserves live clickthrough validation using real division-filtered data

## F-03 — Disabled Users Assignable to Training Packs

### Original problem

Admins could assign training packs to disabled users.

That was a real lifecycle integrity failure because the frontend UI state was not enough to protect the backend.

### What changed

The fix was applied at both the server and admin-UI levels, with server enforcement treated as mandatory.

Server-side:

- eligibility was narrowed to active enterprise users in the target org
- assignment PUT now rejects ineligible users directly
- invalid live assignments are auto-cleaned when opening or saving the assignment set

Admin UI:

- disabled users are shown as non-assignable
- stale disabled live assignments are surfaced as automatically removed
- existing disabled rows no longer have to wait for a manual save cycle just to become honest in the modal

Main touched areas:

- `api/src/services/trainingPackAssignments.ts`
- `api/src/services/trainingPackAssignments.test.ts`
- `api/src/index.ts`
- `admin-web/src/components/EnterpriseTrainingPacksCard.tsx`
- `shared/src/contracts.ts`

### Current status

This is closed.

No direct API bypass remained in the audited assignment flow.

## F-04 — Orphan Assignments After User Delete

### Original problem

Deleting a user could leave live training-pack assignments behind.

That produced orphaned lifecycle state that could later surface as fallback identifiers or misleading live rows.

### What changed

The live delete path now deactivates assignments before removing the user row.

Additional hardening also reduced the chance of stale invalid live assignments hanging around:

- targeted invalid-assignment cleanup runs on user eligibility-changing mutations
- both org-admin and platform-admin org-join approval flows trigger cleanup for the affected user
- startup integrity maintenance still repairs invalid assignment rows
- dashboard/admin read paths were hardened so invalid active rows stop surfacing as if they were legitimate live state

Main touched areas:

- `api/src/index.ts`
- `api/src/services/trainingPackAssignments.ts`
- `api/src/services/integrityMaintenance.ts`
- `api/src/services/integrityMaintenance.test.ts`

### Current status

This is closed.

Important nuance:

- dormant legacy invalid rows can still physically exist in storage until touched or repaired by integrity maintenance
- but the important trust problem is fixed because they no longer survive the normal live mutation/read paths as believable live state

## F-05 — Reporting Drift After User Delete

### Original problem

User deletion previously removed the user row immediately while some reporting-backed records were cleaned later.

That created a split-brain state:

- the user could disappear from one surface
- while sessions/scores or other visible traces still remained in reporting/admin surfaces

### What changed

The delete flow now synchronously removes trust-relevant, user-visible related records before removing the user row:

- usage sessions
- score records
- AI usage events
- support cases

Recognized simulation sessions still clean up post-commit, but they were not found to drive the same visible trust issue on the audited surfaces.

Main touched areas:

- `api/src/index.ts`
- `api/src/services/integrityMaintenance.ts`

### Current status

This is closed.

## F-06 — Mobile Scorecard Placeholder Copy

### Original problem

The mobile scorecard transcript-retention notice still displayed a literal `[Company Name]` placeholder.

### What changed

That copy was replaced with neutral, real wording because org-specific naming was not reliably available in the scorecard surface.

Touched file:

- `mobile/src/screens/ScorecardView.tsx`

### Current status

This is closed.

## F-07 — Admin Industries / Segments Semantics Drift

### Original problem

The admin enterprise-org page used `segments` wording for data that was actually `activeIndustries`.

### What changed

The org-detail surface was renamed to match the data truthfully:

- `Active Segments` -> `Active Industries`
- `Segments Active` -> `Industries Active`
- `Segment Selection` -> `Industry Selection`
- related helper/error labels were corrected too

During the final narrow audit, one adjacent sibling leak was also found and fixed:

- the admin Accounts page still showed `Segments Active` for `activeIndustries`

Touched areas:

- `admin-web/app/users/enterprise/[orgId]/page.tsx`
- `admin-web/app/users/page.tsx`

### Current status

This is closed.

Internal export field names still use some older naming, but the user-facing surfaces are now semantically correct.

## F-08 — Org-Join Approval vs Dashboard-Access Semantics

### Original problem

Approving an org join request made the user enterprise and active, but did not automatically enable dashboard access.

That made `approved` look ambiguous:

- it could be read as full org access
- while dashboard access was actually controlled separately

### What changed

The codebase was audited for intent before changing anything.

The evidence was clear:

- dashboard authorization is explicitly gated by `dashboardAccessEnabled`
- org-join approval routes do not enable that flag
- admin user controls already treat dashboard access as a separate switch

Because of that, policy was not changed silently.

Instead, workflow semantics were clarified across:

- mobile
- admin enterprise org page
- dashboard login
- dashboard access-denied page

The product now explicitly communicates:

- company membership approval and dashboard reporting access are separate

Main touched areas:

- `api/src/services/dashboardAuthorization.ts`
- `api/src/index.ts`
- `mobile/App.tsx`
- `admin-web/app/users/enterprise/[orgId]/page.tsx`
- `peritio-web/app/login/page.tsx`
- `peritio-web/app/app/access-denied/page.tsx`

### Current status

This is closed.

## F-09 — Dashboard “Active Learners” Label Drift

### Original problem

The customer-directory metric labeled `Active learners` was actually counting active enterprise users, not recently active learners.

### What changed

The label was corrected to match the underlying logic:

- `Active learners` -> `Active enterprise users`

Supporting meta copy was also updated to make the logic explicit.

Touched file:

- `peritio-web/app/app/customers/page.tsx`

Important adjacent audit note:

- the final narrow audit found another `Active learners` label in `DashboardReportingWorkspace.tsx`
- that one is not the same bug
- there it maps to `activeLearnerCountLast30Days`, which really is recent learner activity

### Current status

This is closed.

## F-10 — Internal / Storage-Oriented Detail-Page Language

### Original problem

Some dashboard detail pages were still explaining behavior in internal/storage/model terms, including language like:

- `persisted`
- `forward-only attribution`
- `pack-attributed`
- backend/storage-model framing that sounded like implementation docs instead of product UI

### What changed

The user-facing detail pages were rewritten in plainer, still-truthful language:

- training-pack detail
- assignment detail
- attempt detail

The important caveats were preserved, including:

- older activity without a training-pack link stays outside the scoped pack view
- transcripts are not part of normal dashboard review
- older attempts can lack newer score/coaching fields

During the final narrow audit, two adjacent sibling leaks were also corrected:

- `CustomerDetailTabs.tsx` no longer says `Training pack attribution is forward-only`
- `CustomerDetailTabs.tsx` no longer refers to `active backend storage provider`

Touched areas:

- `peritio-web/app/app/training/[trainingPackId]/page.tsx`
- `peritio-web/app/app/training/[trainingPackId]/assignments/[assignmentId]/page.tsx`
- `peritio-web/app/app/attempts/[attemptId]/page.tsx`
- `peritio-web/src/components/CustomerDetailTabs.tsx`

### Current status

This is closed.

## Final Narrow Audit Judgment

The final narrow audit in this chat re-checked only the original `F-01` through `F-10` items and immediate sibling risks.

Final judgment from that pass:

- `F-01` — closed pending runtime validation
- `F-02` — closed pending runtime validation
- `F-03` — closed
- `F-04` — closed
- `F-05` — closed
- `F-06` — closed
- `F-07` — closed
- `F-08` — closed
- `F-09` — closed
- `F-10` — closed

That is the clearest current state summary for the ten audited findings.

## Final Mobile Simulation-Orb Fix

After the audit/remediation work, one additional narrow mobile issue was fixed.

### Problem

On the simulation screen:

- the animated halo/pulse behind the main AI core visual could extend outside the containing AI card on some screen sizes

### Root cause

The orb used fixed halo diameters and animated pulse scales, but the visual lane did not size itself from actual available width.

That meant:

- the animated halo could exceed the visible space
- the orb’s visual lane height did not reflect the animated halo’s real displayed size

### Fix

The orb was made responsive using measured space and proportional layout math.

New helper:

- `mobile/src/lib/voiceOrbLayout.ts`

New targeted test:

- `mobile/src/lib/voiceOrbLayout.test.ts`

Main component integration:

- `mobile/src/components/VoiceOrb.tsx`

Behavior now:

- the orb measures available width
- halo diameter is derived from available width rather than fixed-only sizing
- halo and core scale proportionally
- the orb’s visual lane height expands to contain the animated halo
- clipping is kept as a safety backstop, not the primary fix

### Status

This is fixed in code and helper-test validation.

Remaining practical note:

- final visual confidence still benefits from on-device confirmation on both smaller phones and larger screens

## Main Files Changed In This Chat

The final pushed commit touched these major areas.

### Admin

- `admin-web/app/users/enterprise/[orgId]/page.tsx`
- `admin-web/app/users/page.tsx`
- `admin-web/src/components/EnterpriseTrainingPacksCard.tsx`

### API / shared logic

- `api/src/index.ts`
- `api/src/services/integrityMaintenance.ts`
- `api/src/services/integrityMaintenance.test.ts`
- `api/src/services/trainingPackAssignments.ts`
- `api/src/services/trainingPackAssignments.test.ts`
- `shared/src/contracts.ts`

### Mobile

- `mobile/App.tsx`
- `mobile/src/screens/ScorecardView.tsx`
- `mobile/src/components/VoiceOrb.tsx`
- `mobile/src/lib/scopedConfigGuard.ts`
- `mobile/src/lib/scopedConfigGuard.test.ts`
- `mobile/src/lib/voiceOrbLayout.ts`
- `mobile/src/lib/voiceOrbLayout.test.ts`

### Dashboard / peritio-web

- `peritio-web/app/login/page.tsx`
- `peritio-web/app/app/access-denied/page.tsx`
- `peritio-web/app/app/customers/page.tsx`
- `peritio-web/app/app/customers/[customerId]/page.tsx`
- `peritio-web/app/app/users/[userId]/page.tsx`
- `peritio-web/app/app/training/[trainingPackId]/page.tsx`
- `peritio-web/app/app/training/[trainingPackId]/assignments/[assignmentId]/page.tsx`
- `peritio-web/app/app/attempts/[attemptId]/page.tsx`
- `peritio-web/src/components/CustomerDetailTabs.tsx`
- `peritio-web/src/components/dashboardDivisionFilterState.ts`
- `peritio-web/src/components/dashboardDivisionFilterState.test.ts`
- `peritio-web/src/lib/auth.ts`

## Validation Run During This Chat

Across the remediation, hardening, audit, and mobile-orb fix passes, the following validation was run:

- `npm run build --workspace admin-web`
- `npm run build --workspace peritio-web`
- `npm run build --workspace api`
- `npx tsc --noEmit -p mobile/tsconfig.json`
- `npx tsx --test api/src/services/trainingPackAssignments.test.ts api/src/services/integrityMaintenance.test.ts`
- `npx tsx --test peritio-web/src/components/dashboardDivisionFilterState.test.ts`
- `npx tsx mobile/src/lib/scopedConfigGuard.test.ts`
- `npx tsx mobile/src/lib/voiceOrbLayout.test.ts`
- repeated targeted `rg` phrase searches for leftover bad labels/copy
- repeated code-trace verification across the specific audited paths
- `git diff --check`

That does not replace runtime/product review, but it does mean the work was not left at hand-wavy “looks right” status.

## Current Risk Posture

Compared with the `2026-04-22` state:

- the major structural trust issues are no longer open implementation gaps
- the lower-risk semantics and workflow issues are no longer meaningfully ambiguous
- the simulation-orb overflow bug is no longer expected to break containment in normal responsive layout conditions

The remaining watch list is narrow.

## Remaining Watch List

There are still a few items that are best described as runtime confirmation, not unresolved implementation.

### 1. F-01 mobile fail-closed behavior

This should still be sanity-checked on-device for:

- stored-session boot under scoped-config failure
- onboarding completion under scoped-config failure
- verification completion under scoped-config failure

### 2. F-02 division-filter drilldown behavior

This should still be sanity-checked in a running dashboard using real division-filtered data for:

- customer -> training pack
- training pack -> assignment
- user -> attempt
- out-of-scope deep links

### 3. Mobile orb visual balance

The orb containment logic is fixed in code, but:

- one small phone
- one average phone
- one larger device

should still be visually checked to confirm the proportions feel as strong as intended.

## Recommended Next Step

The codebase is now in a reasonable place to move on from the hostile audit items and resume normal product work.

The best next step is not another broad remediation cycle.

It is:

- a short manual validation pass for the few runtime-sensitive watch-list items above
- then a clean transition into the next prioritized product workstream

## APK Build Command

For a fresh Android APK from the current pushed baseline:

```powershell
Set-Location mobile
npx eas build --platform android --profile preview
```

The `preview` profile is already configured to build an `apk`.
