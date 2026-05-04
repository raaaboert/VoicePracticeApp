# Peritio State Summary (2026-04-22)

This document records the major work completed across this chat session after the prior `2026-04-14` state summaries.

It is intentionally detailed and handoff-oriented.

The work in this period was not one single feature pass. It was a long sequence of focused product hardening passes across:

- the customer dashboard (`peritio-web`)
- the mobile app
- final cross-platform trust auditing across dashboard, mobile, and admin utility

The main themes of this period were:

- making the dashboard read like a real executive reporting product instead of an internal reporting surface
- tightening dashboard data semantics and scope handling
- wiring the user-supplied brand assets directly into the mobile app
- shifting both mobile and dashboard away from the earlier blue bias into the Peritio green system
- improving the simulation transcript experience without adding artificial delay
- refining the simulation screen until it felt like one coherent product surface
- then ending with a hostile cross-platform audit of mobile, dashboard, and admin utility together

This summary is meant to capture both:

- what was completed and pushed
- what still appears to be structurally risky after the final audit

## Current Baseline

As of the end of this summary:

- branch: `main`
- current `HEAD`: `8f9264b`
- latest pushed commit on `main`: `Polish dashboard wording and evidence clarity`
- current worktree status: clean

Recent pushed commits, newest first:

- `8f9264b` - `Polish dashboard wording and evidence clarity`
- `53338e7` - `Clean up dashboard language and reporting hierarchy`
- `67aa6ff` - `Tighten simulation engine polish and dock separation`
- `806c831` - `Refine simulation action dock and engine emphasis`
- `235757f` - `Polish mobile status clarity and contrast`
- `d2ffa5b` - `Refine mobile simulation and landing polish`
- `0b59a34` - `Polish mobile landing and simulation surfaces`
- `14e84c7` - `Align brand assets and add adaptive icon foreground`
- `334ae82` - `Polish dashboard trust and mobile app startup flow`
- `73c971a` - `Polish dashboard briefing hierarchy and disclosure`

Most important high-level truth right now:

- the dashboard is materially stronger and far more presentation-ready than it was at the start of this chat
- the mobile app is much more coherent, branded, and product-like than it was at the start of this chat
- but the final cross-platform audit still found real scope, lifecycle, and semantics issues that should be treated as actual follow-up work, not cosmetic backlog

## Executive Summary

This period broke down into five major workstreams.

### 1. Dashboard productization and briefing cleanup

The dashboard moved from a cleaned-up reporting surface toward something much closer to an executive briefing product.

The most meaningful improvements were:

- aggregate tab order changed to `Company -> Training -> Users`
- story cards were rewritten to lead with conclusions instead of stitched-together reporting prose
- `What matters most` became meaningfully ranked instead of three equal-weight mini-cards
- proof/evidence became collapsed by default and much less intrusive
- company, training, users, and user-detail surfaces all received multiple rounds of wording and hierarchy cleanup
- the worst internal/product-narrated phrases were removed from the main reporting surfaces

### 2. Dashboard trust fixes and data-language cleanup

The dashboard did not only get copy polish.

Several real semantics/trust issues were found and fixed during the reporting passes:

- active-account counts were previously being represented as if they meant recent engagement; that was corrected in story/support layers
- company proof tables were tightened so they no longer presented zero-activity trainings under activity framing
- division-filtered aggregate dashboard views now preserve division scope into user detail drilldown
- aggregate users `Trainings engaged` labeling was tightened to `Trainings with activity`, then later to `Trainings practiced`
- user-detail attempt history labeling was corrected so it no longer implied a 30-day recency window when the underlying data was actually newest-first in-scope history

The current dashboard is materially cleaner and more trustworthy than it was at the start of the chat.

### 3. Mobile app brand fidelity, startup, and transcript flow

The mobile app received several tightly scoped but meaningful functional and product-surface improvements:

- the app now uses the exact user-supplied brand assets from:
  - `mobile/peritio-source-icon.png`
  - `mobile/peritio-source-splash.png`
- the startup/splash/loading experience was rebuilt around those assets instead of an interpreted approximation
- the brand/theme system was shifted from blue-accented to green-accented across mobile and dashboard
- the Android adaptive icon was corrected to use a proper transparent foreground derivative instead of the full square icon
- the simulation submit path was changed so the user transcript can appear earlier without intentionally delaying the assistant reply

