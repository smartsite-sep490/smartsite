import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { command } from '../src/common/configuration/commands.js';
import { AssignContractorTeamDto } from '../src/modules/workforce/dto/contractor-team.dto.js';

test('initial team assignment accepts no reason; existing membership changes require one', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const initial = { requestId: randomUUID(), expectedMembershipId: null, teamId: randomUUID() };
  for (const input of [initial, { ...initial, reason: '' }, { ...initial, reason: '  ' }]) {
    const validated = await pipe.transform(input, {
      type: 'body',
      metatype: AssignContractorTeamDto,
    });
    assert.equal(command(AssignContractorTeamDto, validated).reason ?? '', '');
  }
  for (const teamId of [randomUUID(), null]) {
    const change = { ...initial, teamId, expectedMembershipId: randomUUID() };
    for (const reason of [undefined, '', '   ', 'four', null, 42]) {
      await assert.rejects(
        pipe.transform(
          { ...change, reason },
          {
            type: 'body',
            metatype: AssignContractorTeamDto,
          },
        ),
      );
    }
    assert.equal(
      command(AssignContractorTeamDto, { ...change, reason: 'Valid reason' }).reason,
      'Valid reason',
    );
  }
  for (const reason of [null, 42, 'four', 'x'.repeat(1001)]) {
    assert.throws(() => command(AssignContractorTeamDto, { ...initial, reason }));
  }
});
