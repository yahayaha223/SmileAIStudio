# AI Development Job Protocol (Cursor Agent)

Smile AI Studio creates GitHub Issues with label `ai-dev-job` and body section:

```text
## Agent Status
READY_FOR_AGENT
```

After the Issue is created, Studio posts one Issue comment whose body is exactly:

```text
READY_FOR_AGENT
```

That comment is the Cursor Automation trigger (GitHub **Issue comment**, not a label change).

This file is the handoff contract between Studio, GitHub, and Cursor Agent / Automation.

## Status values (Issue body only)

| Agent Status | Studio UI |
|---|---|
| READY_FOR_AGENT | AIが作業待ち |
| AGENT_WORKING | AIが作業中 |
| TESTING | 動作確認中 |
| FIXING | 修正中 |
| READY_FOR_REVIEW | 確認してください |
| FAILED | 失敗 |
| COMPLETED | 完了 |

Update **only** the line under `## Agent Status`. Keep the heading.

Also fill when known:

```text
## Branch
feature/...

## Pull Request
#123
```

## Required Agent behavior

1. Trigger is an Issue comment. If the comment body (trimmed) is not exactly `READY_FOR_AGENT`, stop.
2. Always read the Issue body. Work only when `## Agent Status` is `READY_FOR_AGENT`.
3. If Agent Status is already `AGENT_WORKING`, `TESTING`, `FIXING`, `READY_FOR_REVIEW`, `FAILED`, or `COMPLETED`, do nothing and stop (no double-run).
4. When starting, set Agent Status to `AGENT_WORKING` (heading stays, value line only).
5. Create a feature branch from `main` (never push to `main`).
6. Implement with minimal diff. Do not change Passkey/auth. Do not Production Deploy. Do not real FTP publish.
7. Run relevant tests (`npm run test:auth`, `npm run test:line`, and feature tests).
8. While verifying → `TESTING`. If fixing failures → `FIXING` (max 3 automatic repair cycles).
9. Open a Pull Request against `main` (do not merge). Set `READY_FOR_REVIEW` and write the PR number under `## Pull Request`.
10. Stop. Human reviews in Smile AI Studio (“確認してください”).

## Safety hard rules

- No `main` merge
- No Production Deploy
- No production FTP publish
- No secrets in code / commits
- Do not delete developmentJobs client data

## How Studio syncs

Studio polls `POST /.netlify/functions/api-github-issues` with `action: "sync-batch"` and applies Issue Agent Status + linked PR into local `developmentJobs`.

## Cursor Automation (one-time human setup)

Create an Automation with GitHub trigger **Issue comment** on `yahayaha223/SmileAIStudio` (not Issue/PR label). Studio posts `READY_FOR_AGENT` as the kickoff comment. Then run an Agent with this prompt:

> Read the triggering Issue comment. If it is not exactly READY_FOR_AGENT, stop. Read the GitHub Issue body. If ## Agent Status is not READY_FOR_AGENT, stop. If status is already AGENT_WORKING / TESTING / FIXING / READY_FOR_REVIEW / FAILED / COMPLETED, stop. Otherwise set it to AGENT_WORKING, follow this protocol, implement on a feature branch, open a PR, set status to READY_FOR_REVIEW. Never merge main / never Production Deploy / never FTP production publish.
