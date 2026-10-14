import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import en from './locales/en.json';

it('scans every production UI source for missing keys and untranslated visible literals', () => {
  const root = path.resolve('src');
  const failures: string[] = [];
  const brands = new Set(['Smart', 'Site', 'SmartSite', 'S', 'QR', 'MF01', 'MF05', 'IoT']);
  const attrs = new Set([
    'title',
    'placeholder',
    'aria-label',
    'aria-description',
    'alt',
    'label',
    'description',
    'helperText',
    'emptyMessage',
  ]);
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(filename);
        continue;
      }
      if (!/\.tsx?$/.test(filename) || filename.includes('.test.')) continue;
      const source = ts.createSourceFile(
        filename,
        readFileSync(filename, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const report = (node: ts.Node, text: string) =>
        failures.push(
          `${path.relative(root, filename)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${text}`,
        );
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ['tr', 'translate'].includes(node.expression.getText(source)) &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const key = node.arguments[0].text;
          if (!(key in en) && !(`${key}_other` in en)) report(node, `missing key ${key}`);
        }
        if (ts.isJsxText(node)) {
          const text = node.text.trim();
          if (/[A-Za-zÀ-ỹ]{2}/.test(text) && !brands.has(text))
            report(node, `visible literal ${text}`);
        }
        if (
          ts.isJsxAttribute(node) &&
          attrs.has(node.name.getText(source)) &&
          node.initializer &&
          ts.isStringLiteral(node.initializer)
        ) {
          const text = node.initializer.text;
          // Model IDs, camera/site codes and punctuation are data, not localized prose.
          if (/[A-Za-zÀ-ỹ]{2}/.test(text) && !brands.has(text) && !/^[A-Z\d_-]+$/.test(text))
            report(node, `visible attribute ${text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan(root);
  expect(failures).toEqual([]);
});
