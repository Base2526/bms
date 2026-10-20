const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const driverCore = path.resolve(__dirname, '../fleet-delivery-driver-core');
const contracts = path.resolve(__dirname, '../../packages/fleet-delivery-contracts');

const config = {
  watchFolders: [driverCore, contracts],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      '@bms/fleet-delivery-driver-core': driverCore,
      '@bms/fleet-delivery-contracts': contracts,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
