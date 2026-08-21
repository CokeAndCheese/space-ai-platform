# Space AI Platform — Project Instructions

## Required context

Before substantial work, read:

1. `docs/PRODUCT_MANAGER_CHARTER.md` for governance and decision authority.
2. `docs/ORG_CHART.md` for the latest effective and proposed organization structure.
3. `docs/PRODUCT_CONTEXT.md` for the current product, architecture, risks, team, and milestones.
4. `docs/DECISION_LOG.md` for approved decisions that must survive chat compaction.
5. `docs/DEVELOPMENT_WORKFLOW.md` for the single-workspace, lightweight-Git, and milestone-backup process.
6. The contract and tests for the module in scope.

If these files conflict, follow the newest explicit user instruction first, then this file, then the Product Manager Charter, then Product Context, then historical documents or chats. Report material conflicts to `space AI platform产品经理-项目总控`.

## Governance

- `space AI platform产品经理-项目总控` is the sole product-management and cross-role coordination task for this repository.
- The user receives decision questions, material risks, staffing changes, milestone outcomes, and release recommendations—not routine engineering coordination.
- After the user approves a decision, the product manager owns decomposition, staffing, sequencing, coordination, evidence review, and acceptance.
- Other role tasks work only within their assigned responsibility and report dependencies, risks, evidence, and blockers to the product manager.
- Product scope, irreversible architecture choices, material security/risk acceptance, external publication, production deployment, destructive actions, and release approval require explicit user authority.

## Team operations

- Name personnel tasks as `职责-分工内容`, for example `前端工程师-Three.js体验`. Distinguish additional people by concrete work content, not numbers. The sole naming exception is this repository's main product-manager task: `space AI platform产品经理-项目总控`.
- The product manager may propose creating, splitting, merging, or retiring personnel tasks. Every staffing change must be reported to the user with the change, reason, impact, and expected cost; never change staffing silently.
- Assign one owner per mutable file or system boundary. Preserve unrelated work and do not overwrite another task's changes.
- All development uses the saved project checkout `/Users/mac/Documents/Codex/space AI platform`. Do not create or use additional worktrees.
- Codex may create, name, switch, and retire local task branches. Use the `codex/` prefix by default. Only one task branch and one implementation task may write at a time; the product manager owns the branch/write queue and ownership handoff.
- A task branch may be merged into local `main` only after relevant verification and product acceptance. The project is local-only until the user makes a new decision: do not fetch, pull, push, create PRs, inspect or change remote branches, or otherwise coordinate through GitHub.
- Lightweight Git is authorized for exact-path local checkpoint and accepted-milestone commits after relevant verification. Git remains local; do not access GitHub, merge remote history, deploy, publish, rotate credentials, or change external state without a new explicit user decision.

## Repository safeguards

- Treat the existing `src/model-manifest.json` modification as user-owned; do not overwrite, stage, or commit it unless explicitly instructed.
- Do not modify protected `src/ssp/**` without first reporting scope, impact, and verification to the product manager and receiving authorization for that implementation.
- Preserve the SSP–Template–AI narrow waist. AI may invoke only explicitly registered templates, never raw SSP calls.
- Topology core accepts explicit generic graph data and must not absorb project- or industry-specific inference.
- Use exact-path staging. Never stage broad paths or `git add .`. Before switching or retiring a task branch, verify its exact commits and worktree state. Never clean, reset, move, or delete unrelated worktrees, branches, files, backups, or user changes.

## Verification and records

- Verify work in proportion to risk and provide reproducible evidence before declaring completion.
- Update `docs/PRODUCT_CONTEXT.md` when current product facts, risks, team structure, or milestones materially change.
- Update `docs/ORG_CHART.md` immediately when discussion creates a credible organization proposal or an approved change to roles, responsibilities, reporting lines, or staffing. Keep proposed and effective structures separate.
- After an organization change becomes effective, report the complete latest organization to the user, not only the delta.
- Append to `docs/DECISION_LOG.md` when the user approves or reverses a durable product, architecture, staffing, risk, or release decision.
- Update `docs/PRODUCT_MANAGER_CHARTER.md` only when the product manager's authority, reporting contract, or operating model changes.
- At each accepted milestone, complete the checklist in `docs/DEVELOPMENT_WORKFLOW.md`, create the authorized local milestone commit, then ask the user to confirm completion of the external manual backup before starting the next milestone.
