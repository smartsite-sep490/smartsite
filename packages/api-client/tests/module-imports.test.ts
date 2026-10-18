import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('loads the public client without circular runtime imports in Metro', () => {
  const visited = new Set<string>();
  const visit = (file: string, ancestors: string[]) => {
    if (ancestors.includes(file)) {
      throw new Error(`Circular runtime import: ${[...ancestors, file].join(' -> ')}`);
    }
    if (visited.has(file)) return;
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    for (const { fileName } of ts.preProcessFile(outputText).importedFiles) {
      if (fileName.startsWith('.')) {
        visit(resolve(dirname(file), `${fileName}.ts`), [...ancestors, file]);
      }
    }
    visited.add(file);
  };

  expect(() => visit(fileURLToPath(new URL('../src/index.ts', import.meta.url)), [])).not.toThrow();
});
