# MF08 Web business API

Canonical TypeScript request/response types: `src/safety-workflow-api.ts`, exported from `@smartsite/contracts` and the shared client. This adds Backend/Web business APIs; the AI observation schema/provenance is unchanged. Existing SafetyAlert responses gain optional nullable `incidentId` for compatible older clients.

All paths are under `/api/v1/sites/:siteId`, authenticated with the user token. Actor comes from authentication, never input.

| Method/path                                                                     | Role / command                                                                            |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET incidents, incidents/:id, incidents/:id/actions                             | Safety/Manager same Site; Security related case and own actions; global Admin read        |
| POST incidents                                                                  | Safety; CreateIncidentCommand (manual or confirmed alerts)                                |
| POST incidents/:id/alerts                                                       | Safety; LinkIncidentAlertsCommand                                                         |
| POST incidents/:id/actions                                                      | Safety; AssignCorrectiveActionCommand                                                     |
| POST incidents/:id/actions/:actionId/start                                      | Assigned Security; VersionCommand                                                         |
| POST incidents/:id/actions/:actionId/submissions                                | Assigned Security; multipart commandId, expectedVersion, resultDescription, optional file |
| POST incidents/:id/actions/:actionId/reviews                                    | Safety other than submitter; ReviewSubmissionCommand                                      |
| POST incidents/:id/close, incidents/:id/reopen                                  | Safety; ReasonCommand / ReopenIncidentCommand                                             |
| GET incidents/:id/alerts/:alertId                                               | Scoped linked source summary and review history                                           |
| GET incidents/:id/alerts/:alertId/detections/:eventId/evidence/:index           | Scoped linked camera JPEG                                                                 |
| GET safety-tasks, safety-tasks/:id                                              | Manager, assigned Safety, global Admin                                                    |
| POST safety-tasks                                                               | Manager; CreateSafetyTaskCommand                                                          |
| POST safety-tasks/:id/start                                                     | Assigned Safety; VersionCommand                                                           |
| POST safety-tasks/:id/submissions                                               | Assigned Safety; multipart commandId, expectedVersion, resultDescription, optional file   |
| POST safety-tasks/:id/verify, return, cancel                                    | Manager; ReasonCommand. Self-verification forbidden                                       |
| GET safety-assignees?role=SECURITY_OFFICER or SAFETY_OFFICER                    | Safety looks up Security, Manager looks up Safety, global Admin read                      |
| GET incidents/:id/evidence/:evidenceId or safety-tasks/:id/evidence/:evidenceId | Scoped private JPEG, including retained task submission evidence                          |

List endpoints support offset (>=0), limit (1..100), stable date/ID order; workflows support status and assignedTo filters. Security/assigned Safety filters cannot expand their readable scope.

Create example:

```json
{
  "commandId": "11111111-1111-4111-8111-111111111111",
  "title": "Synthetic hazard",
  "description": "Fix walkway barrier",
  "severity": "HIGH",
  "occurredAt": "2026-10-02T10:00:00Z",
  "zoneId": null,
  "alertIds": []
}
```

All writes take a commandId UUID; creation starts version 1. Incident link/assign/close/reopen compare Incident version; action start/submit/review compare **action version**; task commands compare task version. Successful action changes also advance the parent Incident version. Mutations return `{ resource, replayed }`. Exact semantic input/actor/path/photo retry returns the stored original outcome; reuse with different input or stale version returns 409. Clients must reload and review a changed record before retrying with a fresh command. Text-only result remains available when storage is not configured.

JPEG: <=1 MiB, MIME + signature + size validation, Backend-generated key and SHA-256, no bytes in DB. DTOs omit private keys, raw AI payload and biometric data. Evidence endpoints use no-store/nosniff and enforce both Site and resource membership.

Append-only audit and decided submissions retain prior reasons/results. Incident close atomically closes verified actions; reopening requires a new action. No policy-exception closure endpoint.
