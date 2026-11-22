import type { SourceActivationResult, SourcePreparationResult } from '@smartsite/contracts';

export type SourceActivationState = SourcePreparationResult | SourceActivationResult;
export interface SourceGeneration {
  workerGenerationId: string;
  streamSessionId: string;
  secret: string;
  expiresAt: string;
}
export interface SourceActivationCommand {
  commandId: string;
  receiptId: string;
  expectedRevision: number;
}
export interface SourceActivationPorts {
  authorize(): Promise<void>;
  prepare(command: SourceActivationCommand): Promise<SourceActivationState>;
  issue(expectedGenerationId: string | null, commandId: string): Promise<SourceGeneration>;
  commit(commandId: string, generation: SourceGeneration): Promise<SourceActivationState>;
}

/** Remote process work is never performed inside the generation transaction. */
export async function activateTestedCameraSource(
  command: SourceActivationCommand,
  ports: SourceActivationPorts,
): Promise<SourceActivationResult> {
  await ports.authorize();
  const prepared = await ports.prepare(command);
  if (prepared.commandId !== command.commandId || prepared.sourceKind !== 'LIVE')
    throw new Error('Source activation scope changed');
  if (
    prepared.currentGenerationId === null &&
    (prepared.state !== 'PREPARED' ||
      prepared.schemaVersion !== '1.1.0' ||
      prepared.sourceRevision !== 0 ||
      command.expectedRevision !== 0)
  )
    throw new Error('Unowned source preparation scope changed');
  if (prepared.state === 'RUNNING') {
    if (prepared.sourceRevision !== command.expectedRevision + 1)
      throw new Error('Source revision changed');
    await ports.authorize();
    return prepared;
  }
  if (prepared.sourceRevision !== command.expectedRevision)
    throw new Error('Source revision changed');
  await ports.authorize();
  const generation = await ports.issue(prepared.currentGenerationId, command.commandId);
  // Issuance may outlive the caller's authority; do not start its child after revocation.
  await ports.authorize();
  const running = await ports.commit(command.commandId, generation);
  if (
    running.state !== 'RUNNING' ||
    running.commandId !== command.commandId ||
    running.sourceKind !== 'LIVE' ||
    running.sourceRevision !== command.expectedRevision + 1 ||
    running.currentGenerationId !== generation.workerGenerationId
  )
    throw new Error('Source activation was not confirmed');
  await ports.authorize();
  return running;
}
