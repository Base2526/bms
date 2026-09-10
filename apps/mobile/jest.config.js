module.exports = {
  preset: '@react-native/jest-preset',
  // React Navigation 7 และ native helpers แจกเป็น ESM ใน node_modules จึงต้องให้
  // Babel ของ React Native transform มันด้วย ไม่งั้น smoke test จะพังตั้งแต่ `export` ตัวแรก
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-keychain|react-native-safe-area-context|react-native-screens|react-native-svg)/)',
  ],
};
