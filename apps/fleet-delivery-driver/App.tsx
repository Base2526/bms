import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from './src/i18n';
import { RootNavigator } from './src/navigation/RootNavigator';
import { DriverSessionProvider } from './src/state/DriverSessionContext';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <LanguageProvider>
        <DriverSessionProvider>
          <RootNavigator />
        </DriverSessionProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

export default App;
