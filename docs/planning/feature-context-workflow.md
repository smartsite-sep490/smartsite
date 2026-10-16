# Feature tasks with bounded context

The purpose is to deliver reviewable product changes while keeping most tasks
below 100,000 context tokens. A smaller context is not permission to omit an
authorization boundary, an affected contract or a required verification.

## Read order

1. Root and owning-module `AGENTS.md`.
2. The selected feature pack: purpose, ownership, contracts and open gates.
3. One bounded task brief, plus only its referenced spec sections and decision.
4. Current Git state and the named implementation/test files.
5. Exact evidence receipts needed to distinguish completed work from open work.

Do not load all phase plans, complete historical logs, entire datasets or the
whole integration ledger by default. Search for the relevant symbol or heading,
then read the smallest sufficient section. Expand when evidence reveals a
dependency; do not guess around a missing dependency to save tokens.

## Feature packs

Keep one entry document per product concern, for example Web configuration,
MF05 PPE, MF06 identity/authority, database/runtime and AI quality. Each entry
contains its owner, source paths, canonical requirement IDs, contract links,
current proof pointers, open gates and the next reviewable task.

The reviewed spec remains authoritative. Packs are navigation and working
slices; they must not invent a second definition of a contract. Shared changes
have one owner and a dependency link from each consumer. Do not duplicate the
same status narrative in every feature document.

Mobile remains separate. MF08 implementation remains owner-controlled. An AI
candidate is not accepted because its training or a software test finished.

## Task boundaries and parallelism

- Prefer one observable behavior, one owner and one verification scope per task.
- Start with at most eight named files; list additional files when an actual
  dependency is found. This is a reading budget, not a correctness limit.
- Keep the brief within 1,200 words. Include expected behavior, failure paths,
  non-goals, immutable references, allowed edits, test commands and handoff.
- Workers start without full parent history where supported. Pass source and
  evidence references, not the accumulated conversation.
- Parallelize independent features or read-only reviews. Never parallelize
  migrations, capture ownership or training against the same active resource.
- State whether the worker is Agy or a native Codex agent. Dispatch is not
  completion; inspect the actual diff, report and terminal test result.
- Use existing authorized workers and permissions. A missing Agy connection is
  not evidence of work, and does not authorize a control-surface workaround.

## Context budget and measurement

The operational target is at least 80% of implementation/review tasks below
100,000 tokens, including instructions, reads, tool output and conversation.
Aim for 60,000, leaving room for a failed test and a fix. At 80,000 measured
tokens, checkpoint to a brief and continue in a fresh bounded worker/task.

Record actual telemetry when available. Otherwise record `usage: unknown` and
which controls were used. A rough estimate is a planning aid, not PASS evidence.
Context compaction does not prove that total usage was below the target. A
fresh worker also receives system/tool instructions; brief size is not its
complete context size. No automatic runtime token cap is implemented here.

Default tool output should be limited to about 3,000 tokens per read. Save long
test output to a task-owned log and inspect the relevant errors and summary.
Avoid rerunning unchanged checks; verify again after material changes or when
the previous evidence does not cover the current source.

At handoff, retain: requirement and non-goals, current commit/dirty files,
exact failure or verified result, proof paths, live process ownership if any,
decisions and the next safe action. Target 1,200 words; do not paste raw logs.

## LOC policy

Count physical lines after normal formatting, including comments and blanks.
Never pack statements onto fewer lines, remove assertions or create arbitrary
forwarding layers just to satisfy a count.

| File kind                                    | Target | Review threshold |
| -------------------------------------------- | -----: | ---------------: |
| New/substantially rewritten handwritten code |    300 |              500 |
| Tests                                        |    400 |              700 |
| Feature docs/task briefs                     |    150 |              250 |

Over a threshold: extract a cohesive responsibility, or record an exception
with path, actual count, reason, owner and follow-up. The responsible reviewer
can settle routine exceptions within the approved scope; this is not a new
human approval gate for every file.

Existing oversized files are not subject to blanket refactors. Record their
baseline and avoid growing them without an explicit decision. Generated code,
immutable migrations, vendored contracts and hash-pinned historical fixtures
are listed separately with provenance, never silently exempted from quality
review. Security and semantic checks apply regardless of file length.

These are review rules. No CI LOC enforcement or historical repository-wide
refactor is claimed by adding this document.

Current scoped exceptions are recorded in [LOC exceptions](loc-exceptions.md).

## Completion record

For each task, record the actual commit, changed-file counts/LOC exceptions,
commands and results, evidence paths, reviewer findings and remaining gates.
Do not aggregate overlapping test runs into an invented single suite count.
Use the [task brief template](feature-task-brief.md) for the next task.