That transcript change is important enough to call out separately:

- the previous UI-only tweak was not good enough
- the real blocker was the unified-submit response contract
- the flow was changed so transcription becomes visible at the first truthful point while assistant generation continues
- this was a real protocol/path improvement, not a fake timing trick

### 4. Mobile simulation-screen polish

The mobile simulation screen went through several narrow polish passes after the brand/startup work.

The result is meaningfully better than where it started:

- the landing page top section is more refined without losing the accepted direction
- the simulation top section feels more deliberate and less like a functional prototype
- the central AI/status module no longer uses fake progress bars
- the phase model is more honest and clearer
- the bottom CTA is now sticky and remains visible while the main content scrolls
- the engine module, active phase, halo, dock separation, and contrast all received several rounds of refinement

The simulation screen is no longer the obvious outlier it was earlier in the session.

### 5. Final cross-platform hostile audit

The last task in this chat was not another polish pass.

It was a deliberately hostile, cross-surface audit of:

- mobile
- dashboard
- admin utility
- shared contracts and backend lineage

That audit concluded:

- the core model is mostly coherent
- the common path is much stronger than before
- but the system is still not fully “safe” because there are real remaining issues around:
  - scope fallback
  - drilldown scope widening
  - assignment lifecycle integrity
  - async delete/reporting drift
  - admin terminology drift
  - a few remaining user-visible trust-copy issues

## Chronological Work Summary

## 1. Dashboard Briefing Passes

The first major work in this chat was a strict dashboard-only presentation pass.

The goals were to make the dashboard:

- calmer
- more executive
- less mechanically narrated
- simpler by default
- expandable only when needed

That pass changed the main aggregate workspace and key shared reporting components:

- `DashboardReportingWorkspace.tsx`
- `dashboardNarratives.ts`
- `DashboardWhatMattersSection.tsx`
- `DashboardProofSection.tsx`
- `CoachingInsightsSection.tsx`
- dashboard CSS

The first big outcomes were:

- story paragraphs became conclusion-led instead of fact-stitching
- `What matters most` became ranked more clearly
- proof became collapsed by default
- company view became more leadership-oriented

That work was pushed as:

- `73c971a` - `Polish dashboard briefing hierarchy and disclosure`

## 2. Dashboard Trust and Scope Corrections

After the initial dashboard presentation pass, the next workstream was a deeper trust audit and correction pass.

That work found and fixed several meaningful issues:

- active user/account status was being confused with recent practice activity in reporting language
- aggregate company and user narratives were updated to use visible recent-practice users instead
- division-filtered dashboard drilldown into user detail was corrected so it no longer widened silently
- user detail and aggregate dashboard proof handling were tightened

That work was later bundled into:

- `334ae82` - `Polish dashboard trust and mobile app startup flow`

Important dashboard trust changes from that period:

- aggregate dashboard narratives now better respect actual recent practice
- division scope now survives aggregate dashboard -> user detail drilldown
- user detail pages now show division state and fetch user detail with division scope
- a users-table label was tightened because the metric was more specific than the earlier wording implied

## 3. Mobile App Surface Pass: Startup, Hero, Assets, and Transcript Reassessment

The next major shift was from dashboard into mobile-app-only work.

The user wanted:

- the provided icon image used for the app icon
- the provided splash art used for startup/loading
- the landing hero/top area to borrow that same language
- the transcript tweak rolled back if it was not actually improving the experience

That phase initially exposed a practical limitation:

- the image uploads in chat were visible, but not directly exposed into the repo as raw files

The user then placed the exact files into:

- `mobile/peritio-source-icon.png`
- `mobile/peritio-source-splash.png`

Once those files existed, the app was rewired to use them directly instead of regenerated approximations.

## 4. Transcript-First Simulation Flow Fix

One of the most important non-visual changes in this chat was the transcript-timing fix.

The problem at the time:

- the prior transcript tweak only created about a paint-frame of separation between the user transcript and assistant reply
- it felt more abrupt, not better

The real root cause:

- the frontend was waiting on a response contract that did not expose transcript availability early enough

The fix:

