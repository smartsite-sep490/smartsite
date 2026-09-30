import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.test-build/**',
      '**/.expo/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/generated/**',
      '**/*.d.ts',
      '**/.agents/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/mobile/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, __DEV__: 'readonly' } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-refresh': reactRefresh },
    rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true }] },
  },
  {
    // auth-session.tsx is a hooks + context module that also exports AuthProvider (a component).
    // The react-refresh rule would fire because it mixes hook exports with a component export.
    // WorkforceView.tsx exports getWorkforceTabs (a pure function used by tests) alongside WorkforceView.
    // These files are intentionally structured this way; Fast Refresh still works for their components.
    files: [
      'apps/web/src/features/auth/auth-session.tsx',
      'apps/web/src/components/workforce/WorkforceView.tsx',
    ],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
