# Trial authentication diagnostics — validation and privacy review

Base: `e0d993b81ee7e747a83713933c8f486271a0fd09` (PR 37).
Branch: `fix/auth-status-diagnostics`. Validation below was performed locally with
no live auth-record reads. This document does not attest to rollout success.

## Findings and uncertainty

The login UI awaited `/api/auth/session` but ignored its status and authenticated
state, then displayed success and navigated home. Offline browser simulation with
the unchanged base script reproduces navigation after `{ok:true,authenticated:false}`.
This can happen if successful verification does not result in a usable browser
cookie. It does not establish that cookie delivery failed in production.

The trial UI checks only when its script loads. An already open tab, including
a retained/back-forward-cache document, can keep an earlier 401 after another tab
logs in. A newly loaded page/reload sends a new GET using its current CSRF cookie;
simply returning to a retained tab does not. The screenshot did not establish the
failed request time. The reported 26-minute interval does not prove or exclude
expiry; the owner idle limit is 30 minutes and the actual login/GET times are unknown.

Direct navigation to the API URL does not send the custom CSRF header and fails
even when cookies exist. The correct page is `/diary-ai-trial.html`, whose script
sends that header. "Both inside the app" reduces the browser-mismatch hypothesis
but does not prove shared cookie storage or successful Set-Cookie delivery.

## Minimal candidate

1. Login and post-registration navigation now require HTTP 200, `ok:true`,
   `authenticated:true` and `purpose:full`. A missing session after login gets a
   fixed message requesting no repeated login. No extra API request is added.
2. Trial UI shows GET start time in UTC, only the presence of the readable CSRF
   cookie, and a random 16-character diagnostic reference. It explicitly says the
   result is a snapshot and does not update after a separate-tab login. It cannot
   inspect the HttpOnly session cookie and makes no claim about that cookie.
3. Trial GET denial keeps the existing status/error. Missing inputs, absent/invalid/
   revoked/expired sessions and non-owner/full sessions remain indistinguishable
   in 401 responses, apart from an independent random reference of identical shape.
   Detailed fixed categories go only to the private function log, correlated by
   that reference. No public diagnostic endpoint or record lookup is added.

Private log fields are exactly `event`, `diagnosticRef`, and `reason`. No cookie,
CSRF value, session hash, user ID, email, expiry timestamp, IP, headers or exception
text is logged. Categories distinguish session-cookie absence, CSRF-cookie absence,
CSRF-header absence, no durable session, invalid/revoked/expired session, non-owner/
enrollment session, CSRF mismatch and inactive/non-owner user. Existing 403 error
semantics remain unchanged. GET alone logs; POST behavior and AI execution are
unchanged. No session renewal, audit-store write or auth-record read is added.

This does not remove pre-existing timing differences or existing 401/403 distinctions.
Function-log access must remain operator-only. Repeated failed GETs can increase log
volume; the logging should be removed or bounded after the incident is resolved.

## Verification and scope

New offline suite: 22 checks, plus optional baseline reproduction (23 when supplied).
Existing regressions: stage diagnostics 14, initialization 8, trial 57, native trial
18, durable auth 24. Total run: 144 including baseline reproduction. No live requests,
AI calls, biometric operations or production storage writes. `git diff --check` passes.

Browser tests use a VM/document/fetch simulation, not the actual app browser. They
cover direct API navigation, page GET, retained tab, fresh/reloaded page, malformed
reference suppression, and successful/anonymous/enrollment/error login replies.
Actual cookie policy, real passkey sign-in and the incident's cause remain unverified.

## Minimal future production diagnostic

After separate approval to deploy this candidate, use the existing session without
logging in again. Reload `/diary-ai-trial.html` once; do not press the AI run button.
Report only displayed status, UTC check time, CSRF-cookie presence and reference.
An authorized operator can match that reference to the single fixed-category log
line. Do not export session records, HAR files, complete logs, Cookie headers or
raw `/api/auth/session` responses. No production log or auth record was fetched here.

If the page becomes healthy on that one reload, an earlier stale result remains a
plausible explanation, not proof. If the reference cannot be matched, do not infer
"session absent": logging may be delayed or unavailable.
