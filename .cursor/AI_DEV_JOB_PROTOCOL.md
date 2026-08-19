# AI Development Job Protocol (Cursor Agent)

Smile AI Studio creates GitHub Issues with label `ai-dev-job` and body section:

```text
## Agent Status
READY_FOR_AGENT
```

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

1. When you start work on an Issue with `READY_FOR_AGENT`, set status to `AGENT_WORKING`.
2. Create a feature branch (never push to `main`).
3. Implement with minimal diff. Do not change Passkey/auth. Do not Production Deploy. Do not real FTP publish.
4. Run relevant tests (`npm run test:auth`, `npm run test:line`, and feature tests).
5. While verifying → `TESTING`. If fixing failures → `FIXING`.
6. Open a Pull Request against `main` (do not merge). Set `READY_FOR_REVIEW` and write the PR number under `## Pull Request`.
7. Stop. Human reviews in Smile AI Studio (“確認してください”).

## Safety hard rules

- No `main` merge
- No Production Deploy
- No production FTP publish
- No secrets in code / commits
- Do not delete developmentJobs client data

## How Studio syncs

Studio polls `POST /.netlify/functions/api-github-issues` with `action: "sync-batch"` and applies Issue Agent Status + linked PR into local `developmentJobs`.

## Cursor Automation (one-time human setup)

Create an Automation that triggers when Issues are opened/labeled `ai-dev-job` (or on a short schedule that searches open Issues with `READY_FOR_AGENT`), then runs an Agent with this prompt:

> Read the triggering GitHub Issue. If `## Agent Status` is `READY_FOR_AGENT`, set it to `AGENT_WORKING`, follow `.cursor/AI_DEV_JOB_PROTOCOL.md`, implement on a feature branch, open a PR, set status to `READY_FOR_REVIEW`. Never merge main / never Production Deploy / never FTP production publish.
