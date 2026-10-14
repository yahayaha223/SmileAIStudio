# Authentication storage repair — validation and rollback

Base: `d2b130cf9f5c247d9d3bfa9dd8545f6106333059`.
Branch: `fix/auth-durable-sessions`. Validation below was performed locally without
production mutation. This document does not attest to production rollout success.

## Verified defect and scope

Offline fault injection against the previous implementation reproduced successful
login (200 and two cookies), an authenticated normal session, and trial GET 401
after durable session writes failed. This demonstrates a code defect, not that the
same failure happened in production. Live cookie delivery and durable write status
remain unverified.

The installed Blobs SDK's `connectLambda` drops `uncachedEdgeURL`. A strong read
then throws before any network request; the legacy auth helper catches it and
retries an eventual read. Upgrading the SDK alone does not fix this: both installed
SDK versions have the same Lambda conversion behavior.

## Selected changes

- Convert only `api-auth` to Native Functions. Preserve the function name, existing
  redirects, route parsing, response JSON and separate Set-Cookie headers. The
  former router is moved to `shared/auth-api-handler.js`.
- Use the existing SDK and its platform-supplied native context. No new secret,
  invented storage URL, dependency upgrade or environment setting is required.
- Bind the native store to the request using AsyncLocalStorage. All auth operations
  within that request (sessions, challenges, credentials, rate limits and audit)
  use durable storage; reads are strong. Errors do not fall back to eventual reads,
  memory or disk. Concurrent requests cannot replace one another's bound store.
- Check both session and user-session-index save results before returning a newly
  created session. Storage errors return generic 503 without issuing cookies.
- Explicitly trace the existing CJS SimpleWebAuthn dependency in the native entry.
  Official Netlify packaging initially omitted it; the final packed function
  successfully imports and generates real WebAuthn login options offline.

No change to cookie names, path, Secure/HttpOnly/SameSite attributes, RP ID,
origins, session/credential schemas, namespaces, roles, CSRF rules, passkey
verification or login UI. No registration or key migration is needed. Previously
persisted valid sessions remain readable. Enrollment sessions stay unauthenticated.

## Deliberate boundary

Other Lambda business functions still use the existing legacy auth helper outside
the request-bound native context. Their eventual/memory/file fallback behavior is
not repaired here. This candidate fixes the normal auth API, not every legacy
consumer. Broad migration would expand the blast radius and needs separate review.
The trial's strong, read-only authentication path is unchanged.

## Validation

Local runtime: Node 24.19.0. No live network/AI requests or production storage
writes. Legacy regression tests use synthetic records in local `.data` files.

- `node scripts/test-auth-durable.cjs`: 24 cases, including session/index/audit
  write failures, no cookies on failure, strong-read errors, durable deletion,
  idle and absolute expiry, CSRF, logout/revocation, origin, routing, OPTIONS,
  independent module instances, concurrent store isolation and existing credentials.
- Existing auth policy: 12; WebAuthn feasibility: 5; auth/WebAuthn integration: 33.
- Existing trial suite: 57; native trial suite: 18.
- Official `@netlify/zip-it-and-ship-it` 16.3.0: NFT, runtime API v2, Node 22
  packaging target. Execute the packed entry with
  `node scripts/test-auth-native-bundle.mjs <packed-api-auth.mjs>`: 3 cases for
  existing authenticated session, anonymous session and real login-options generation.
  All SDK fetches are intercepted and must use the synthetic strong endpoint.
- `git diff --check`.

These tests do not validate real browser biometric authentication, Netlify's live
cookie forwarding, production storage permissions, or execution on actual Node 22.
The new login-success integration tests mock successful WebAuthn verification;
they do not claim to validate a real signature or physical authenticator.

## Risks and future acceptance

Storage unavailability now blocks login/session renewal rather than appearing to
succeed. Audit failure also prevents login success. The unchanged UI will show its
existing generic failure message. Existing cookies are not cleared on this error.

Writes are not a transaction. A later index/audit failure may leave an unused
session record without a cookie. A credential counter/challenge may already have
changed before a later failure. No automatic retry or compensating deletion was
added. Existing last-write-wins index/concurrency limitations remain.

Before any future production rollout, review the complete diff and packed artifact,
confirm the configured Node runtime, and confirm a recoverable prior deploy. After
an independently authorized rollout, verify one login with an existing passkey,
then the read-only trial status. Check only statuses and fixed classifications;
do not export cookie values, raw session responses or HAR files. Do not run AI.

If diagnosis is needed first, inspect only presence of session Cookie, CSRF Cookie
and CSRF header on the already failed trial GET. A future fixed-code diagnostic
could distinguish missing inputs, absent durable record and invalid/expired record
without exposing identifiers. Neither diagnostic was deployed in this task.

## Restore plan

The original Desktop checkout is untouched; this candidate is a separate clone.
Local reversal can simply leave this branch and use the base commit in a separate
checkout. No user files need to be deleted or overwritten.

For a future deployed regression, restore the previously recorded working Netlify
deploy/code version (`d2b130c` is this candidate's base), retaining all environment
settings and durable data. This reintroduces the legacy fallback defect, so it is
an operational rollback, not a security fix. Do not restore an old auth database:
that could resurrect revoked sessions or undo passkey counters. No schema migration
is introduced, and no production auth backup or secret export was made here.
