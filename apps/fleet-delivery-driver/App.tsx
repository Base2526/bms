import React, { useState } from 'react';
import { StatusBar, Button } from 'react-native';
import { RideSandboxScreen } from '../fleet-delivery-customer-core/native/RideSandboxScreen';
import type {RideNativeEnvironment} from '../fleet-delivery-customer-core/native/RideMap';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from './src/i18n';
import { RootNavigator } from './src/navigation/RootNavigator';
import { DriverSessionProvider } from './src/state/DriverSessionContext';

function App(environment: RideNativeEnvironment = {}) {
  const [rides, setRides] = useState(__DEV__);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {rides && __DEV__ ? (
        <RideSandboxScreen role="DRIVER" environment={environment} onExit={() => setRides(false)} />
      ) : (
        <>
          {__DEV__ && (
            <Button
              title="Motorbike · รับส่งคน sandbox"
              onPress={() => setRides(true)}
            />
          )}
          <LanguageProvider>
            <DriverSessionProvider>
              <RootNavigator />
            </DriverSessionProvider>
          </LanguageProvider>
        </>
      )}
    </SafeAreaProvider>
  );
}

export default App;
