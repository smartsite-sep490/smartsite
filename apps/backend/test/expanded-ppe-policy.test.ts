import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from 'class-validator';
import { ZoneRestrictionPolicy, ZoneType } from '../src/database/entities/enums.js';
import {
  CreateZoneCommand,
  UpdateZonePolicyCommand,
} from '../src/modules/zones/zone-configuration.service.js';

for (const commandType of [CreateZoneCommand, UpdateZonePolicyCommand]) {
  test(`${commandType.name} accepts explicit expanded policy and rejects unsupported items`, async () => {
    const command = Object.assign(new commandType(), {
      code: 'ZONE-1',
      name: 'Configured zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'],
    });
    assert.equal((await validate(command)).length, 0);
    command.requiredPpe = ['HARNESS'];
    assert.ok((await validate(command)).some((error) => error.property === 'requiredPpe'));
    command.requiredPpe = ['GLOVES', 'GLOVES'];
    assert.ok((await validate(command)).some((error) => error.property === 'requiredPpe'));
  });
}
