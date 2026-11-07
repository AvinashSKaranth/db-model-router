const js = require("@eslint/js");
const sonarjs = require("eslint-plugin-sonarjs");
const security = require("eslint-plugin-security");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      ".nyc_output/**",
      "demo/**",
      "scripts/**",
      "reports/**",
      "test/tmp_*/**",
      "types/**",
    ],
  },
  js.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-prototype-builtins": "warn",
      "no-useless-assignment": "warn",
      "no-useless-catch": "warn",
      "no-useless-escape": "warn",
      "sonarjs/cognitive-complexity": ["warn", 30],
      "sonarjs/no-unused-vars": "warn",
      "sonarjs/no-ignored-exceptions": "warn",
      "sonarjs/concise-regex": "warn",
      "sonarjs/super-linear-regex": "warn",
      "sonarjs/no-dead-store": "warn",
      "sonarjs/no-os-command-from-path": "warn",
      "sonarjs/no-hardcoded-passwords": "warn",
      "sonarjs/no-clear-text-protocols": "warn",
      "sonarjs/no-small-switch": "warn",
      "sonarjs/no-nested-template-literals": "warn",
      "sonarjs/regex-complexity": "warn",
      "sonarjs/prefer-single-boolean-return": "warn",
      "sonarjs/no-duplicated-branches": "warn",
      "sonarjs/no-all-duplicated-branches": "warn",
      "sonarjs/no-redundant-assignments": "warn",
      "sonarjs/no-useless-catch": "warn",
      "preserve-caught-error": "warn",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/pseudo-random": "off",
      "sonarjs/slow-regex": "warn",
      "sonarjs/todo-tag": "warn",
      "sonarjs/no-nested-conditional": "warn",
      "sonarjs/no-commented-code": "warn",
      "sonarjs/deprecation": "warn",
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
];
