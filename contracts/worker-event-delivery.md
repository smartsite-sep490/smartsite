# Worker event delivery context

The delivery envelope associates a technical observation with its original camera, worker generation, stream session, configuration version, view revision and configuration acknowledgement. It also records whether the producer declares a LIVE or REPLAY source.

The envelope schema version is 1.0.0. The parser accepts the existing observation versions 1.0.0 through 1.4.0, checks stream-session equality, rejects unknown fields and invalid identifiers, and limits the serialized envelope to 1 MiB. Tracked observation versions use a separate contract.

The original event is copied without adding execution metadata to it. Its canonical payload hash remains unchanged. A second binding hash covers that payload hash and the delivery context, so replaying the same event under another context produces a different binding.

This context is a producer claim. The Backend must authenticate the worker and match the context against issued camera configuration, generation and acknowledgement before admission. This contract alone grants no access and publishes no safety alert.

The JSON schemas are in schemas/v1/worker-event-delivery-context.json and schemas/v1/worker-event-delivery-envelope.json. Focused behavior and schema checks are in test/worker-event-delivery.test.ts.
