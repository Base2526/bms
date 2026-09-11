/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { setupOrderAlertSound } from './src/lib/soundPlayer';

// เตรียมเสียงแจ้งเตือนก่อน render — โหลดไฟล์เสียงตอนต้องเตือนจริงจะมาช้ากว่าเหตุการณ์
// ⚠️ ต้องมี native module อยู่ในเครื่องจริง (`pod install` + build ใหม่หลังติดตั้ง
// react-native-sound) · โหลด JS ใหม่บน binary เก่าจะไม่มีเสียง แล้วระบบจะรายงานว่า
// "เครื่องนี้ยังไม่มีโมดูลเสียง" ตามความจริง
setupOrderAlertSound();

AppRegistry.registerComponent(appName, () => App);
