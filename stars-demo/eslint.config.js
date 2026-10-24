import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'

export default [
  { ignores: ['node_modules/**', 'dist/**', 'data/**', 'coverage/**', 'test-results/**', 'playwright-report/**'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  { files: ['*.js', 'server/**/*.mjs', 'test/**/*.mjs'], languageOptions: { globals: globals.node } },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react },
    rules: { 'react/jsx-uses-react': 'error', 'react/jsx-uses-vars': 'error' },
  },
]
