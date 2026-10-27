# Camera-region Web local recovery

Web `ed9dd85` is served at `http://127.0.0.1:5181`; Backend `bd91985` and the
canonical66 migration graph are unchanged. No graph70 naming migration was
applied. Local commits remain unpushed/unmerged.

Windows rebooted11:07VN19Oct, interrupting the prior website and native sources.
There is no graceful-exit receipt for that interruption. The owned PostgreSQL18
data directory restarted at5433 and its log recorded automatic crash recovery.
A read-only capture matched all92 application tables and4 retained selections
to the latest saved snapshot before the new runtime started. Existing accounts
and roles were retained; no application DDL, seed or backup restore was used.

Current owner at11:38VN: Node31276, birth11:36:32.282276VN; PG21824,
birth11:17:49.922570VN. Current output ends `113632-37659111`.
Deadline remains19:53VN19Oct; do not assume availability after expiry/reboot.

The webcam model-free host is owned and returns current configuration JPEGs.
Tapo initially returned a frame after reboot but ended again. Its stdout proves
native release; an H.264 decoding error was observed in stderr. This does not
establish the terminal cause or a process exit code. Tapo returns503 truthfully.
No repeated capture retry, model load, inference or training was introduced.
There are2 configured sources but only1 currently available source, with2 owned
Python processes. Two replay metadata entries remain uncommissioned.

The original all-four-process start guard refused the missing Tapo source.
A separate reviewed degraded-start guard validates the live webcam, absent
Tapo owners/port, original source/input pins and Tapo release receipt. It does
not weaken the original guard or claim both sources ready. The first Node
attempt refused Windows slash spelling before creating output or touching DB;
the corrected starter normalizes paths. Failed receipts/logs are preserved.

Actual HTTP proof: Manager/Admin logins, scoped metadata, Manager global-user
denial403, unauthenticated image401, webcam200/hash/scope/configuration version,
Tapo503, four page responses200 and77 exact public asset bytes. This is not
browser, hardware reliability, latency/capacity or whole MF05/MF06 acceptance.

Evidence root:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1`.
Read `reboot-recovery-v2/{read-only-proof,http-proof,served-assets-proof}.json`
and `current-camera-region-owner-proof.json`. Current guard:
`Confirm-Current-Configuration-Website-v4.ps1`. Credentials remain in the
current output's private demo files; do not put them into logs or Git.