- a transcript-first mode was added to the submit flow
- transcription becomes visible as soon as it is truly ready
- assistant generation continues in parallel
- the assistant reply is then awaited without an artificial delay

Key points:

- no fake timer was introduced
- no deliberate latency tax was introduced
- the transcript appears earlier because it is actually available earlier
- the assistant still appears as soon as it is ready

This was a real correctness/UX improvement, not a cosmetic trick.

## 5. Brand Fidelity and Theme Shift

After the transcript-flow work, attention returned to brand fidelity.

The initial attempt had drifted from the supplied art too much.

The corrected pass:

- used the exact supplied files directly
- rewired icon/splash/loading/landing references to those exact assets
- removed live dependency on the earlier interpreted/generated asset path
- shifted both mobile and dashboard from the previous blue-accent feel into the Peritio green family

That work affected:

- mobile app config and runtime startup/hero usage
- mobile theme token values and a few standalone screen palettes
- dashboard global theme variables in `peritio-web/app/globals.css`

Important constraint preserved:

- admin utility was explicitly left untouched by that theme pass

## 6. Adaptive Icon Correction

After a follow-up cleanliness audit, one narrow but important icon fix was made:

- Android adaptive icon no longer uses the full opaque square source image directly as its foreground
- it now uses a transparent adaptive foreground derivative made from the same supplied icon art
- the full square source still remains the source for the main app icon and favicon

That fix was pushed as:

- `14e84c7` - `Align brand assets and add adaptive icon foreground`

## 7. Mobile Landing + Simulation Polish Sequence

The next set of passes were all narrow mobile UI polish passes focused on the landing page and simulation screen.

They proceeded in stages:

### Landing refinement

- hero scale and spacing were refined
- the Active Role card was strengthened
- the top area became more deliberate without changing the overall approved direction

### Simulation redesign/polish

- the simulation header became more product-designed
- the engine/status visual replaced the earlier generic orb language
- the center of the screen became a stronger “heart of the simulation” component
- contrast and helper text/readability improved
- the light theme became less washed out

### Honesty and semantics refinement

- fake progress bars were removed from the engine module
- the current phase is shown honestly through semantic states rather than implied measurable progress

### Sticky CTA and final micro-polish

- the bottom CTA became persistently visible
- the main content became scrollable above the dock
- the active phase became easier to identify
- the halo became more noticeable
- the dock received clearer separation from the content above it

Those mobile UI pushes landed as:

- `0b59a34` - `Polish mobile landing and simulation surfaces`
- `d2ffa5b` - `Refine mobile simulation and landing polish`
- `235757f` - `Polish mobile status clarity and contrast`
- `806c831` - `Refine simulation action dock and engine emphasis`
- `67aa6ff` - `Tighten simulation engine polish and dock separation`

## 8. Final Dashboard Editorial / Evidence Cleanup

After the mobile polish sequence, work returned to the dashboard for a final editorial and trust-focused cleanup.

That work focused on:

- cleaner aggregate tab wording
- more trustworthy helper text
- better proof/evidence labeling
- tighter user-detail evidence sections
- reduced density in scored-attempt history and coaching/evidence areas
- better summary/proof alignment

Two pushes captured that cleanup:

- `53338e7` - `Clean up dashboard language and reporting hierarchy`
- `8f9264b` - `Polish dashboard wording and evidence clarity`

Notable late dashboard fixes from that phase:

- tab order preserved as `Company -> Training -> Users`
- empty band under the segmented tabs removed
- `What matters most right now` simplified to a tighter, cleaner section
- right-side `01 / 02 / 03` markers removed
- multiple internal/robotic phrases were replaced
- training tab wording like `Watch the quiet edge` was removed
- user detail intro/evidence/coaching language became much less system-internal
- user attempt-history labeling was corrected to match real data semantics

## 9. Final Cross-Platform Audit

The very last task in this chat was a broad, hostile cross-platform audit.

This was not another visual cleanup pass.

It explicitly traced:

- entity relationships
- data lineage
- scoping
- role/permission behavior
- empty/partial/disabled states
- summary/proof alignment
- admin-to-runtime propagation
- stale-state and lifecycle risks

Workspaces and validations covered:

- `mobile`
- `peritio-web`
- `admin-web`
- `api`
- `shared`

Validation run during that audit:

