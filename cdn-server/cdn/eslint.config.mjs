import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import unjs from 'eslint-config-unjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default unjs(
  {
    ignores: ['**/dist'],
  },
  {
    rules: {
      'space-before-function-paren': 0,
      'arrow-parens': 0,
      'comma-dangle': 0,
      semi: 0,
      'unicorn/prevent-abbreviations': 0,
      quotes: 0,
      'keyword-spacing': 0,
      'no-undef': 0,
      indent: 0,
      'import/named': 0,
      'unicorn/catch-error-name': 0,
      'unicorn/no-null': 0,
      'unicorn/no-useless-undefined': 0,
      'unicorn/no-await-expression-member': 0,
      'unicorn/no-array-push-push': 0,
      'unicorn/filename-case': 0,
      '@typescript-eslint/no-unused-vars': 0,
      '@typescript-eslint/no-non-null-assertion': 0,
      'unicorn/expiring-todo-comments': 0,
      'no-unexpected-multiline': 0,
      'no-useless-constructor': 0,
      'unicorn/prefer-ternary': 0,
      'unicorn/prefer-string-raw': 0,
      '@typescript-eslint/no-empty-object-type': 0,
    },
  },
);
