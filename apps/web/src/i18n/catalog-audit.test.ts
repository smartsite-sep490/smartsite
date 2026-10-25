import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import en from './locales/en.json';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';

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
    ...staticCatalogKeys('mf06-evidence-catalog.ts', 'MF06_EVIDENCE_EN_CATALOG'),
    ...staticCatalogKeys('../components/cameras/camera-setup-catalog.ts', 'en'),
    ...staticCatalogKeys('../components/cameras/CameraSetupContextPanel.tsx', 'en'),
    ...staticCatalogKeys('../components/safety/safetyTaskTourModel.ts', 'en'),
  ]),
};

function hasKey(namespace: string, key: string): boolean {
  return Boolean(catalogs[namespace]?.has(key) || catalogs[namespace]?.has(`${key}_other`));
}

const checkers = new WeakMap<ts.SourceFile, ts.TypeChecker>();
function sourceChecker(source: ts.SourceFile): ts.TypeChecker {
  const cached = checkers.get(source);
  if (cached) return cached;
  // Bind each file once without resolving imports, reading dependencies or loading libraries.
  const options = { noResolve: true, noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (filename) =>
    filename.replaceAll('\\', '/') === source.fileName.replaceAll('\\', '/') ? source : undefined;
  const checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
  checkers.set(source, checker);
  return checker;
}

function imported(node: ts.Node) {
  const checker = sourceChecker(node.getSourceFile());
  const symbol = ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  const declaration = symbol?.declarations?.[0];
  if (!declaration || !ts.isImportSpecifier(declaration)) return;
  const module = declaration.parent.parent.parent.moduleSpecifier;
  if (!ts.isStringLiteral(module)) return;
  return {
    name: declaration.propertyName?.text ?? declaration.name.text,
    module: module.text,
    typeOnly: declaration.isTypeOnly || declaration.parent.parent.isTypeOnly,
  };
}

function literalNamespace(node: ts.Expression): string {
  if (ts.isStringLiteralLike(node)) return node.text;
  const constant = imported(node);
  return constant?.name === 'SAFETY_NAMESPACE' &&
    !constant.typeOnly &&
    /(?:^|\/)i18n(?:\/index|\/runtime)?$/.test(constant.module)
    ? 'safety'
    : 'unknown';
}

function boundHookNamespace(call: ts.CallExpression): string {
  const source = call.getSourceFile();
  const checker = sourceChecker(source);
  const safetyModule = (module: string) =>
    /(?:^|\/)(?:ppe-locale|locale-context|i18n)(?:\/index)?$/.test(module);
  const binding = checker.getSymbolAtLocation(call.expression)?.declarations?.[0];
  const utility = imported(call.expression);
  if (
    utility?.name === 'translate' &&
    !utility.typeOnly &&
    (/(?:^|\/)i18n(?:\/index|\/runtime)?$/.test(utility.module) ||
      (path.resolve(path.dirname(source.fileName)) === path.resolve('src/i18n') &&
        ['./index', './runtime'].includes(utility.module)))
  )
    return 'common';
  if (
    binding &&
    ts.isFunctionDeclaration(binding) &&
    binding.name?.text === 'translate' &&
    path.resolve(source.fileName) === path.resolve('src/i18n/runtime.ts')
  )
    return 'common';
  if (binding && ts.isParameter(binding)) {
    const keyType =
      binding.type && ts.isFunctionTypeNode(binding.type)
        ? binding.type.parameters[0]?.type
        : undefined;
    const key = keyType && ts.isTypeReferenceNode(keyType) && imported(keyType.typeName);
    return key && key.name === 'TranslationKey' && safetyModule(key.module) ? 'safety' : 'unknown';
  }
  if (
    !binding ||
    !ts.isBindingElement(binding) ||
    !ts.isObjectBindingPattern(binding.parent) ||
    binding.dotDotDotToken ||
    binding.initializer ||
    (binding.propertyName ?? binding.name).getText(source).replace(/^['"]|['"]$/g, '') !== 't'
  )
    return 'unknown';
  const declaration = binding.parent.parent;
  const initializer = ts.isVariableDeclaration(declaration) && declaration.initializer;
  if (!initializer || !ts.isCallExpression(initializer)) return 'unknown';
  const hook = imported(initializer.expression);
  if (!hook || hook.typeOnly) return 'unknown';
  if (hook.name === 'useLocale' && safetyModule(hook.module)) return 'safety';
  if (hook.name !== 'useTranslation' || hook.module !== 'react-i18next') return 'unknown';
  const namespace = initializer.arguments[0];
  if (!namespace) return 'common';
  return literalNamespace(namespace);
}

function callNamespace(call: ts.CallExpression): string {
  const defaultNamespace = boundHookNamespace(call);
  if (defaultNamespace === 'unknown') return 'unknown';
  const options = call.arguments[1];
  if (!options) return defaultNamespace;
  if (!ts.isObjectLiteralExpression(options)) return 'unknown';
  let namespace = defaultNamespace;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) {
      namespace = 'unknown';
      continue;
    }
    const name = ts.isStringLiteralLike(property.name)
      ? property.name.text
      : property.name.getText();
    if (name !== 'ns') continue;
    if (ts.isShorthandPropertyAssignment(property)) {
      namespace = literalNamespace(property.name);
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      namespace = 'unknown';
      continue;
    }
    namespace = literalNamespace(property.initializer);
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
  const source = ts.createSourceFile(
    'fixture.ts',
    `import {useTranslation} from 'react-i18next'; import {SAFETY_NAMESPACE} from './i18n'; const {t:tr}=useTranslation(); ${code}`,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = source.statements[3];
  if (
    !statement ||
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression)
  ) {
    throw new Error('Expected translation call fixture');
  }
  expect(callNamespace(statement.expression)).toBe(expected);
});

it.each([
  [
    "import {useLocale} from './ppe-locale'; function View(){const {t}=useLocale(); return t('ppe.header.title');}",
    'safety',
  ],
  [
    "import {useLocale as usePpeLocale} from './ppe-locale'; function View(){const {t}=usePpeLocale(); return t('ppe.header.title');}",
    'safety',
  ],
  [
    "import {useTranslation} from 'react-i18next'; function View(){const {t}=useTranslation('safety'); return t('ppe.header.title');}",
    'safety',
  ],
  [
    "import {useTranslation} from 'react-i18next'; function View(){const {t}=useTranslation(); return t('common.retry');}",
    'common',
  ],
  [
    "import {useLocale} from './ppe-locale'; function View(){const {t}=useLocale(); return ()=>t('ppe.header.title');}",
    'safety',
  ],
  [
    "import {useLocale} from './ppe-locale'; function View(){const {t}=useLocale(); return t('common.retry',{ns:'common'});}",
    'common',
  ],
  [
    "import {useLocale} from './ppe-locale'; function View(){const {t}=useLocale(); function Inner(t:unknown){return t('ppe.header.title');}}",
    'unknown',
  ],
  [
    "import {useLocale} from '../../i18n'; function View(){const {t}=useLocale(); return t('layout.skipToMain');}",
    'safety',
  ],
  [
    "import type {TranslationKey} from './ppe-locale'; function helper(t:(key:TranslationKey)=>string){return t('ppe.header.title');}",
    'safety',
  ],
  [
    "import type {TranslationKey} from './unrelated'; function helper(t:(key:TranslationKey)=>string){return t('ppe.header.title');}",
    'unknown',
  ],
  [
    "import {useLocale} from './ppe-locale'; function View(useLocale:()=>any){const {t}=useLocale(); return t('ppe.header.title');}",
    'unknown',
  ],
  [
    "import {useTranslation} from 'react-i18next'; function View(){const useTranslation=unknownHook; const {t}=useTranslation(); return t('common.retry');}",
    'unknown',
  ],
  [
    "import {useLocale} from './ppe-locale'; function View(){const {locale:t}=useLocale(); return t('ppe.header.title');}",
    'unknown',
  ],
  [
    "import {useLocale} from './ppe-locale'; function View(){const t=useLocale(); return t('ppe.header.title');}",
    'unknown',
  ],
  [
    "import {useLocale} from './ppe-locale'; function View(){const {...t}=useLocale(); return t('ppe.header.title');}",
    'unknown',
  ],
  ["function helper(t:unknown){return t('ppe.header.title',{ns:'safety'});}", 'unknown'],
  [
    "import {useLocale} from './ppe-locale'; function View(){const {t=unknownTranslator}=useLocale(); return t('ppe.header.title');}",
    'unknown',
  ],
  [
    "import type {TranslationKey} from './ppe-locale'; function helper(){type TranslationKey=string; return function(t:(key:TranslationKey)=>string){return t('ppe.header.title');}}",
    'unknown',
  ],
  ["import {translate as t} from './i18n'; t('common.retry');", 'common'],
  [
    "import {translate as t} from './i18n'; function helper(t:unknown){return t('common.retry',{ns:'common'});}",
    'unknown',
  ],
  [
    "import {useTranslation} from 'react-i18next'; import {SAFETY_NAMESPACE as ns} from './i18n'; function View(){const {t}=useTranslation(ns); return t('ppe.header.title');}",
    'safety',
  ],
  [
    "import {translate as t, SAFETY_NAMESPACE as ns} from './i18n'; t('ppe.header.title',{ns});",
    'safety',
  ],
  [
    "import {useTranslation} from 'react-i18next'; function View(){const SAFETY_NAMESPACE='common'; const {t}=useTranslation(SAFETY_NAMESPACE); return t('ppe.header.title');}",
    'unknown',
  ],
  [
    "import {useLocale} from './ppe-locale'; function View(){const SAFETY_NAMESPACE='common'; const {t}=useLocale(); return t('ppe.header.title',{ns:SAFETY_NAMESPACE});}",
    'unknown',
  ],
  [
    "import {useTranslation} from 'react-i18next'; function View(){const {t}=useTranslation(SAFETY_NAMESPACE); return t('ppe.header.title');}",
    'unknown',
  ],
  [
    "import {useTranslation} from 'react-i18next'; import {SAFETY_NAMESPACE} from './unrelated'; function View(){const {t}=useTranslation(SAFETY_NAMESPACE); return t('ppe.header.title');}",
    'unknown',
  ],
])('resolves the lexical translation hook for %s', (code, expected) => {
  const source = ts.createSourceFile('fixture.ts', code, ts.ScriptTarget.Latest, true);
  let translation: ts.CallExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 't') translation = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(translation).toBeDefined();
  expect(callNamespace(translation!)).toBe(expected);
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
          ['tr', 't', 'translate'].includes(node.expression.getText(source)) &&
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
