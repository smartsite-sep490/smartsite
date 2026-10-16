# Private local evidence with a container Backend

The Backend currently serves `local://evidence/...` through authenticated, Site-scoped routes. It has no cloud object-storage adapter. The default Compose stack does not configure an evidence root; its AI profile starts the API, which does not automatically start a camera worker or publish retained JPEGs.

For a host camera worker using `LocalEvidencePublisher`, the optional `infra/compose.evidence.yaml` overlay mounts its existing private evidence directory into the Backend read-only. Set `EVIDENCE_LOCAL_HOST_ROOT` to that directory and use both Compose files:

```sh
docker compose -f infra/compose.yaml -f infra/compose.evidence.yaml up -d backend web
```

The worker must already use the same host directory as its `evidenceDir`. Files retain the publisher's flat `{sessionId}_{sequenceNumber}_{eventId}.jpg` naming. A missing variable fails Compose configuration. Docker refuses to create an absent host directory. This overlay does not start a writer or change camera/model settings.

Provision permissions before startup: the writer needs write access, and the Backend's container user `node` (UID1000) needs directory traversal and file read access. Grant access to those identities only using host ACLs or a dedicated read group; do not make the directory/files world-readable. A writer's owner-only temporary-file permissions may require an explicit reader ACL. Validate the actual Docker host's mount/permission behavior with synthetic evidence before using recordings. The Backend's read-only mount prevents it from altering evidence.

This overlay supports a single configured publisher root. Separate per-camera directories from a multi-camera manifest need an agreed storage layout/adapter before they can all be served by one Backend root. Mounting a common parent does not make nested files discoverable by the current flat resolver. Never share evidence with the Web container or expose the directory as a static/public route.

Back up the database and this evidence directory together while writers are stopped or under a documented consistent snapshot procedure. Preserve the files referenced by the captured events, verify file hashes, and restore into a new private directory before changing the reader/writer configuration. Restoring SQL alone leaves evidence references unresolved. No automated purge, retention duration, crash-consistent snapshot, cloud policy, or RPO/RTO is established by this overlay; use a reviewed policy before operating on real media.

Run `node infra/check-evidence-compose.mjs` to validate the real merged Compose configuration with an empty env file and synthetic temporary directory. It runs no containers and reads no runtime `.env`. CI runs it before the integration suite. Container startup, non-root permission behavior and private evidence HTTP reads still require a Docker daemon and the configured writer; configuration validation does not prove these runtime gates.

Storage guidance: [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) and [OWASP file access/storage controls](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

The configuration gate compares the actual evidence overlay with a synthetic
creation-enabled control. Older compose-go JSON omits `false` on a boolean;
newer OptOut encoding omits the default `true` instead. Omission is accepted only
when the control proves the former encoding. Both variants still reject host
creation, writable mounts, mismatched reader roots and Web exposure. Run
`node --test infra/evidence-compose-validation.test.mjs` before the actual Compose
check; neither command starts a container or reads real media. See the upstream
[boolean encoding](https://github.com/compose-spec/compose-go/blob/v2.4.9/types/types.go#L531-L536)
and [OptOut encoding](https://github.com/compose-spec/compose-go/blob/main/types/types.go#L544-L559).
