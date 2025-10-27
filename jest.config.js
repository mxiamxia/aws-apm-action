module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/utils/record-timing.sh'
  ],
  testMatch: ['**/test/**/*.test.js'],
  coverageThreshold: {
    global: {
      lines: 60,
      functions: 60,
      branches: 50,
      statements: 60
    }
  }
};
