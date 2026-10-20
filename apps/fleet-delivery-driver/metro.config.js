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
const customerCore = path.resolve(__dirname, '../fleet-delivery-customer-core');

const config = {
  watchFolders: [driverCore, contracts, customerCore],
  resolver: {
    resolveRequest(context, moduleName, platform) {
      if (moduleName === './rideSandbox.js' && context.originModulePath === path.join(contracts, 'src/index.ts')) {
        return { type: 'sourceFile', filePath: path.join(contracts, 'src/rideSandbox.ts') };
      }
      if (moduleName === './routePolyline.js' && context.originModulePath === path.join(customerCore, 'src/rideSandbox.ts')) {
        return { type: 'sourceFile', filePath: path.join(customerCore, 'src/routePolyline.ts') };
      }
      if (moduleName === 'react-native-keychain') {
        return { type: 'sourceFile', filePath: path.resolve(__dirname, 'node_modules/react-native-keychain/src/index.ts') };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      '@bms/fleet-delivery-driver-core': driverCore,
      '@bms/fleet-delivery-contracts': contracts,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
