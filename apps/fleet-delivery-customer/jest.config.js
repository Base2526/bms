module.exports = {
  preset: '@react-native/jest-preset',
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  moduleNameMapper: {
    '^./rideSandbox\\.js$':
      '<rootDir>/../../packages/fleet-delivery-contracts/src/rideSandbox.ts',
    '^./routePolyline\\.js$':
      '<rootDir>/../fleet-delivery-customer-core/src/routePolyline.ts',
    '^@bms/fleet-delivery-customer-core$':
      '<rootDir>/../fleet-delivery-customer-core/src/index.ts',
    '^@bms/fleet-delivery-contracts$':
      '<rootDir>/../../packages/fleet-delivery-contracts/src/index.ts',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-keychain|react-native-safe-area-context)/)',
  ],
};
