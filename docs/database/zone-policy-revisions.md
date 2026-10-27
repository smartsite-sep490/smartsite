# Immutable Zone PPE policy revisions

`ZonePolicyRevisions1793664000000` follows the reviewed Region history migration.
It adds the business table `zone_policy_revision`; existing Zone columns, API
responses and historical Region rows stay unchanged. The owner's baseline ERD
remains authoritative; the following mapping is an additive extension.

| Physical column     | Type                  | Meaning                                                               |
| ------------------- | --------------------- | --------------------------------------------------------------------- |
| zone_id             | uuid, required        | Zone, composite primary key                                           |
| policy_revision     | bigint, required      | Positive JavaScript-safe counter, composite primary key               |
| site_id             | uuid, required        | Site scope of this Zone                                               |
| zone_type           | varchar(32), required | STANDARD, RESTRICTED or HAZARDOUS                                     |
| restriction_policy  | varchar(32), required | NONE, PROHIBITED_FOR_ALL or AUTHORIZATION_REQUIRED                    |
| required_ppe        | text[], required      | Distinct HARD_HAT, SAFETY_VEST, GLOVES, BOOTS, GOGGLES; empty allowed |
| is_cutover_baseline | boolean, required     | Current state at migration, not original policy history               |
| recorded_at         | timestamptz, required | Finite database recording time                                        |

The `(zone_id,site_id)` FK references existing `zone(id,site_id)` with RESTRICT;
the primary key supports Zone revision lookup and the FK prefix. A Site/time
index supports scoped history reads. UPDATE, DELETE and TRUNCATE are forbidden.
Empty rollback succeeds; populated rollback refuses to discard history.

One baseline per existing Zone records only its current policy at database cutover.
No old geometry revision receives invented policy provenance. New Zone creation
and real unlocked policy changes append history inside the existing authorized
command transaction. The existing Zone row lock serializes revision allocation;
new Zone creation owns its uncommitted row. Missing history and counter overflow
fail closed. No-op, rename and linking append nothing. A linked Zone remains locked.

The latest immutable row supplies the revision: no duplicate mutable policy counter
is added to `zone`. Raw database inserts outside these commands do not prove
application provenance. This slice does not implement policy changes on linked
Zones, camera bundle issuance, worker enrollment/ACK, event historical admission,
website migration or production acceptance.
