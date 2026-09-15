import { Platform } from 'react-native';
import Sound from 'react-native-sound';
import {
  setupOrderAlertSound,
  teardownOrderAlertSound,
} from '../src/lib/soundPlayer';
import {
  hasOrderAlertSoundPlayer,
  playOrderAlertSound,
} from '../src/lib/orderAlertSound';

/**
 * ตัวปลอมของ react-native-sound
 *
 * ⚠️ `jest.mock` ถูก hoist ขึ้นบนสุด และ factory ทำงานตอน import ครั้งแรก — ตัวแปรที่ประกาศ
 * ด้วย const นอก factory จึงยังไม่มีค่า (TDZ) ต้องเก็บ state ไว้บนตัว mock เอง
 *
 * เทสนี้ตรึง "เราเรียกไลบรารีถูกไหม" ไม่ได้ตรึงว่าลำโพงดังจริง — เสียงเป็นของที่เทสยืนยันแทนหูไม่ได้
 */
jest.mock('react-native-sound', () => {
  const mock: any = jest
    .fn()
    .mockImplementation(function (
      this: any,
      name: string,
      _base: string,
      cb: (error: unknown) => void,
    ) {
      // ⚠️ เรียก callback แบบ sync โดยตั้งใจ — เป็นรูปที่ทำให้บั๊ก "อ้างถึง const จากใน
      // constructor ของตัวเอง" โผล่ ซึ่งของจริงที่เรียกแบบ async จะซ่อนเอาไว้
      const failed = mock.__failLoad === true;
      this.isLoaded = () => !failed;
      this.release = jest.fn();
      this.play = jest.fn();
      this.stop = jest.fn((done?: () => void) => {
        done?.();
        return this;
      });
      mock.__created.push({ name, instance: this });
      cb(failed ? new Error('load failed') : null);
    });
  mock.MAIN_BUNDLE = 'MAIN_BUNDLE';
  mock.setCategory = jest.fn();
  mock.__created = [] as Array<{ name: string; instance: any }>;
  mock.__failLoad = false;
  return mock;
});

const SoundMock = Sound as unknown as {
  __created: Array<{ name: string; instance: any }>;
  __failLoad: boolean;
  setCategory: jest.Mock;
};

const created = () => SoundMock.__created;
const nameOf = (prefix: string) =>
  created().find(c => c.name.startsWith(prefix))!.instance;

describe('soundPlayer', () => {
  beforeEach(() => {
    SoundMock.__created.length = 0;
    SoundMock.__failLoad = false;
    SoundMock.setCategory.mockClear();
    teardownOrderAlertSound();
  });

  afterAll(() => {
    teardownOrderAlertSound();
    Platform.OS = 'ios';
  });

  /**
   * ⚠️ เทสที่สำคัญที่สุดของไฟล์นี้
   * Android อ่าน `res/raw` ด้วย `getIdentifier(name, "raw", pkg)` ซึ่งใช้ชื่อ **ไม่มีนามสกุล**
   * ส่วน iOS หาไฟล์ในบันเดิลด้วยชื่อเต็ม · ส่งชื่อผิดแพลตฟอร์ม = เงียบสนิทโดยไม่มี error
   */
  it('Android ใช้ชื่อไฟล์ไม่มีนามสกุล ส่วน iOS ใช้ชื่อเต็ม', () => {
    Platform.OS = 'android';
    setupOrderAlertSound();
    expect(
      created()
        .map(c => c.name)
        .sort(),
    ).toEqual(['kitchen', 'order_in']);

    SoundMock.__created.length = 0;
    teardownOrderAlertSound();

    Platform.OS = 'ios';
    setupOrderAlertSound();
    expect(
      created()
        .map(c => c.name)
        .sort(),
    ).toEqual(['kitchen.wav', 'order_in.wav']);
  });

  it('ลงทะเบียนตัวเล่นเสียงให้ระบบแจ้งเตือน และเล่นได้จริง', () => {
    setupOrderAlertSound();
    expect(hasOrderAlertSoundPlayer()).toBe(true);
    expect(playOrderAlertSound('incoming_order')).toBe(true);

    const sound = nameOf('order_in');
    // หยุดก่อนเล่นเสมอ — ออร์เดอร์สองใบติดกันต้องได้ยินสองครั้ง ไม่ใช่ใบที่สองถูกกลืน
    expect(sound.stop).toHaveBeenCalled();
    expect(sound.play).toHaveBeenCalled();
  });

  it('ตั้ง category เป็น Playback เพื่อให้ดังแม้เครื่องอยู่โหมดเงียบ', () => {
    setupOrderAlertSound();
    expect(SoundMock.setCategory).toHaveBeenCalledWith('Playback', false);
  });

  /** ⚠️ โหลดไฟล์ไม่สำเร็จต้องรายงานว่าเล่นไม่ได้ ห้ามรายงานว่าดังแล้ว */
  it('โหลดไฟล์เสียงไม่สำเร็จ = play() คืน false', () => {
    SoundMock.__failLoad = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setupOrderAlertSound();
    expect(playOrderAlertSound('incoming_order')).toBe(false);
    expect(playOrderAlertSound('kitchen_ticket')).toBe(false);
    warn.mockRestore();
  });

  it('เสียงคนละชนิดใช้คนละไฟล์', () => {
    setupOrderAlertSound();
    playOrderAlertSound('kitchen_ticket');
    expect(nameOf('kitchen').play).toHaveBeenCalled();
    expect(nameOf('order_in').play).not.toHaveBeenCalled();
  });
});
