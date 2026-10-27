// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import boot from './boot-catalogs.json';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

function initialTranslationKeys() {
  const visited = new Set<string>();
  const keys = new Set<string>();
  const dynamicCalls: string[] = [];
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const translators = new Set<string>();
    const imports: string[] = [];
    for (const node of source.statements) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'translate') {
        translators.add('translate');
      }
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      if (ts.isExportDeclaration(node) && node.isTypeOnly) continue;
      if (ts.isImportDeclaration(node)) {
        if (node.importClause?.isTypeOnly) continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          const values = bindings.elements.filter((binding) => !binding.isTypeOnly);
          if (!node.importClause?.name && values.length === 0) continue;
          for (const binding of values) {
            if ((binding.propertyName?.text ?? binding.name.text) === 'translate') {
              translators.add(binding.name.text);
            }
          }
        }
      }
      if (node.moduleSpecifier.text.startsWith('.')) imports.push(node.moduleSpecifier.text);
    }
    // A newly introduced hook alias must not silently bypass boot-resource coverage.
    function collectHookNames(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'useTranslation'
      ) {
        for (const binding of node.name.elements) {
          if (
            ts.isIdentifier(binding.name) &&
            (binding.propertyName?.getText(source) ?? binding.name.text) === 't'
          ) {
            translators.add(binding.name.text);
          }
        }
      }
      ts.forEachChild(node, collectHookNames);
    }
    collectHookNames(source);
    function finiteKeys(expression: ts.Expression): string[] | null {
      if (ts.isStringLiteralLike(expression)) return [expression.text];
      if (ts.isParenthesizedExpression(expression)) return finiteKeys(expression.expression);
      if (ts.isConditionalExpression(expression)) {
        const positive = finiteKeys(expression.whenTrue);
        const negative = finiteKeys(expression.whenFalse);
        return positive && negative ? [...positive, ...negative] : null;
      }
      return null;
    }
    function collectCalls(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (translators.has(node.expression.text)) {
          const key = node.arguments[0];
          const knownKeys = key ? finiteKeys(key) : null;
          if (knownKeys) knownKeys.forEach((value) => keys.add(value));
          else dynamicCalls.push(`${path.relative(sourceRoot, file)}: ${node.getText(source)}`);
        }
      }
      ts.forEachChild(node, collectCalls);
    }
    collectCalls(source);
    for (const name of imports) {
      const candidate = path.resolve(path.dirname(file), name);
      const dependency = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
        .map((suffix) => candidate + suffix)
        .find((target) => /\.(ts|tsx)$/.test(target) && existsSync(target));
      if (dependency) visit(dependency);
      else expect(name, `Unreviewed initial dependency from ${file}`).toMatch(/\.(css|json)$/);
    }
  }
  visit(path.join(sourceRoot, 'main.tsx'));
  return { keys: [...keys].sort(), dynamicCalls, visited };
}

it('keeps exact canonical EN/VI values for every initial-source translation and no full catalog', () => {
  const audit = initialTranslationKeys();
  expect(
    audit.dynamicCalls,
    'Review runtime key sets before adding a dynamic boot translation',
  ).toEqual([]);
  expect(audit.keys).toContain('app.documentTitle');
  expect(audit.keys).toContain('shell.signOut');
  expect(audit.visited.size).toBeGreaterThan(5);
  for (const language of ['en', 'vi'] as const) {
    const canonical = JSON.parse(
      readFileSync(new URL(`./locales/${language}.json`, import.meta.url), 'utf8'),
    ) as Record<string, string>;
    expect(Object.keys(boot[language]).sort()).toEqual(audit.keys);
    for (const key of audit.keys) {
      expect(canonical[key], key).toBeTypeOf('string');
      expect((boot[language] as Record<string, string>)[key], `${language}:${key}`).toBe(
        canonical[key],
      );
    }
    expect(Object.keys(boot[language]).length).toBeLessThan(Object.keys(canonical).length);
  }
});
