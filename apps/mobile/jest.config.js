module.exports = {
  preset: '@react-native/jest-preset',
  // Shared POS core lives outside apps/mobile. Babel helpers emitted while transforming those files
  // still resolve from the mobile install (there is deliberately no second node_modules in packages/).
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  // React Navigation 7 และ native helpers แจกเป็น ESM ใน node_modules จึงต้องให้
  // Babel ของ React Native transform มันด้วย ไม่งั้น smoke test จะพังตั้งแต่ `export` ตัวแรก
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-keychain|react-native-data-scanner|react-native-safe-area-context|react-native-sound|react-native-screens|react-native-svg)/)',
  ],
};
