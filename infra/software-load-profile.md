# Owned software API load profile

This tool measures selected existing metadata/detail routes and name-only Zone PATCH operations against an explicitly owned test runtime. It does not provision infrastructure, create users, change throttling/permissions, start AI/camera workers, accept models, or certify production/browser performance.

Run it only after a separate fixture procedure has created and verified a fresh isolated schema on `smartsite_test` at5433, started a pinned Linux qualification image and logged in distinct synthetic users through the real application. Protect the private input file: it contains access tokens and WEB refresh cookies. Keep task files under the approved D data directory; never commit/dump that input.

```text
node infra/software-load-profile.mjs <absolute-private-profile.json> <fresh-absolute-output-directory>
```

The CLI rejects remote URLs, credentials/query strings in the base URL, protected ports5181/5433/5434, unexpected container identity/image/birth, default/wrong database/schema, wildcard host publishing, and enabled enqueue/preview configuration. Its target must be a running non-root/read-only container labeled `smartsite.owner=root` and `smartsite.task=software-load`, with exactly one loopback port binding. These settings are bounded preflight evidence, not a complete security audit or proof of every possible AI worker.

The caller owns fixture preparation and shutdown. This tool does not stop an existing runtime or delete schemas, media, logs or containers. If a run fails, retain its output and verify the exact owner before cleanup. The exported `runLoadProfile` is also used by real HTTP tests and separately guarded native harnesses; calling it directly does not provide the CLI's Docker ownership proof. Report native Windows and Linux qualification separately.

A fatal actor or progress-observer error cancels the profile's other requests and waits, drains all actor loops, then rejects with the original error. This includes ownership observation and progress-file write failures. The caller's cancellation controller is not modified. The tool does not kill the target API or container; caller-owned teardown and retained failure evidence are still required. This cancellation safeguard does not establish an RSS cap, load capacity or an accepted soak run.

Run the isolated tool checks with `node --test --test-concurrency=1 scripts/software-load-profile.test.mjs`. The root `scripts/*.test.mjs` test command also discovers this entrypoint; its HTTP fixtures use ephemeral loopback servers and no database, camera, Docker or production target.

## Private input fields

- `baseUrl`: `http://127.0.0.1:<owned-port>/api/v1`; `origin`: existing WEB origin `http://127.0.0.1:5173`.
- `durationMs`: measured window,1–7200000; `warmupMs`:0–300000, excluded from measured histograms; `thinkMs`:1–60000 per actor; `timeoutMs`:1–10000; `maxBodyBytes`:64–131072.
- `actors`:1–20 distinct `{id, token, cookie, expiresAt}` objects. `/auth/me` must return the exact active account without a pending password change. A 20-user claim requires20 independently authenticated accounts, not copies of one token. Near-expiry refresh uses WEB Cookie+Origin, serializes requests, honors429 and never retries an ambiguous refresh failure.
- `routes`:1–32 uniquely named entries, `kind` metadata/detail/write, `method` GET or name-only PATCH, bounded existing `/sites` scope paths, `response` PAGE/OBJECT. GET queries allow only bounded `limit`/`offset`. PATCH permits only `{name}` on an existing Zone; it cannot change policy/PPE/geometry or submit review/ingestion commands.
- `owner`: exact containerId/image/startedAt/owned schema receipt. Optional `datasetCounts` are declared metadata, explicitly not verified by this tool. Independently verify the spec's10Sites/100Cameras/200Zones/1000Regions/10000events and fixture provenance.

## Interpreting results

Each actor has at most one in-flight request. This is a closed-loop, paced profile; it can understate open-loop saturation and does not count queueing before request start. Record the route mix, think time, network/host/container limits, dataset, warmup, duration and successful/attempted sample sizes alongside results. Preserve the default per-route/IP throttler; shared-origin20 users can hit it. Route cooldown honors Retry-After without an automatic mutation retry.

Fixed-size1ms histograms report nearest-rank p50/p95/p99 for successful requests separately from all attempts. Quantization rounds upward, clamped at10000ms; samples aren't retained as an unbounded array. Responses must pass bounded JSON checks, scoped Site/Camera checks where those fields exist, exact detail ID and expected rename name. This is not full DTO, record-content, pagination-order or authorization acceptance.

429,5xx,timeout,network,cancellation and body failures stay separate. A route with no successful samples cannot pass its latency budget. `transportHealthy` is deliberately conservative: no throttled/timeouts/network/body/cancelled/non5xx unexpected responses, and unexpected5xx fraction below1%. This is not a new approved policy for acceptable429 rates. Do not adopt a reviewer-invented2% allowance or count fast guard denials as successful database latency.

The output always says `fullNfrAcceptance:false`. A finished short smoke is not30-minute acceptance; a finished30-minute20-actor window is not2-hour soak. Backend PID1 RSS (CLI) is sampled separately from generator RSS, with unavailable metrics represented as null. Verify PID1 is the real Node main in the qualified image; an init wrapper invalidates that inference. This tool does not establish event-loop delay, all pool/queue pressure, memory leak freedom, TLS, browser FPS/latency, physical camera capacity or whole-product acceptance. Native harnesses must use their actual process PID/birth and metrics instead.

`owner.json`, `progress.json` and `result.json` omit credentials, response bodies, raw routes/base URL and query contents. Runtime/ingress log safety still requires separate review. CLI errors are generic to avoid printing private inputs. Follow the production runbook and existing acceptance checklist before release.
