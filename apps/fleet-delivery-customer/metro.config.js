const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const customerCore = path.resolve(__dirname, '../fleet-delivery-customer-core');
const contracts = path.resolve(__dirname, '../../packages/fleet-delivery-contracts');
const keychainSource = path.resolve(__dirname, 'node_modules/react-native-keychain/src/index.ts');

const config = {
  watchFolders: [customerCore, contracts],
  resolver: {
    resolveRequest(context, moduleName, platform) {
      if (moduleName === './rideSandbox.js' && context.originModulePath === path.join(contracts, 'src/index.ts')) {
        return { type: 'sourceFile', filePath: path.join(contracts, 'src/rideSandbox.ts') };
      }
      if (moduleName === './routePolyline.js' && context.originModulePath === path.join(customerCore, 'src/rideSandbox.ts')) {
        return { type: 'sourceFile', filePath: path.join(customerCore, 'src/routePolyline.ts') };
      }
      if (moduleName === 'react-native-keychain') {
        return { type: 'sourceFile', filePath: keychainSource };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      '@bms/fleet-delivery-customer-core': customerCore,
      '@bms/fleet-delivery-contracts': contracts,
      'react-native-keychain': path.resolve(__dirname, 'node_modules/react-native-keychain'),
      'react-native-safe-area-context': path.resolve(__dirname, 'node_modules/react-native-safe-area-context'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
