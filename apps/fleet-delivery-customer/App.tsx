import React, { useState } from 'react';
import { StatusBar, Button } from 'react-native';
import { RideSandboxScreen } from '../fleet-delivery-customer-core/native/RideSandboxScreen';
import type {RideNativeEnvironment} from '../fleet-delivery-customer-core/native/RideMap';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivationScreen } from './src/screens/ActivationScreen';
import { DeliverySearchScreen } from './src/screens/DeliverySearchScreen';
import {
  CustomerSessionProvider,
  useCustomerSession,
} from './src/state/CustomerSessionContext';

const motorbikeServiceImage = require('./src/assets/motorbike-service-v1.png');

function AppContent() {
  const { state } = useCustomerSession();
  return state.kind === 'ACTIVE' ? (
    <DeliverySearchScreen />
  ) : (
    <ActivationScreen />
  );
}

function App(environment: RideNativeEnvironment = {}) {
  const [rides, setRides] = useState(__DEV__);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {rides && __DEV__ ? (
        <RideSandboxScreen
          role="RIDER"
          environment={{
            ...environment,
            rideMotorbikeArtwork:
              environment.rideMotorbikeArtwork ?? motorbikeServiceImage,
          }}
          onExit={() => setRides(false)}
        />
      ) : (
        <>
          {__DEV__ && (
            <Button
              title="Motorbike · รับส่งคน sandbox"
              onPress={() => setRides(true)}
            />
          )}
          <CustomerSessionProvider>
            <AppContent />
          </CustomerSessionProvider>
        </>
      )}
    </SafeAreaProvider>
  );
}

export default App;