- `cmd /c npx tsc --noEmit -p mobile/tsconfig.json`
- `cmd /c npm run build --workspace peritio-web`
- `cmd /c npm run build --workspace admin-web`
- `cmd /c npm run build --workspace api`
- `cmd /c npx tsx --test src/lib/dashboardNarratives.test.ts` from `peritio-web`
- `cmd /c npx tsx --test src/services/orgDivisions.test.ts src/services/simulationDivisionAnchoring.test.ts src/services/scoreRecordAccess.test.ts src/services/simulationHistory.test.ts` from `api`

All of those validations passed.

## Current Risk Picture After The Final Audit

The final audit did not conclude that the system is “fully safe.”

The strongest remaining issues found were:

### 1. Mobile scoped-config fail-open behavior

After authentication or restore, if `fetchMobileConfig(...)` fails, the mobile app can fall back to the global `/config` payload.

That means an enterprise user can temporarily see non-org-scoped catalog content in the UI even though later runtime calls may reject some of it.

This is one of the most important remaining trust issues because it is a real scope problem, not just wording drift.

### 2. Dashboard division-scope widening on deeper drilldowns

Aggregate dashboard and user-detail views respect division scope.

But deeper drilldowns still do not carry that scope consistently:

- training-pack detail
- training-pack assignment detail
- attempt detail

That means filtered dashboard views can still widen back to broader org evidence.

### 3. Admin can assign training packs to disabled users

This is a real lifecycle integrity issue.

The admin UI lists disabled users in the assignment modal, and the backend assignment route accepts them because it validates org membership but not active status.

### 4. User deletion leaves orphaned assignment problems

Deleting a user removes the user row and later deletes sessions/scores asynchronously, but it does not clearly deactivate or remove training-pack assignments for that user.

That can leave orphan assignment rows that fall back to raw user IDs downstream.

### 5. Async delete cleanup can temporarily distort reporting

Because sessions and scores are cleaned up asynchronously after user deletion, aggregate org/training rollups can temporarily still include activity from a deleted user while user-level tables no longer show that user at all.

### 6. Admin terminology drift

The enterprise org page in admin uses `segments` wording where the data is actually `activeIndustries`.

This is not catastrophic, but it is a real trust/semantics issue.

### 7. Remaining user-visible trust copy issue in mobile

The score screen still contains a literal placeholder:

- `[Company Name] does not retain transcripts of your session...`

That is a direct trust-copy bug and should be fixed quickly.

## Areas That Now Look Stronger

Despite the remaining issues, several areas are meaningfully healthier than they were before this chat:

- dashboard aggregate narratives are far cleaner and less robotic
- dashboard proof/evidence structure is calmer and easier to trust
- recent-practice vs active-account semantics in the dashboard are materially better
- user-detail dashboard language is much less product-internal
- mobile startup/landing/branding is much more coherent
- the green theme direction is now consistent across mobile and dashboard
- transcript-first behavior is real and materially better than the earlier near-simultaneous transcript reveal
- the simulation screen now feels like a real product surface rather than a prototype stack
- adaptive icon handling is more correct on Android

## Recommended Next Steps

The next work should not be another broad “polish everything” pass.

The highest-value next steps are now clear:

1. Fix mobile scoped-config fallback so it fails closed after auth.
2. Thread division scope through all remaining dashboard drilldowns.
3. Block disabled users from training-pack assignment.
4. Clean up assignment lifecycle on user deletion.
5. Eliminate temporary rollup/user-table drift after user deletion.
6. Fix the direct trust-copy issues:
   - `[Company Name]` placeholder
   - admin `segments` vs `industries`
   - any remaining low-risk label mismatches like dashboard `Active learners`

Those should be treated as real correctness/trust tasks, not optional cleanup.

## Final State Judgment

The repo is in a meaningfully stronger state than it was at the beginning of this chat.

The dashboard is much closer to final.

The mobile app is much more coherent and product-like.

The biggest remaining work is no longer broad redesign or surface cleanup.

It is targeted trust hardening:

- scope enforcement
- lifecycle cleanup
- semantics cleanup
- a few remaining user-visible trust bugs

That is good news overall.

But the final audit result is still:

- not yet fully safe
- structurally much healthier
- with a small number of important follow-up fixes now clearly identified
