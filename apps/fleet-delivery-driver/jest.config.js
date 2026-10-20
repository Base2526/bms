module.exports = {
  preset: '@react-native/jest-preset',
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  moduleNameMapper: {
    '^@bms/fleet-delivery-driver-core$': '<rootDir>/../fleet-delivery-driver-core/src/index.ts',
    '^@bms/fleet-delivery-contracts$': '<rootDir>/../../packages/fleet-delivery-contracts/src/index.ts',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-keychain|react-native-safe-area-context|react-native-screens)/)',
  ],
};
