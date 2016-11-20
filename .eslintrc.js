module.exports = {
  extends: 'airbnb/base',
  rules: {
    strict: 0, /* remove after Chrome supports strict mode in modules OR Babel is integrated */
    'no-unused-vars': [2, { args: 'after-used', argsIgnorePattern: '^_' }],
    'no-param-reassign': [2, { props: false }],
  },
  globals: {},
  env: {
    node: true,
    mocha: true,
  },
};
