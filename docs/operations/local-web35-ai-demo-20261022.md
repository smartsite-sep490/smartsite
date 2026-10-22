# Local Web35 and AI demo wiring — 22 October 2026

Human priority: connect existing components for tonight's local demo; improve production quality afterwards. This does not approve model quality or release.

- Web35 built from 549a7d2 includes accessible camera action labels and MF06 capture timestamps. Flow36 stopped with a clean shutdown receipt; current configuration exported and matched, 73 migrations retained, media inventory empty.
- Flow37 served exact Web35 assets. Login/logout, four route shells, authorized camera/Zone/history requests and READY authority state passed HTTP checks. Four cameras/six Zones returned; browser rendering not verified.
- Before the AI follow-up, PG440 and Node59100 disappeared and ports5433/5181 were absent. Cause/graceful termination unproved. Preserved failure; recovered the existing PostgreSQL18 cluster without init/reset/schema migration. New PG69444; configuration rows matched latest snapshot.
- Flow38 uses the same schema73/Backend5e118c5/Web35 with only replay camera UUID de5168a0-0eeb-4b46-a20a-b97c51320bdb added to the AI configuration allowlist. Node61704 started16:13VN; expires02:13VN23 October. Source/evidence roots retained; browser preview and MF06 worker remain disabled.
- Real one-camera inference uses fallback80b (15-class unified profile), CPU832, original input-ppe.mp4, fresh outbox and shared evidence root. V12 remains rejected and unused.
- First preflight refused before model load because display code VIDEO-CORE5 differs from authoritative external ID core5-recorded-demo. HTTP configuration200 established the correct identity; corrected manifest preserves camera/region data.
- Second execution actually loaded/closed the model, processed26 frames, sampled50, dropped0, exit0. Events enqueued0 and no outbox deliveries. Therefore no fresh persisted alert/notification is demonstrated. The observation-only diagnostic also completed exit0: 27 PERSON and42 PPE observations, all PPE PRESENT (12 vest,8 gloves,19 boots,3 hardhat). Two raw NO-Safety Vest detections did not produce associated MISSING observations. No missing observation reached the temporal gate; backend notification delivery was not exercised. Thresholds and semantics stayed unchanged.

Evidence: SmartSiteData/runs/demo-ai-notification-20261022-v1; product-rollout-461c857-20261021-v1/flow37-http-proof-root-v1.json, flow37-owner-proof-root-v1.json, flow38-recovery-preflight-proof-root-v1.json and launch receipts (private).

Next: inspect actual observations and correlate real event -> persisted alert -> correct recipient -> authorized image retrieval. SAFETY_OFFICER site assignment is required for the inbox; Admin is not automatically a recipient. Do not fabricate identity, negatives or notifications. This remains a local experimental integration, not production acceptance.

## Follow-up: complete replay and recipients

- Initial read-only recipient query found zero eligible Safety Officers at the demo site; zero alerts/notifications. Owner subsequently approved local demo.safety. Existing provisioning/password-change APIs created the active account with exactly one SAFETY_OFFICER assignment at that site and completed its password change. Login/me/inbox200 and Admin user-list403 verified; demo123/demo.manager account fields and assignments matched before/after. Proof: demo-ai-notification-20261022-v1/demo-safety-proof.json. Credentials stay outside Git in the private local receipt. This removes the recipient prerequisite; notification creation remains unproven.
- Native15 FPS on CPU processed46/76 and dropped30 frames. Repeated with the same80b spec differing only device=cuda:0: processed all76/76, zero dropped/sampled frames, model closed and exit0, zero events. This rules out sampling/drop as the only cause on this video; it does not prove absence of real violations.
- GPU observation counts: {"('SAFETY_VEST', 'PRESENT')": 37, "('GLOVES', 'PRESENT')": 23, "('BOOTS', 'PRESENT')": 52, "('HARD_HAT', 'PRESENT')": 7}. No notification delivery proven. Preserve current filters and choose a representative source; do not force MISSING or weaken temporal guards.
