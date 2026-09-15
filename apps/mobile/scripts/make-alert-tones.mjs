#!/usr/bin/env node
/**
 * สร้างไฟล์เสียงแจ้งเตือน (WAV 16-bit mono 44.1kHz) ด้วย Node ล้วน ไม่มี dependency
 *
 * ⚠️ เก็บ "ตัวสร้าง" ไว้ในรีโปแทนที่จะ commit ไฟล์เสียงเฉย ๆ เพราะไฟล์ไบนารีที่ไม่มีใคร
 * สร้างซ้ำได้ = วันที่อยากแก้เสียง ต้องไปหาไฟล์ต้นฉบับที่ไม่มีอยู่จริง
 *
 * รัน: node scripts/make-alert-tones.mjs
 * ปลายทาง: android/app/src/main/res/raw/ และ ios/BmsPos/
 *
 * ⚠️ ชื่อไฟล์ต้องเป็น [a-z0-9_] เท่านั้น — Android ใช้ชื่อไฟล์เป็น resource id ของ res/raw
 * ตัวพิมพ์ใหญ่หรือขีดกลางทำให้ build ไม่ผ่าน
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** ซองเสียง 5ms หัว-ท้าย — ตัดเสียง "แปะ" ตอนคลื่นเริ่ม/จบกลางคัน */
const FADE_SAMPLES = Math.round(SAMPLE_RATE * 0.005);

function beep(samples, freqHz, durationSec, gain = 0.5) {
  const count = Math.round(SAMPLE_RATE * durationSec);
  for (let i = 0; i < count; i += 1) {
    let envelope = 1;
    if (i < FADE_SAMPLES) envelope = i / FADE_SAMPLES;
    else if (i > count - FADE_SAMPLES) envelope = (count - i) / FADE_SAMPLES;
    const value = Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE);
    samples.push(value * gain * envelope);
  }
}

function silence(samples, durationSec) {
  const count = Math.round(SAMPLE_RATE * durationSec);
  for (let i = 0; i < count; i += 1) samples.push(0);
}

function toWav(samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // ความยาวของ fmt chunk
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

// ออร์เดอร์เข้า — สามจังหวะไล่เสียงสูงขึ้น (สิ่งที่ต้องรีบตัดสินใจ ต้องเด่นกว่าเสียงอื่นในร้าน)
const orderIn = [];
beep(orderIn, 880, 0.11);
silence(orderIn, 0.05);
beep(orderIn, 1108, 0.11);
silence(orderIn, 0.05);
beep(orderIn, 1318, 0.16);

// ตั๋วครัวใหม่ — สองจังหวะ เสียงต่ำกว่า แยกออกจากออร์เดอร์เข้าได้ด้วยหูโดยไม่ต้องมองจอ
const kitchen = [];
beep(kitchen, 660, 0.09);
silence(kitchen, 0.06);
beep(kitchen, 660, 0.12);

const targets = [
  join(root, 'android', 'app', 'src', 'main', 'res', 'raw'),
  join(root, 'ios', 'BmsPos'),
];

for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'order_in.wav'), toWav(orderIn));
  writeFileSync(join(dir, 'kitchen.wav'), toWav(kitchen));
  console.log(`wrote order_in.wav + kitchen.wav -> ${dir}`);
}
