import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'supabase', 'docs'] },
  {
    files: ['**/*.{ts,tsx,mts}'],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Security requirement 4.8: React escaping only, never raw HTML.
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is banned (SECURITY.md).',
        },
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: 'innerHTML is banned (SECURITY.md).',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    files: ['vite.config.ts', 'playwright.config.ts', 'e2e/**/*.ts', 'netlify/**/*.{ts,mts}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
