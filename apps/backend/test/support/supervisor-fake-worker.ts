/** Synthetic pixels and Person-only delivery: no camera, detector or identity. */
export const supervisorFakeWorker = String.raw`
import asyncio
import json
import os
import sqlite3
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

from pydantic import SecretStr

from smartsite_ai.core.region_configuration_store import RegionConfigurationStore
from smartsite_ai.domain.observations import TechnicalObservationEvent
from smartsite_ai.ingestion.envelope import FrameEnvelope
from smartsite_ai.integrations.backend_configuration_client import BackendConfigurationClient
from smartsite_ai.integrations.backend_client import BackendClient
from smartsite_ai.integrations.configuration_poller import CameraConfigurationPoller
from smartsite_ai.integrations.outbox import OutboxDispatcher, SqliteEventOutbox
from smartsite_ai.integrations.worker_generation import GenerationBoundSource, load_worker_generation


class SyntheticSource:
    source_id = "supervisor-fake-frame"
    is_connected = False

    def __init__(self, external):
        self.external = external
        self.session = uuid4()

    async def connect(self):
        self.is_connected = True

    async def close(self):
        self.is_connected = False

    async def read_frame(self):
        return FrameEnvelope(
            stream_id=self.source_id,
            camera_external_id=self.external,
            session_id=self.session,
            captured_at=datetime.now(UTC),
            sequence_number=0,
            width=64,
            height=64,
            payload=bytes(64 * 64 * 3),
        )


async def main():
    prohibited = (
        "DATABASE_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED",
        "SMARTSITE_AI_ISSUER_TOKEN", "NODE_OPTIONS", "PYTHONPATH",
    )
    assert not any(os.environ.get(key) for key in prohibited)
    credential, outbox = Path(sys.argv[1]), Path(sys.argv[2])
    raw = json.loads(credential.read_text())
    binding = load_worker_generation(credential, UUID(raw["cameraId"]), now=datetime.now(UTC))
    record = outbox.with_suffix(".event.json")
    replacement = record.exists()
    # Test clock advances durable retry eligibility; credential/Backend clocks stay real.
    queue = SqliteEventOutbox(outbox, clock=lambda: datetime.now(UTC) + timedelta(seconds=10 if replacement else 0))
    claim = (UUID(binding.camera_id), UUID(binding.worker_generation_id), UUID(binding.stream_session_id))
    await queue.claim_worker_session(*claim)
    try:
        await queue.claim_worker_session(*claim)
    except RuntimeError:
        pass
    else:
        raise AssertionError("duplicate generation claim accepted")

    if not record.exists():
        event = TechnicalObservationEvent.create(
            event_id=str(uuid4()),
            camera_external_id=binding.camera_id,
            stream_session_id=binding.stream_session_id,
            captured_at=datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            frame_dimensions={"width": 2, "height": 2},
            observations=[{
                "type": "PERSON", "trackId": 1, "confidence": 0.9,
                "boundingBox": {
                    "x1": 0.1, "y1": 0.1, "x2": 0.9, "y2": 0.9,
                    "coordinateSpace": "NORMALIZED_0_1",
                },
            }],
        )
        await queue.enqueue(event)
        record.write_text(json.dumps({"eventId": str(event.event_id)}))
    pending = await queue.ready()
    event_id = json.loads(record.read_text())["eventId"]
    assert len(pending) == 1 and str(pending[0].event.event_id) == event_id
    event_hash = pending[0].payload_hash

    observed, stop = [], asyncio.Event()

    async def observe(response):
        if response.request.method == "POST":
            await response.aread()
            observed.append({
                "httpStatus": response.status_code,
                "ack": json.loads(response.request.content),
            })
            stop.set()

    source = GenerationBoundSource(SyntheticSource(binding.camera_id), binding)
    async with BackendConfigurationClient(
        os.environ["SMARTSITE_AI_BACKEND_INGESTION_URL"],
        SecretStr(os.environ["SMARTSITE_AI_BACKEND_SERVICE_TOKEN"]),
        max_retries=0,
    ) as client:
        transport = await client._get_client()
        transport.event_hooks["response"] = [observe]
        poller = CameraConfigurationPoller(
            client=client,
            store=RegionConfigurationStore(),
            camera_id=UUID(binding.camera_id),
            camera_external_id=binding.camera_id,
        )
        poller.enable_generation_ack(source)
        try:
            await poller.refresh()
            await poller.acknowledge_loaded()
            await source.connect()
            await poller.acknowledge_loaded()
            assert not observed, "ACK before first frame"
            frame = await source.read_frame()
            assert str(frame.session_id) == binding.stream_session_id
            await asyncio.wait_for(poller.run(stop), 8)
            assert len(observed) == 1
        finally:
            await source.close()
    assert not source.is_connected
    async with BackendClient(
        sys.argv[3], SecretStr(os.environ["SMARTSITE_AI_BACKEND_SERVICE_TOKEN"]), max_retries=0,
    ) as backend:
        assert await OutboxDispatcher(queue, backend).drain_once() == 1
    counts = await queue.counts()
    with sqlite3.connect(outbox) as connection:
        claims = connection.execute("SELECT count(*) FROM worker_session_claim").fetchone()[0]
    print(json.dumps({
        "claims": claims, "pending": counts.pending, "eventId": event_id,
        "delivered": counts.delivered, "terminal": counts.terminal, "eventHash": event_hash,
        "preFrameAckCount": 0, **observed[0],
    }))


asyncio.run(main())
`;
