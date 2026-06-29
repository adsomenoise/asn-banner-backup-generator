import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'temp/**',
      'output/**',
      'input/**',
      'debug-artifacts-*/**',
      'test-temp-*/**',
      'test-temp-capute/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^(_|next)$',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|e)$'
        }
      ],
      'no-undef': 'error'
    }
  },
  {
    files: ['src/captureBackup.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      'no-empty': 'off'
    }
  },
  {
    // app.js is a browser script (extracted from inline <script> in index.html).
    // Override the node globals set by the src/**/*.js rule above.
    files: ['src/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser
      }
    },
    rules: {
      'no-empty': 'off'
    }
  },
  {
    files: ['src/jobs/JobStore.js'],
    rules: {
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      'no-unused-vars': 'off'
    }
  }
];
