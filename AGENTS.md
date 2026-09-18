# SmartSite development

- Read `docs/architecture/stack-decisions.md` and the relevant requirement before changing behavior. Code and docs must agree; don't invent model accuracy or completed features.
- Application code belongs in `apps/web`, `apps/backend`, `apps/mobile`; AI runtime belongs to the separate `smartsite-ai` repo.
- Use Node 24 LTS, the pinned pnpm package manager and frozen lockfiles in CI. Mobile dependencies must match the installed Expo SDK.
- Use TanStack Query for server state. Redux is optional for shared client state; do not add RTK Query or mirror query caches into Redux.
- Backend owns authorization by role plus Site/Contractor/Zone. Never treat a track ID as worker identity or an unknown identity as permitted.
- No secrets, real face data, camera recordings or model weights in Git. OpenAI calls belong on the server; don't make paid calls during tests.
- Keep code organized by feature with explicit interfaces. Add modules when there is behavior to implement, not empty directory trees or generic base layers.
- Verify `pnpm check` and relevant runtime/contract checks. Report tests requiring credentials, device hardware or GPU separately.
- Work on `codex/` or team feature branches. Never automatically delete branches after merge. Do not merge PRs without authorization.
