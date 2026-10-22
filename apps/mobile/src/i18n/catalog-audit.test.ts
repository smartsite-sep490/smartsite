import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import en from './locales/en.json';

it('keeps mobile UI copy and static translation keys in the catalogs', () => {
  const failures: string[] = [];
  const root = path.resolve('src');
  const intentional = new Set([
    'Smart',
    'Site',
    'SmartSite',
    'SmartSite v0.1.0 · 2026',
    'VI',
    'EN',
    'English',
    'Tiếng Việt',
    '(YYYY-MM-DD)',
    'YYYY-MM-DD',
  ]);
  const attributes = new Set([
    'label',
    'title',
    'placeholder',
    'accessibilityLabel',
    'description',
    'helperText',
  ]);
  const readable = (text: string) => /[A-Za-zÀ-ỹ]{2}/.test(text) && !intentional.has(text);
  function scan(dir: string) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const filename = path.join(dir, item.name);
      if (item.isDirectory()) {
        scan(filename);
        continue;
      }
      if (
        !/\.tsx?$/.test(filename) ||
        filename.includes('.test.') ||
        filename.includes('test-setup')
      )
        continue;
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
      function visible(node: ts.Expression): void {
        if (
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          readable(node.text)
        )
          report(node, `untranslated ${node.text}`);
        else if (ts.isConditionalExpression(node)) {
          visible(node.whenTrue);
          visible(node.whenFalse);
        } else if (
          ts.isPropertyAccessExpression(node) &&
          ['status', 'severity', 'alertType', 'direction', 'effect'].includes(node.name.text)
        )
          report(node, `untranslated enum ${node.getText(source)}`);
        else if (
          ts.isBinaryExpression(node) &&
          [
            ts.SyntaxKind.QuestionQuestionToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.AmpersandAmpersandToken,
          ].includes(node.operatorToken.kind)
        )
          visible(node.right);
      }
      function checkKey(node: ts.Expression): void {
        if (ts.isStringLiteral(node)) {
          const [section, key] = node.text.split('.');
          const entries = (en as Record<string, Record<string, string>>)[section!];
          if (!entries || (!entries[key!] && !entries[`${key}_other`]))
            report(node, `missing key ${node.text}`);
        } else if (ts.isConditionalExpression(node)) {
          checkKey(node.whenTrue);
          checkKey(node.whenFalse);
        }
      }
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ['t', 'tr', 'translate'].includes(node.expression.getText(source)) &&
          node.arguments[0]
        )
          checkKey(node.arguments[0]);
        if (ts.isJsxText(node) && readable(node.text.trim()))
          report(node, `untranslated ${node.text.trim()}`);
        if (
          ts.isJsxAttribute(node) &&
          attributes.has(node.name.getText(source)) &&
          node.initializer
        ) {
          if (ts.isStringLiteral(node.initializer) && readable(node.initializer.text))
            report(node, `untranslated ${node.initializer.text}`);
          else if (ts.isJsxExpression(node.initializer) && node.initializer.expression)
            visible(node.initializer.expression);
        }
        if (
          ts.isJsxExpression(node) &&
          node.expression &&
          (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
        )
          visible(node.expression);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan(root);
  expect(failures).toEqual([]);
});
