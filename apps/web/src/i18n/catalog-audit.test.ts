import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import en from './locales/en.json';
import { SITE_GATES } from '@smartsite/contracts/gates';

// Inspect static paired safety catalogs without importing UI modules or starting their hooks.
function safetyCatalogKeys(root: string): Set<string> {
  const keys = new Set<string>();
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
      const variables = new Map<string, ts.Expression>();
      function collect(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
          variables.set(node.name.text, node.initializer);
        ts.forEachChild(node, collect);
      }
      collect(source);
      function object(node: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
        if (!node) return;
        if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
          return object(node.expression);
        if (ts.isIdentifier(node)) return object(variables.get(node.text));
        return ts.isObjectLiteralExpression(node) ? node : undefined;
      }
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === 'registerFeatureCatalog'
        ) {
          const pair = object(node.arguments[0]);
          expect(pair, filename).toBeDefined();
          const languages = new Map<string, string[]>();
          for (const prop of pair?.properties ?? []) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const language = prop.name.getText(source).replace(/['"]/g, '');
            const entries = object(prop.initializer);
            expect(entries, filename).toBeDefined();
            languages.set(
              language,
              (entries?.properties ?? []).map((item) => {
                expect(
                  ts.isPropertyAssignment(item) && ts.isStringLiteral(item.initializer),
                  filename,
                ).toBe(true);
                return item.name!.getText(source).replace(/['"]/g, '');
              }),
            );
          }
          expect(languages.get('vi')?.slice().sort(), filename).toEqual(
            languages.get('en')?.slice().sort(),
          );
          for (const key of languages.get('en') ?? []) keys.add(key);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan(root);
  return keys;
}

it('includes the shared gate catalog in the UI translations', () => {
  for (const gate of SITE_GATES) expect(`gates.${gate.id}` in en, gate.id).toBe(true);
});

it('includes every access tab in the catalog, including keys composed at runtime', () => {
  const filename = path.resolve('src/components/access/AccessControlView.tsx');
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const tabs = source.statements.find(
    (node): node is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(node) && node.name.text === 'AccessSubTab',
  );
  expect(tabs && ts.isUnionTypeNode(tabs.type)).toBe(true);
  if (!tabs || !ts.isUnionTypeNode(tabs.type)) return;
  for (const type of tabs.type.types) {
    if (!ts.isLiteralTypeNode(type) || !ts.isStringLiteral(type.literal)) continue;
    for (const field of ['code', 'label', 'subLabel', 'description'])
      expect(
        `access.tabs.${type.literal.text}.${field}` in en,
        `${type.literal.text}.${field}`,
      ).toBe(true);
  }
});

it('scans every production UI source for missing keys and untranslated visible literals', () => {
  const root = path.resolve('src');
  const safetyKeys = safetyCatalogKeys(path.join(root, 'components'));
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
    'subtitle',
    'searchPlaceholder',
    'zoneName',
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
      const usesSafetyNamespace =
        /useTranslation\(SAFETY_NAMESPACE\)|useFourSourceWallTranslate\(\)/.test(source.text);
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
            'authorization',
            'reasonCode',
            'outcome',
            'technicalOutcome',
            'assignmentStatus',
            'hoursStatus',
            'presence',
          ].includes(node.name.text)
        ) {
          report(node, `unlocalized enum ${node.getText(source)}`);
        } else if (
          ts.isPropertyAccessExpression(node) &&
          node.name.text === 'message' &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'error'
        ) {
          report(node, `unlocalized error ${node.getText(source)}`);
        } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          if (/[A-Za-zÀ-ỹ]{2}/.test(node.text) && !brands.has(node.text))
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
      function checkTranslationKey(node: ts.Expression, safety: boolean): void {
        if (ts.isStringLiteral(node)) {
          const available = safety
            ? safetyKeys.has(node.text)
            : node.text in en || `${node.text}_other` in en;
          if (!available) report(node, `missing key ${node.text}`);
        } else if (ts.isConditionalExpression(node)) {
          checkTranslationKey(node.whenTrue, safety);
          checkTranslationKey(node.whenFalse, safety);
        }
      }
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ['tr', 't', 'translate'].includes(node.expression.getText(source)) &&
          node.arguments[0]
        ) {
          checkTranslationKey(
            node.arguments[0],
            usesSafetyNamespace && node.expression.getText(source) === 't',
          );
        }
        if (ts.isJsxText(node)) {
          const text = node.text.trim();
          if (/[A-Za-zÀ-ỹ]{2}/.test(text) && !brands.has(text))
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
