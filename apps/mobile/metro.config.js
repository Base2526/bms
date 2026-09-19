const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // Mobile and the Electron renderer share state-machine/idempotency/payment primitives.
  // Keep the package dependency-free so Metro never pulls desktop or Node APIs into RN.
  // Files in that package live outside apps/mobile, so make their Babel helpers resolve from
  // the Mobile dependency tree instead of walking upward to a non-existent repo node_modules.
  watchFolders: [path.resolve(__dirname, '../../packages/pos-client-core')],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
