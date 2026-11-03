# Visitor QR and Resend

Deploy the `VisitorRoster1792022400000` migration, then the updated Backend and Web together.
Registration now requires an email address; groups require a complete name/citizen-ID roster.
Earlier visits and count-only history remain readable. The migration does not invent identities.
Downgrade refuses to discard roster or booking-code history.

## Configuration

Set these only in the Backend environment or secret manager. Never set them in Vite/Web variables:

```dotenv
RESEND_API_KEY=re_replace_with_your_private_key
RESEND_FROM_EMAIL=qr@example.com
```

The sender's domain must be verified in your Resend account. `example.com` above is a placeholder.
The application validates that both settings are present together, and never prints the key or
provider response bodies. With both blank, approval still works and email remains queued; restarting
with valid settings resumes pending deliveries. Configure a stable production `AUTH_JWT_SECRET`:
visitor booking-code recovery uses authenticated encryption with a purpose-specific derived key.
Changing that secret without migrating ciphertext makes existing codes unrecoverable for display/email.

For `pnpm dev:api`, use the Backend's gitignored `apps/backend/.env` and restart the Backend after
setting both values. For Compose, export these two variables in the shell or pass a separate Compose
environment file containing only the email settings. `infra/compose.yaml` forwards them to the Backend;
do not reuse a host-only PostgreSQL URL inside the Backend container.

## Behavior

After the assigned Site Manager approves, the Backend sends a localized email containing the
eight-character booking code, visit schedule/area and QR PNG attachment. It does not include the
group's citizen-ID list. The same QR/code supports subsequent IN/OUT confirmations and does not
expire after five minutes. Approval, gate, site, schedule and cancellation checks still apply.
Worker fallback QR behavior is unchanged.

Rejection and cancellation also queue a localized email with the requested schedule/area and the
review reason when supplied. They contain no booking code or QR attachment. Cancellation revokes
entry permission immediately; delivery failures do not undo the decision. Each new decision resets
the delivery attempt count and email status, so an earlier approval email does not suppress the
cancellation notice. Historical decisions that never queued an email are not sent retroactively.

Outgoing delivery is persisted in the visit. A conditional DB claim prevents concurrent senders;
the remote call runs after releasing the DB connection. A stale five-minute claim is recoverable.
The queue retries with backoff up to five attempts and uses `visitor-<decision>/<visit-id>` as the
Resend idempotency key (`approved`, `rejected`, or `cancelled`). Failed or pending decision emails
can be retried by the scoped Site Manager. Results are saved only for the claimed decision and
delivery attempt: an older in-flight send cannot overwrite a newer cancellation's email status.
An approval already submitted to the provider cannot be recalled; cancellation sends a separate
notice and invalidates access regardless of email timing. Resend retains
idempotency keys for 24 hours, so recovery after that window may send a duplicate if a previous
provider acceptance was never committed locally. `SENT` records provider acceptance, not delivery.

### Sender avatar

The sender display name remains `SmartSite`; no logo is embedded in the message body. The inbox
avatar is controlled by the recipient's mail provider and sender/domain configuration. It cannot
be set through an image in the HTML or a Resend send-email parameter. A sender on the shared test
domain `resend.dev` does not provide control over that domain's brand identity. Use a verified
domain you control and configure the appropriate branding (for example, BIMI for supporting
inboxes). See [Resend's avatar and BIMI guide](https://resend.com/blog/email-changes-for-bimi).

Security must load the QR list before confirming. For entry, select those present and edit the
name/ID of a replacement in the absent person's slot. Checkout uses recorded identities. Each
passage has one history row with the actual count; expanding it shows immutable attendees and
previous identities for replacements. Partial arrivals count as inside, without triggering legacy
reconciliation. Old count-only registrations keep their existing whole-group confirmation.

## Registration Status and Physical Presence

Visitor tracking strictly separates registration lifecycle status from physical presence:
- **Canonical statuses:** `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `EXPIRED`. No synthetic statuses such as `COMPLETED` or `INSIDE` replace registration authority.
- **Physical presence:** Tracked independently across table, cards, and detail modal as:
  - *Not yet entered:* No gate entry has been recorded (`enteredCount === 0`).
  - *Currently on-site:* One or more attendees are physically inside (`enteredCount > exitedCount`), displaying both headcount inside and group size (`inside/groupSize`).
  - *Everyone checked out:* Entry occurred previously and all attendees have departed (`enteredCount > 0 && enteredCount === exitedCount`).
  - *Needs review:* Legacy partial-arrival records without an individual roster that require manual reconciliation.
- **Combined filtering:** The UI provides primary filtering across all canonical statuses (`All`, `Pending`, `Approved`, `Rejected`, `Cancelled`, `Expired`) plus a separate quick toggle for `On-Site only`. This ensures cancelled or expired visits with individuals still inside remain immediately discoverable.
- **Automatic expiration:** Overdue `PENDING` and `APPROVED` visits automatically transition to `EXPIRED` once `validUntil` passes, evaluated consistently across backend reads, management listings, and gate decision endpoints, without requiring the visitor to open the public tracking pass.
- **Departures after expiration/cancellation:** Once expired or cancelled, new entries (`direction === 'IN'`) are rejected fail-closed, while departures (`direction === 'OUT'`) for attendees already on-site remain permitted until everyone has departed. Checked out does not end an otherwise valid approved visit.
- **Summary metrics and bounded lists:** Management listings return site-wide aggregates (`totalVisits`, `pendingVisits`, `approvedValidVisits`, `onSitePeople`) computed across the whole site in SQL, clearly distinguishing visit counts from headcounts. When the query results are capped (e.g. 100 items), the UI displays a clear bounded-list hint rather than silently claiming whole-site totals.

## Verification

Use only the dedicated local `smartsite_test` PostgreSQL service for integration tests. Email tests
stub the Resend HTTP call; automated checks never send real email. For a live smoke test, configure
your verified sender and register a synthetic visit using a recipient you control, approve it, and
check the PNG/booking code against the private tracking page. This requires actual Resend credentials.

Provider references: [send email](https://resend.com/docs/api-reference/emails/send-email),
[idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
