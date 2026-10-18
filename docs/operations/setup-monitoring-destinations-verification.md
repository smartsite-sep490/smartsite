# Explicit monitoring destinations from Camera Setup

Camera Setup now names both existing destinations: PPE monitoring and
Restricted-zone monitoring. Both retain only the Site/camera resolved from the
authorized loaded catalog. The existing monitoring capability gate remains;
Site Manager alone does not gain monitoring access. Locale changes update labels
without closing the active configuration dialog or requesting metadata again.

Agy p5 authored four rendered regressions, implemented the bounded header and
paired EN/VI labels, then updated two legacy selector fixtures. Root reproduced
3 FAIL /1 PASS before implementation and4 PASS afterward. The affected setup and
catalog suite passed99 cases across10 files. After the independent Agy p8 source
review, Root added explicit EN/VI navigation-landmark names to the new test;
final4 focused cases passed. They overlap the99, not103 distinct cases.

Whole Root Web source/test typecheck passed under the existing bounded768-MiB
heap/1024-MiB-RSS/40-second guard, peak RSS877.3MiB. Changed five-file lint and
formatting passed. Production Vite buildv27 passed with AI paused. Initial JS
closure remains473196bytes, within500000. The unchanged Access/Visitor Excel
chunk929569bytes still exceeds the individual chunk limit; owner handoff remains.

Root verified the setup component above and below the header is identical after
line-ending normalization. No query/session/capability/Backend/Main-login changes.
Native links continue to rely on Backend authorization at their destination.
The source-size exception is a bounded header replacement in the existing file,
not a waiver for growing data/session machinery.

## REA research and setup

Root used real REA MCP static analysis on3shadcn and2Tabler public scripts, then
read paginated module views. Source URLs/bytes/SHA256 and MIT license snapshots
are retained. Semantic coverage is explicitly partial; no scripts were executed
and no browser/render/assistive-technology proof follows from these analyses.
References inform named task navigation; no third-party component code or new
library was copied into SmartSite.

At the human's request Agy p8 verified existing REA6.5 CLI availability and wrote
a reusable workflow. Root then registered exactly one REA stdio entry in the
Antigravity MCP configuration, preserving the three existing server entries.
Direct stdio initialize/tools-list/static single-chunk invocation passed:
207tools advertised,1file14486bytes parsed,0parse failures. No approval bypass,
package install, browser launch or AI process. The live Agy session's native MCP
reload/tool-use remains unverified; registration is not proof of live adoption.
Private configuration backup stays outside Git and is never a shareable artifact.

Follow-up actual Agy invocation succeeded through the configured stdio server:
1public Tabler script1475bytes,1parsed file,0parse failures, exit0 and no forced
server stop. Evidence/receipt: agy-stdio-static-smoke-v2.json and its receipt.
This proves Agy can use the prepared bounded stdio workflow; the agent-native
tool-list reload is still separate. Initial CLI bootstrap at128MiB exited134
before emitting Evidence; that failure is retained, not counted as a parse run.

## Evidence and release boundary

Run directory: `D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1`.
See software-final-proof-v1.json, named RED/GREEN/affected logs, source pins,
Agy implementation/review reports, REA summaries and agy-mcp-setup-receipt-v1.json.
Retained setup failures include wrong Vitest path, missing test-group environment,
catalog-audit cwd, stale legacy selectors and Windows ESM loader path.
REA SDK-client lookup failed before config mutation; native JSON-RPC stdio
verification succeeded without adding a dependency.

This is local source/build proof; no website rollout, database mutation, push,
merge, deployment, browser acceptance or whole MF05/MF06 completion is claimed.
