import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '**/.tmp-*', '**/.chrome-*']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/services/api.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'axios',
              message: 'Use the shared client in src/services/api.js instead of importing axios directly.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch'] > Literal:first-child[value=/^\\/api(?:\\/|$)/]",
          message: 'Do not call /api directly with fetch. Use src/services/api.js so env-based API routing stays consistent.',
        },
        {
          selector: "CallExpression[callee.name='fetch'] > TemplateLiteral:first-child[quasis.length=1][quasis.0.value.raw=/^\\/api(?:\\/|$)/]",
          message: 'Do not call /api directly with fetch. Use src/services/api.js so env-based API routing stays consistent.',
        },
      ],
    },
  },
])
