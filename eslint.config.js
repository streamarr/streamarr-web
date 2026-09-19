import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  // Vendored or generated: other tools own these files.
  globalIgnores([
    'dist/',
    'coverage/',
    'test-results/',
    'playwright-report/',
    'blob-report/',
    'src/graphql/generated/',
    'src/api/generated/',
    'src/routeTree.gen.ts',
  ]),
  js.configs.recommended,
  {
    // The router closes over a client that is assigned after the closure is created.
    rules: { 'prefer-const': ['error', { ignoreReadBeforeAssign: true }] },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // An async function without await is how a fake or a no-op satisfies a Promise-returning type.
      '@typescript-eslint/require-await': 'off',
      // React calls event-handler props and ignores what they return.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // TanStack Router redirects by throwing the object redirect() returns.
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'package', package: '@tanstack/router-core', name: 'Redirect' }] },
      ],
    },
  },
  {
    // tsconfig.e2e.json owns these; the project service only discovers tsconfig.json.
    files: ['e2e/**/*.ts', 'playwright.config.ts', 'codegen.ts'],
    languageOptions: {
      parserOptions: { projectService: false, project: './tsconfig.e2e.json' },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    // Asserting on a spy reads the method without calling it: expect(scope.skipWaiting).
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs', '*.config.{js,cjs,ts}', 'codegen.ts'],
    languageOptions: { globals: globals.node },
  },
  // Last: turns off the stylistic rules Prettier already decides.
  prettier,
)
