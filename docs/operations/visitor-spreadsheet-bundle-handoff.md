# Visitor spreadsheet bundle — Access owner handoff

## Decision and scope

On 18 October 2026 the product owner decided: **keep the implementation unchanged
and hand optimization to the person responsible for Access**. Root must not change
Visitor spreadsheet behavior, dependencies, APIs or deployment under this task.
This is an ownership decision, not a performance waiver or completed delivery.
Recipient acknowledgement and the implementation remain pending.

## Source baseline

- Source: `apps/web/src/components/access/visitor-excel.ts`.
- Tests: `apps/web/src/components/access/visitor-excel.test.ts`.
- Introduced by Main `0dd7d277ac858c79c25eab88b29c9b00d3ece541` (PR65).
- Verified Main baseline: `eb56d141221222d6857a839a00e93df53b095ea5`.
- Root baseline: `46e919bab2b2c956130db00e40d3e171744bb86d`, branch
  `feat/mf05-mf06-main-sync`; this local commit is not claimed pushed.
- Both files are byte-identical between those Root/Main baselines. Git blobs:
  source `b6d56cb44fc0b5234edc54b0abd21c8f82d509b7`,
  tests `d2e17ee4fe8c1d3c1da0e38b011bb0498bbb3cb9`.

The Access owner can start from the named Main baseline for these files; no
unpublished Root implementation is needed to inspect the workbook feature.
Reconcile with current Main before implementing; do not reset another branch.
This task is separate from Tuấn's Backend/database/ERD assignment and MF08.

## Measured failure

Production bundle-v25 has `assets/exceljs.min-DgbhWywh.js` at **929,569 bytes**.
NFR-08 caps each JS chunk at **500,000 uncompressed bytes**. The actual initial
static closure passes separately at **473,196 bytes across four JS files**;
the whole bundle guard still fails on ExcelJS. These are build sizes, not browser
timing, total first-route traffic or production acceptance.

The workbook import is already dynamic. ExcelJS4.4.0 browser entry is the single
prebundled `dist/exceljs.min.js`; merely moving its import or renaming chunks
does not establish compliance. No smaller supported entry or replacement has
been qualified. Do not substitute CSV, write an ad hoc XLSX parser, add Node
polyfills or waive the budget to make the check green.

## Required compatibility and acceptance checklist

- [ ] Access owner acknowledges responsibility and records the working baseline.
- [ ] Propose a supported, measured browser parser or coordinated server solution;
      obtain separate approval for new dependencies or API changes if required.
- [ ] Preserve `.xlsx` import, file limit 2 MiB and 2–1,000 members; first sheet
      and current normalized English/Vietnamese header aliases remain supported.
- [ ] Preserve 12-digit identity text including leading zeroes. Reject formula
      objects and cached formula results, invalid/duplicate identities, empty or
      over-255-character names, missing headers, malformed or excessive rows.
- [ ] Preserve selected-language feedback and `VisitorMemberInput`; Backend
      remains authoritative for validation and authorization.
- [ ] Preserve `.xlsx` template, localized headers, text identity column, bold
      header, frozen first row, widths 35/24, filename `smartsite-visitors.xlsx`
      and object-URL cleanup. Preserve Visitor QR/public/role flows.
- [ ] Retain current tests and add material compatibility/adversarial cases,
      including decompression and resource limits appropriate to the parser.
- [ ] Run affected tests, typecheck, lint and actual production build. Run
      `node scripts/check-web-bundle-budget.mjs <production-manifest-path>`;
      prove initial closure and every JS chunk pass, using actual output bytes.
- [ ] Supply an allowed real-browser import/export check with synthetic fixtures;
      DOM or Node workbook tests alone do not prove browser compatibility.
- [ ] Return a focused commit/PR, dependency/lockfile delta, command results,
      manifest/asset hashes, limitations and rollback instructions for review.

## Evidence and safe delivery

Local run directory:
`D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1`.

Relevant files are `bundle-v25-budget-proof-v1.json`,
`bundle-v25-attribution-v1.json` and
`web-production-bundle-v25/.vite/manifest.json`. The portable handoff includes
the source, tests, budget proof and a SHA256 manifest; it excludes credentials,
environment files, runtime receipts and real visitor data.

No message, push, merge or deploy is implied by preparing this handoff. Access
owner delivery/acceptance must be recorded separately. The Excel budget remains
open until the real gates pass; all other product and AI gates remain separate.
