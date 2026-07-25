---
name: darkagent
description: Dark-factory pipeline for Prog7 (AudioApi) — grill the task into a PRD, slice it into tracer-bullet issues, execute them TDD-style with df-* specialist agents, run the quality batch, keep the sandbox gate green, and open a PR to main. Use when invoking /darkagent with a task description in this repo.
---

# Dark Agent — Prog7 pipeline

The bootstrap already ran. This skill executes work; it does not re-bootstrap.

## Before anything

1. **Open `.claude/skills/CONTEXT-MAP.MD` and follow it.** It is the authoritative planning
   document for this repo — domain areas, discovered stack, engineering policy, and the mandatory
   context write-back rule. This skill orchestrates; the CONTEXT-MAP governs. If they disagree,
   the CONTEXT-MAP wins.
2. Read the `.claude/contexts/<area>/CONTEXT.md` of every area the task plausibly touches.
3. Communicate in **caveman ultra** — status, reports, agent prompts. Full clarity only for
   security warnings, irreversible-action confirmations, and PR/commit/code/doc content.
4. Navigation: codegraph is **unavailable** here (`@colbymchenry/codegraph` installs empty). Use the
   CONTEXT-MAP + per-area file lists to locate files, then Read them. No blind repo-wide greps.

## 1. Grill

Methodology of `grill-with-docs` (invoke via the Skill tool) against the context docs.

- **Auto-answer** whenever the Conservador policy + a CONTEXT.md + the existing code settle it.
  State the answer and the source; do not ask.
- **Escalate to the human only on product ambiguity** — max **3** `AskUserQuestion` calls.
- Write decisions back into the relevant `CONTEXT.md` **inline, as they land**, not at the end.
- `docs/DESIGN.md` does not exist in this repo (no frontend). If it ever appears, design questions
  are answered there and are never re-grilled.

## 2. `/to-prd`

Turn the grilled understanding into a PRD.

## 3. `/to-issues`

Break the PRD into **tracer-bullet vertical slices** (each slice: schema → service → endpoint →
test, shippable on its own).

**Fully automatic**: when the skill asks the human to confirm the slices, answer it yourself — the
grill already validated scope. Do **not** stop for slice approval. Create the issues on GitHub and
record their numbers for the PR body.

## 4. Branch

```bash
git switch -c <type>/<slug> main
```

PR target is **`main`** (repo default branch; every merged PR so far targeted it). Because `main` is
the default branch, GitHub auto-closes `Closes #n` on merge — the
`darkagent-close-issues.yml` workflow is intentionally not installed.

## 5. `/tdd` execution — batch dispatch

Read each issue's spec **first** and decide which specialists it needs. Available agents:
`df-architecture`, `df-backend`, `df-database`, `df-testing`, `df-quality`.
There is no `df-frontend`/`df-design` — this repo has no frontend.

Per issue:

- **red** — `df-testing` writes the failing test from the spec. Confirm it fails for the right
  reason before moving on.
- **green** — dispatch batch-1 specialists as subagents. `df-architecture` runs **first and alone**
  whenever structure or a new interface is involved. `df-database` before `df-backend` when the
  entity changes. Parallel only on disjoint file sets.
- **refactor** — deferred to batch 2. Do not refactor in the green phase.

Each subagent prompt must contain: the issue spec, "read your own
`.claude/skills/df-<x>/SKILL.md`", the exact files it owns, "navigate via CONTEXT-MAP, no blind
greps", and "report back appended to the issue".

## 6. Quality batch — always

After every issue is green, run `df-quality` over the changed area (4 passes: clean code →
semantic dedup → tech debt → performance). Then run the gate again.

## 7. Gate loop

Scoped targets for the change:

```bash
dotnet test --nologo

docker compose -f docker-compose.dark-factory.yml up unit-tests \
  --build --abort-on-container-exit --exit-code-from unit-tests

docker compose -f docker-compose.dark-factory.yml --profile integration up integration \
  --build --abort-on-container-exit --exit-code-from integration
```

Red → hand the **exact** failure output to the agent responsible for those files. Max **3** cycles.
Still red after 3 → **stop**, report what was attempted, do not push.

Known gate mechanics (do not rediscover):
- The sandbox runs as non-root `sandbox` (uid 1001), so runtime paths live under `/tmp/sandbox/*`
  (tmpfs is root-owned at `/app`).
- `ffmpeg` is installed in the sandbox image — tests really transcode.
- No network in the gate. `Summarization:Enabled` is `false` by default; anything needing the
  Whisper worker must use a fake.

## 8. Commits + PR

Conventional commits (`feat:`/`fix:`/`test:`/`docs:`/`chore:` + optional scope), **one concern per
commit**, mirroring the PR's Changes groups.

PR to `main` with the body from `PR-TEMPLATE.md`. List one `Closes #<n>` per issue created in
step 3.

**If the user asked to commit manually**, do not commit or push. Instead output the exact
`git add`/`git commit` command sequence, grouped one command per concern, and open the PR only
after they confirm the commits are in.

## 9. Report (caveman ultra)

Issues executed · agents dispatched · gate cycles · PR URL · anything deliberately left undone.
