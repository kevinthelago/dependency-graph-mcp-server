import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  ...tsPlugin.configs['flat/recommended'],
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/**'],
  },
];
