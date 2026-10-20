# Retained local website recovery, 20 October evening

Root found the recorded Web PID50348 absent, no5181 listener and no shutdown
receipt. Dedicated PostgreSQL5433 also had no postmaster/listener. The cause of
the process loss is unproven; it was not reported as graceful shutdown or reboot.

After verifying the exact retained cluster path, absent processes and free5433,
Root used its existing pg_ctl binary to start that cluster without deleting the
stale PID file, resetting Docker or touching5434. PostgreSQL's log records crash
recovery and readiness. New postmaster57664 started at19:30:40VN. An owned
PowerShell startup wrapper waited for descendants after pg_ctl had finished;
Root stopped only that exact wrapper and independently verified PG/Web survived.
The wrapper's terminal exit-1 is not a database shutdown or failed readiness.

Root exported the actual retained schema through the existing read-only snapshot
helper:92tables/66migrations, no table changes versus the saved pointer in that
comparison. Original snapshot hash and current schema/database/port were checked.
Before the first successful login, startup rows/columns and retained selections
matched the fresh export. There was no snapshot import, migration or role grant.

The recovery bundle reuses Web72c9acb and Backendbd91985. Ten changed source pins
were resolved only to byte-identical files from the release's declared immutable
commits; compiled artifacts and model capabilities were not replaced. The first
preparation refusal on a contracts README pin is preserved. Fresh launcher and
1725release pins were verified before startup.

New Web owner:61704, exact birth2026-10-20T19:34:29.4345690+07:00. Local origin:
http://127.0.0.1:5181. Bounded expiry:21October13:32:28VN. Owner metadata is local
`software-main66-owner-v12.json`; credentials remain private local files.

Actual minimal HTTP verification checked exact index/entry bytes, login page200,
unauthenticated Sites401, retained manager login200, authorized Sites200 and
logout204. A missing copied manager credential descriptor initially stopped the
observer before login; copying the original descriptor fixed the observer without
changing accounts. Capture/inference workers and observed Python count are zero.

This restores prior software availability, not the latest source rollout:
cache-fix1049789 and later Backend work are not in this served bundle. Browser,
camera/model, trusted MF06 and full-product acceptance remain open. No cloud,
push, merge, deployment or protected MF08 changes were made.
