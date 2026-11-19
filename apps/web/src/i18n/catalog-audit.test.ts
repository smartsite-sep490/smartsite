import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import en from './locales/en.json';
import { hasRegisteredFeatureKey, registerFeatureCatalog } from './feature-catalog-registry';

function readStringMap(
  node: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
): Record<string, string> | null {
  let expr = node;
  while (
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isParenthesizedExpression(expr)
  ) {
    expr = expr.expression;
  }
  if (ts.isIdentifier(expr)) {
    const bound = bindings.get(expr.text);
    return bound ? readStringMap(bound, bindings) : null;
  }
  if (!ts.isObjectLiteralExpression(expr)) return null;
  const out: Record<string, string> = {};
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) return null;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    let val = prop.initializer;
    while (ts.isAsExpression(val) || ts.isParenthesizedExpression(val)) val = val.expression;
    if (key === null || (!ts.isStringLiteral(val) && !ts.isNoSubstitutionTemplateLiteral(val))) {
      return null;
    }
    out[key] = val.text;
  }
  return out;
}

function registerStaticCatalogFromAst(filename: string, raw: string): boolean {
  const sf = ts.createSourceFile(filename, raw, ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, ts.Expression>();
  const catalogCallees = new Set<string>(['registerFeatureCatalog']);
  function collectBindings(node: ts.Node) {
    if (ts.isImportSpecifier(node)) {
      const imported = (node.propertyName ?? node.name).text;
      if (imported === 'registerFeatureCatalog') {
        catalogCallees.add(node.name.text);
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectBindings);
  }
  collectBindings(sf);

  let totalCalls = 0;
  let hasUnresolved = false;
  const resolvedBatch: Array<{ en: Record<string, string>; vi: Record<string, string> }> = [];

  function isCatalogCallee(expr: ts.Expression): boolean {
    return (
      (ts.isIdentifier(expr) && catalogCallees.has(expr.text)) ||
      (ts.isPropertyAccessExpression(expr) && expr.name.text === 'registerFeatureCatalog')
    );
  }

  function findCalls(node: ts.Node) {
    if (
      ts.isIdentifier(node) &&
      catalogCallees.has(node.text) &&
      !ts.isImportSpecifier(node.parent) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      hasUnresolved = true;
    }
    if (ts.isCallExpression(node) && isCatalogCallee(node.expression)) {
      totalCalls += 1;
      if (node.arguments.length !== 1 || ts.isSpreadElement(node.arguments[0]!)) {
        hasUnresolved = true;
      } else {
        let arg: ts.Expression | undefined = node.arguments[0];
        if (arg && ts.isIdentifier(arg)) arg = bindings.get(arg.text);
        while (
          arg &&
          (ts.isAsExpression(arg) ||
            ts.isSatisfiesExpression(arg) ||
            ts.isParenthesizedExpression(arg))
        ) {
          arg = arg.expression;
        }
        if (!arg || !ts.isObjectLiteralExpression(arg) || arg.properties.length !== 2) {
          hasUnresolved = true;
        } else {
          let enExpr: ts.Expression | undefined;
          let viExpr: ts.Expression | undefined;
          for (const prop of arg.properties) {
            const propName =
              prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
                ? prop.name.text
                : null;
            if (ts.isShorthandPropertyAssignment(prop)) {
              if (propName === 'en') enExpr = bindings.get('en');
              else if (propName === 'vi') viExpr = bindings.get('vi');
            } else if (ts.isPropertyAssignment(prop)) {
              if (propName === 'en') enExpr = prop.initializer;
              else if (propName === 'vi') viExpr = prop.initializer;
            }
          }
          const enMap = enExpr ? readStringMap(enExpr, bindings) : null;
          const viMap = viExpr ? readStringMap(viExpr, bindings) : null;
          const enKeys = enMap ? Object.keys(enMap) : [];
          const viKeys = viMap ? Object.keys(viMap) : [];
          if (
            !enMap ||
            !viMap ||
            enKeys.length !== viKeys.length ||
            enKeys.some((k) => !k || !Object.hasOwn(viMap, k))
          ) {
            hasUnresolved = true;
          } else {
            resolvedBatch.push({ en: enMap, vi: viMap });
          }
        }
      }
    }
    ts.forEachChild(node, findCalls);
  }
  findCalls(sf);

  if (hasUnresolved || totalCalls === 0 || resolvedBatch.length !== totalCalls) {
    return false;
  }
  for (const pair of resolvedBatch) {
    registerFeatureCatalog(pair);
  }
  return true;
}

it('includes Gate management labels while Gate names come from Backend', () => {
  for (const key of [
    'gateSetup.title',
    'gateSetup.empty',
    'gateSetup.source',
    'gateSetup.noSources',
  ])
    expect(key in en).toBe(true);
});

it('falls back to the dynamic loader unless all registerFeatureCatalog calls in a module resolve statically', async () => {
  const mixedModuleSource = `
    import { registerFeatureCatalog } from './feature-catalog-registry';

    registerFeatureCatalog({
      en: { '__auditTest.mixed.static': 'Static label' },
      vi: { '__auditTest.mixed.static': 'Nhãn tĩnh' },
    });

    function buildComputedCatalog() {
      const key = ['__auditTest', 'mixed', 'dynamic'].join('.');
      return {
        en: { [key]: 'Dynamic label' },
        vi: { [key]: 'Nhãn động' },
      };
    }

    export function registerMixedTestCatalog(): void {
      registerFeatureCatalog(buildComputedCatalog());
    }
  `;

  let dynamicLoaderCalled = false;
  if (!registerStaticCatalogFromAst('mixed-catalog-fixture.ts', mixedModuleSource)) {
    expect(hasRegisteredFeatureKey('__auditTest.mixed.static')).toBe(false);
    dynamicLoaderCalled = true;
    registerFeatureCatalog({
      en: { '__auditTest.mixed.static': 'Static label' },
      vi: { '__auditTest.mixed.static': 'Nhãn tĩnh' },
    });
    registerFeatureCatalog({
      en: { '__auditTest.mixed.dynamic': 'Dynamic label' },
      vi: { '__auditTest.mixed.dynamic': 'Nhãn động' },
    });
  }

  expect(dynamicLoaderCalled).toBe(true);
  expect(hasRegisteredFeatureKey('__auditTest.mixed.static')).toBe(true);
  expect(hasRegisteredFeatureKey('__auditTest.mixed.dynamic')).toBe(true);

  const dualStaticModuleSource = `
    import { registerFeatureCatalog } from './feature-catalog-registry';
    registerFeatureCatalog({
      en: { '__auditTest.dual.first': 'First' },
      vi: { '__auditTest.dual.first': 'Thứ nhất' },
    });
    registerFeatureCatalog({
      en: { '__auditTest.dual.second': 'Second' },
      vi: { '__auditTest.dual.second': 'Thứ hai' },
    });
  `;
  expect(registerStaticCatalogFromAst('dual-static-fixture.ts', dualStaticModuleSource)).toBe(true);
  expect(hasRegisteredFeatureKey('__auditTest.dual.first')).toBe(true);
  expect(hasRegisteredFeatureKey('__auditTest.dual.second')).toBe(true);
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

it('scans every production UI source for missing keys and untranslated visible literals', async () => {
  const root = path.resolve('src');
  const failures: string[] = [];
  const catalogModules: string[] = [];
  function collectCatalogModules(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectCatalogModules(filename);
        continue;
      }
      if (!/\.tsx?$/.test(filename) || filename.includes('.test.')) continue;
      if (filename === path.join(root, 'i18n', 'feature-catalog-registry.ts')) continue;
      const content = readFileSync(filename, 'utf8');
      if (content.includes('registerFeatureCatalog(')) {
        if (!registerStaticCatalogFromAst(filename, content)) {
          catalogModules.push(filename);
        }
      }
    }
  }
  collectCatalogModules(root);
  await Promise.all(
    catalogModules.map(async (mod) => {
      const loaded = (await import(pathToFileURL(mod).href)) as Record<string, unknown>;
      for (const [exportName, exportedValue] of Object.entries(loaded)) {
        if (
          exportName.startsWith('register') &&
          typeof exportedValue === 'function' &&
          exportedValue.length === 0
        ) {
          (exportedValue as () => void)();
        }
      }
    }),
  );
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
      const rawContent = readFileSync(filename, 'utf8');
      const usesSafetyNamespace =
        /\bSAFETY_NAMESPACE\b/.test(rawContent) ||
        (!/\buseTranslation\s*\(\s*\)/.test(rawContent) &&
          !/\bimport\s*\{[^}]*\btranslate\b[^}]*\}\s*from\b/.test(rawContent));
      const source = ts.createSourceFile(filename, rawContent, ts.ScriptTarget.Latest, true);
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
      function checkTranslationKey(node: ts.Expression): void {
        if (ts.isStringLiteral(node)) {
          const inCommon = node.text in en || `${node.text}_other` in en;
          const inSafetyCatalog =
            usesSafetyNamespace &&
            (hasRegisteredFeatureKey(node.text) || hasRegisteredFeatureKey(`${node.text}_other`));
          if (!inCommon && !inSafetyCatalog) report(node, `missing key ${node.text}`);
        } else if (ts.isConditionalExpression(node)) {
          checkTranslationKey(node.whenTrue);
          checkTranslationKey(node.whenFalse);
        }
      }
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ['tr', 't', 'translate'].includes(node.expression.getText(source)) &&
          node.arguments[0]
        ) {
          checkTranslationKey(node.arguments[0]);
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
}, 15_000);
