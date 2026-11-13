# Verification process

How to verify a change in this repository without re-running everything, and how to report it.
The tool is `scripts/verify-impact.js` (npm scripts in `functions/package.json`). Coverage ratios come
from `scripts/coverage-engine.js`. Both are described here; the numbers live in their generated files.

## The rule for every change

1. Run `npm run verify:plan` (in `functions/`) and paste its output. It lists the changed files, every
   unit that will run with the file that reached it, and the estimated time. It runs nothing.
2. Run `npm run verify:changed`. It builds once if TypeScript changed, runs the planned units and three
   canary units, updates the baseline and prints the **Verification scope block**.
3. Paste the scope block unedited into your report. Never write "all tests pass" without it.
4. Do not run `npm run verify:full` unless the plan says FULL (no baseline, a global invalidator or the
   environment changed, an unmapped file) or a release is being cut.
5. Expect a large plan after a change to the gate (`functions/src/services/contextResolver.ts`), the
   input parser, shared schemas, rules, the test client or harness. Say so in the report;
   `docs/audit/blast-radius-table.md` shows how many units each file reaches.

## Statuses (D-19)

| Status | Meaning |
|---|---|
| `PASS` | ran in this run and passed |
| `FAIL` | ran in this run and failed; a failed unit runs again on every later run until it passes |
| `SKIPPED (unchanged since <run id>)` | no file in its input closure changed since a run where it passed; skipped is not passed |
| `NOT RUN` | no baseline record yet; it will run |

## What a unit depends on

A unit's input closure is computed, never listed by hand:

- static imports of its entry files (TypeScript pre-processor, including `import type` and `require`);
- every repository file its processes read or loaded during its last run (preload hook
  `scripts/lib/fs-trace-hook.js`, passed through `NODE_OPTIONS`; `functions/lib/**` maps back to `functions/src/**`);
- for emulator units: the source closure of every callable the unit invoked (`.local/traces`) and of every trigger;
- declared inputs: the rules files, `firestore.indexes.json` and `firebase.json` for emulator units;
- global invalidators in `verify/impact.config.json`: any change there makes the plan FULL.

A unit with no traces from its last run is `UNTRACED` and depends on every file. A changed file that
reaches no unit and is not in `ignored` (each entry has a reason) makes `verify:plan` fail and the plan
FULL. Content is hashed with line endings normalised; git state is never used, so uncommitted work counts
and a reverted change costs nothing.

## Other commands

| Command | Use |
|---|---|
| `npm run verify:explain -- <unit>` | the unit's closure, where each file came from, and which files changed |
| `npm run verify:status` | baseline id and age, trusted flag, environment match, stale, untraced and unmapped counts |
| `npm run verify:selftest` | the 12 acceptance checks of the impact system itself (needs a baseline) |
| `npm run coverage:compute` | regenerate the field catalog and `docs/audit/coverage.{json,md}` |
| `npm run test:coverage-defects` | the seven seeded defects the coverage engine must detect |

## Requirements the runs assume

- The emulators run on 127.0.0.1 (Firestore 8080, Auth 9099, Functions 5001, Storage 9199). Emulator units
  fail, never skip, when they are not reachable.
- A full run deletes all Firestore and Auth emulator data of the project before seeding, so its numbers
  describe one fresh data set.
- Emulator suites run one at a time: they share one project (`singleProjectMode`), so running them in
  parallel would let one suite's data leak into another's assertions. Static guards and unit-test files run
  in parallel.
- Only one agent or person may run units against the emulators at a time. Traces from scripts started by
  hand are written as `adhoc--*` files and are not counted as evidence.
- `verify:selftest` runs units with injected faults. Those runs write their traces under
  `.local/selftest-evidence` (`VERIFY_EVIDENCE_DIR`), never over the recorded `.local/traces` and
  `.local/fs-traces` that the baseline closures and the Coverage Engine read. Check 11 fails if the
  recorded evidence changed during the faulty runs.

## Claims in `docs/audit/**`

"All", "every", "complete", "fully" and "100 %" need a `[cov:C-n]` reference to an invariant that is n/n in
the current `docs/audit/coverage.json` (D-20). Hand-typed counts are defects.
