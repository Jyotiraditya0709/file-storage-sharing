import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'drizzle/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'use lib/tokens.ts — never Math.random for IDs/tokens',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The layering rule from CLAUDE.md, enforced by the linter instead of by
    // review: routes parse, validate, call one service and map the result.
    files: ['server/src/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/*', '**/db/**', '**/storage/*', '**/storage/**'],
              message:
                'routes must not import db/ or storage/ — go through a service (CLAUDE.md layering)',
            },
          ],
        },
      ],
    },
  },
);
