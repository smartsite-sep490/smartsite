import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import en from './locales/en.json';

function staticCatalogKeys(relativePath: string, declaration: string): Set<string> {
  const source = ts.createSourceFile(
    relativePath,
    readFileSync(path.resolve('src/i18n', relativePath), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const keys = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === declaration) {
      let value = node.initializer;
      while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) {
        value = value.expression;
      }
      if (value && ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
          if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.name)) {
            keys.add(property.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (keys.size === 0) throw new Error(`Missing static catalog ${declaration}`);
  return keys;
}

const catalogs: Record<string, Set<string>> = {
  common: new Set(Object.keys(en)),
  safety: new Set([
    ...staticCatalogKeys('locale-context.ts', 'EN_CATALOG'),
    ...staticCatalogKeys('ppe-catalog.ts', 'PPE_EN_CATALOG'),
    ...staticCatalogKeys('../components/cameras/camera-setup-catalog.ts', 'en'),
  ]),
};

function hasKey(namespace: string, key: string): boolean {
  return Boolean(catalogs[namespace]?.has(key) || catalogs[namespace]?.has(`${key}_other`));
}

function callNamespace(call: ts.CallExpression): string {
  const options = call.arguments[1];
  if (!options) return 'common';
  if (!ts.isObjectLiteralExpression(options)) return 'unknown';
  let namespace = 'common';
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) {
      namespace = 'unknown';
      continue;
    }
    const name = ts.isStringLiteralLike(property.name)
      ? property.name.text
      : property.name.getText();
    if (name !== 'ns') continue;
    if (!ts.isPropertyAssignment(property)) {
      namespace = 'unknown';
      continue;
    }
    namespace = ts.isStringLiteralLike(property.initializer)
      ? property.initializer.text
      : property.initializer.getText() === 'SAFETY_NAMESPACE'
        ? 'safety'
        : 'unknown';
  }
  return namespace;
}

it('audits the requested namespace without accepting keys from unrelated catalogs', () => {
  expect(hasKey('safety', 'safety.evidence.frameCaptionBase')).toBe(true);
  expect(hasKey('common', 'safety.evidence.frameCaptionBase')).toBe(false);
  expect(hasKey('safety', 'safety.evidence.notRegistered')).toBe(false);
  expect(hasKey('unknown', 'common.retry')).toBe(false);
});

it('audits the registered camera setup catalog in its Safety namespace', () => {
  expect(hasKey('safety', 'cameraSetup.title')).toBe(true);
  expect(hasKey('safety', 'cameraSetup.linkedSelection')).toBe(true);
  expect(hasKey('common', 'cameraSetup.title')).toBe(false);
  expect(hasKey('safety', 'cameraSetup.notRegistered')).toBe(false);
});

it.each([
  ["tr('common.retry')", 'common'],
  ["tr('safety.evidence.frameCaptionBase', { ns: SAFETY_NAMESPACE })", 'safety'],
  ["tr('safety.evidence.frameCaptionBase', { 'ns': 'safety' })", 'safety'],
  ["tr('safety.evidence.frameCaptionBase', { ns: SAFETY_NAMESPACE, ...options })", 'unknown'],
  ["tr('common.retry', options)", 'unknown'],
  ["tr('common.retry', { ns: SAFETY_NAMESPACE, ns: 'common' })", 'common'],
  ["tr('safety.evidence.frameCaptionBase', { ...options, ns: 'safety' })", 'safety'],
  ["tr('common.retry', { count: 3 })", 'common'],
  ["tr('common.retry', { [fieldName]: value })", 'unknown'],
])('resolves effective namespace conservatively for %s', (code, expected) => {
  const source = ts.createSourceFile('fixture.ts', code, ts.ScriptTarget.Latest, true);
  const statement = source.statements[0];
  if (
    !statement ||
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression)
  ) {
    throw new Error('Expected translation call fixture');
  }
  expect(callNamespace(statement.expression)).toBe(expected);
});

it('scans every production UI source for missing keys and untranslated visible literals', () => {
  const root = path.resolve('src');
  const failures: string[] = [];
  // Language names are intentionally shown in their own language in the selector.
  const brands = new Set([
    'Smart',
    'Site',
    'SmartSite',
    'S',
    'QR',
    'MF01',
    'MF05',
    'IoT',
    'Esc',
    'English',
    'Tiếng Việt',
  ]);
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
      function checkVisibleExpression(node: ts.Expression): void {
        if (
          ts.isPropertyAccessExpression(node) &&
          [
            'status',
            'kind',
            'method',
            'direction',
            'role',
            'severity',
            'effect',
            'restrictionPolicy',
          ].includes(node.name.text)
        ) {
          report(node, `unlocalized enum ${node.getText(source)}`);
        } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          if (
            /[A-Za-zÀ-ỹ]{2}/.test(node.text) &&
            !brands.has(node.text) &&
            !/^MF\d{2}(\s*\/\s*MF\d{2})*$/.test(node.text)
          )
            report(node, `visible expression literal ${node.text}`);
        } else if (ts.isConditionalExpression(node)) {
          checkVisibleExpression(node.whenTrue);
          checkVisibleExpression(node.whenFalse);
        } else if (
          ts.isBinaryExpression(node) &&
          [
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
            ts.SyntaxKind.AmpersandAmpersandToken,
          ].includes(node.operatorToken.kind)
        ) {
          checkVisibleExpression(node.right);
        } else if (ts.isParenthesizedExpression(node)) {
          checkVisibleExpression(node.expression);
        }
      }
      function checkTranslationKey(namespace: string, node: ts.Expression): void {
        if (ts.isStringLiteral(node)) {
          if (!hasKey(namespace, node.text)) report(node, `missing key ${node.text}`);
        } else if (ts.isConditionalExpression(node)) {
          checkTranslationKey(namespace, node.whenTrue);
          checkTranslationKey(namespace, node.whenFalse);
        }
      }
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ['tr', 'translate'].includes(node.expression.getText(source)) &&
          node.arguments[0]
        ) {
          checkTranslationKey(callNamespace(node), node.arguments[0]);
        }
        if (ts.isJsxText(node)) {
          const text = node.text.trim();
          if (
            /[A-Za-zÀ-ỹ]{2}/.test(text) &&
            !brands.has(text) &&
            !/^MF\d{2}(\s*\/\s*MF\d{2})*$/.test(text)
          )
            report(node, `visible literal ${text}`);
        }
        if (
          ts.isJsxExpression(node) &&
          node.expression &&
          (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
        ) {
          checkVisibleExpression(node.expression);
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
        if (
          ts.isJsxAttribute(node) &&
          attrs.has(node.name.getText(source)) &&
          node.initializer &&
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression
        ) {
          checkVisibleExpression(node.initializer.expression);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan(root);
  expect(failures).toEqual([]);
});
