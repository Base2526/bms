module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // สี/spacing มาจาก theme ตอน runtime จึงต้องประกอบ style ใน render; StyleSheet เก็บเฉพาะโครงคงที่
    'react-native/no-inline-styles': 'off',
    // renderItem/tabBarIcon เป็น render-prop API ของ RN/React Navigation ไม่ได้ mount เป็น component type
    'react/no-unstable-nested-components': ['warn', { allowAsProps: true }],
  },
};
