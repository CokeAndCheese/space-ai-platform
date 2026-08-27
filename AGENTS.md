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
- For each approved work package, first match and dispatch it to an existing long-lived project role task named `职责-分工内容`; these established role conversations take precedence over temporary sub-agents created inside the product-manager task.
- Use an internal temporary sub-agent only when no suitable long-lived role exists, a one-time fresh independent review is required, the relevant role task is unavailable or constrained, or isolation provides explicit value. Map every temporary sub-agent to an existing role responsibility, and sync necessary conclusions, evidence, risks, dependencies, and blockers back to the corresponding long-lived role task. If no corresponding role task exists, the product manager receives the output and decides whether to propose a formal staffing change. A temporary sub-agent does not create hidden headcount, durable ownership, or a new reporting line.
- Before dispatching any implementation or review work package, the product manager must record the matched long-lived project role owner. Before using an internal temporary sub-agent, the same dispatch record must also state why that long-lived role is unsuitable or unavailable, which existing role responsibility the temporary agent maps to, and which long-lived role conversation will receive the result.
- This dispatch gate is fail-closed: if the required role match or temporary-agent fields are missing, stop and complete the record before dispatch; never dispatch the temporary sub-agent first. The record is internal scheduling evidence only and does not expand the user's reporting surface or change staffing, responsibilities, or reporting lines.
- The product manager retains work decomposition, scheduling, write-queue control, conflict resolution, integration acceptance, and user reporting regardless of who executes a work package.
- Assign one owner per mutable file or system boundary. Preserve unrelated work and do not overwrite another task's changes.
- All development uses the saved project checkout `/Users/mac/Documents/Codex/space AI platform`. Do not create or use additional worktrees.
- Codex may create, name, switch, and retire local task branches. Use the `codex/` prefix by default. Role-task priority and multiple conversations do not authorize parallel writes: only one task branch and one implementation task may write at a time, and the product manager owns the branch/write queue and ownership handoff.
- A task branch may be merged into local `main` only after relevant verification and product acceptance. The project is local-only until the user makes a new decision: do not fetch, pull, push, create PRs, inspect or change remote branches, or otherwise coordinate through GitHub.
- Lightweight Git is authorized for exact-path local checkpoint and accepted-milestone commits after relevant verification. Git remains local; do not access GitHub, merge remote history, deploy, publish, rotate credentials, or change external state without a new explicit user decision.

## Repository safeguards

- Treat Space Model Studio as the independent upstream producer of standard model packages and Space AI Platform as the downstream application consumer. The projects share versioned data contracts, not implementation code.
- Treat `docs/GLB_METADATA_SPEC.md`, adopted topology sidecar schemas, and their compatibility fixtures as cross-project public interfaces. Never change a published version's observable field, enum, ID, coordinate, discovery, or asset-binding semantics unilaterally. Breaking changes require a new version, producer/consumer impact review, synchronized fixtures and validators, migration/rollback planning, and explicit user approval.
- The currently implemented baselines are not yet interoperable: Studio uses Metadata `3.3-semantic` plus embedded `scene.extras.sspTopology` v1, while Platform uses Metadata v3.1 plus external topology sidecar v1. Preserve both baselines and treat convergence as unresolved; never relabel, guess, copy, or silently adapt one as the other. Follow `docs/CROSS_PROJECT_DATA_CONTRACT.md`.
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
