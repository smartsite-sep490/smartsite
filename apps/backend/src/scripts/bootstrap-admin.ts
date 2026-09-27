import 'reflect-metadata';
import * as readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import dataSource from '../database/typeorm.data-source.js';
import { UsersService } from '../modules/users/users.service.js';

function hiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode)
    throw new Error('Admin bootstrap requires an interactive terminal');
  process.stdout.write('Temporary password: ');
  readline.emitKeypressEvents(process.stdin);
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (character: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.name === 'return' || key.name === 'enter') {
        finish();
        resolve(value);
      } else if (key.ctrl && key.name === 'c') {
        finish();
        reject(new Error('Admin bootstrap cancelled'));
      } else if (key.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (character && !key.ctrl && character >= ' ') {
        value += character;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKey);
  });
}

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const users = new UsersService(dataSource);
    if ((await users.list(0, 1)).total !== 0)
      throw new Error('Initial Admin already exists; bootstrap cannot overwrite accounts');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    let username: string;
    let displayName: string;
    try {
      username = await prompt.question('Admin username: ');
      displayName = await prompt.question('Display name: ');
    } finally {
      prompt.close();
    }
    const password = await hiddenPassword();
    const user = await users.bootstrap(username, displayName, password);
    process.stdout.write(`Initial Admin created: ${user.username}\n`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  // Startup failures may contain a connection URL; never print the raw driver error.
  const reason =
    error instanceof Error && error.message.startsWith('Initial Admin already exists')
      ? 'Initial Admin already exists; bootstrap cannot overwrite accounts'
      : 'Admin bootstrap failed; verify migrations, database access and input';
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
});
