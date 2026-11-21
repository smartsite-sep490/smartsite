import type { SourceConfigurationResumeCommand } from '@smartsite/contracts';
import type { SourceActivationState, SourceGeneration } from './camera-source-activation.js';

export interface SourceConfigurationResumePorts {
  authorize(): Promise<void>;
  prepare(): Promise<SourceActivationState>;
  issue(expectedOwner: string, commandId: string): Promise<SourceGeneration>;
  commit(commandId: string, generation: SourceGeneration): Promise<SourceActivationState>;
}

/** Source revision and confirmed view survive a configuration-only transition. */
export async function resumeAcceptedCameraSource(
  command: SourceConfigurationResumeCommand,
  expectedOwner: string,
  ports: SourceConfigurationResumePorts,
): Promise<SourceActivationState> {
  command = { ...command };
  await ports.authorize();
  const prepared = await ports.prepare();
  if (
    prepared.commandId !== command.commandId ||
    prepared.sourceKind !== 'LIVE' ||
    prepared.sourceRevision !== command.expectedRevision ||
    prepared.currentGenerationId !== expectedOwner
  )
    throw Error('Configuration resume scope changed');
  await ports.authorize();
  if (prepared.state === 'RUNNING') return prepared;
  const generation = await ports.issue(expectedOwner, command.commandId);
  // A revoked caller cannot start a freshly issued owner after the long prepare.
  await ports.authorize();
  const running = await ports.commit(command.commandId, generation);
  if (
    running.commandId !== command.commandId ||
    running.state !== 'RUNNING' ||
    running.sourceKind !== 'LIVE' ||
    running.sourceRevision !== command.expectedRevision ||
    running.currentGenerationId !== generation.workerGenerationId
  )
    throw Error('Configuration resume was not confirmed');
  return running;
}
