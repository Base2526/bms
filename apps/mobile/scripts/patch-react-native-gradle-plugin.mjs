import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const catalogPath = join(
  process.cwd(),
  'node_modules',
  '@react-native',
  'gradle-plugin',
  'gradle',
  'libs.versions.toml',
);

if (existsSync(catalogPath)) {
  const before = readFileSync(catalogPath, 'utf8');
  const after = before.replace(/^agp = "9\.2\.1"$/m, 'agp = "9.0.0"');

  if (after !== before) {
    writeFileSync(catalogPath, after);
    console.log('Pinned React Native Gradle plugin AGP to 9.0.0 for Android Studio 2025.2.');
  }
}

const soundPodspecPath = join(process.cwd(), 'node_modules', 'react-native-sound', 'RNSound.podspec');

if (existsSync(soundPodspecPath)) {
  const before = readFileSync(soundPodspecPath, 'utf8');
  const sourceFilesLine = '  s.source_files = "ios/**/*.{h,m,mm,cpp}"';
  const after = before.includes('s.frameworks    = "AVFoundation"')
    ? before
    : before.replace(sourceFilesLine, `${sourceFilesLine}\n  s.frameworks    = "AVFoundation"`);

  if (after !== before) {
    writeFileSync(soundPodspecPath, after);
    console.log('Linked AVFoundation for react-native-sound iOS builds.');
  }
}
