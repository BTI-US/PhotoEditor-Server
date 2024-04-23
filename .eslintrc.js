module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true
  },
  extends: 'standard',
  overrides: [
    {
      env: {
        node: true
      },
      files: [
        '.eslintrc.{js,cjs}'
      ],
      parserOptions: {
        sourceType: 'script'
      }
    }
  ],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    indent: "off",
    "arrow-parens": "off",
    quotes: "off",
    "linebreak-style": "off",
    "max-len": "off",
    "no-console": "off",
    "spaced-comment": "off",
    "no-trailing-spaces": "off",
    "no-multi-spaces": "off",
    "no-unused-vars": "off",
    "global-require": "off",
    "consistent-return": "off",
    camelcase: "off",
    semi: ["error", "always"]
  }
};
