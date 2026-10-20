import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivationScreen } from './src/screens/ActivationScreen';
import { DeliverySearchScreen } from './src/screens/DeliverySearchScreen';
import { CustomerSessionProvider, useCustomerSession } from './src/state/CustomerSessionContext';

function AppContent() {
  const { state } = useCustomerSession();
  return state.kind === 'ACTIVE' ? <DeliverySearchScreen /> : <ActivationScreen />;
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <CustomerSessionProvider>
        <AppContent />
      </CustomerSessionProvider>
    </SafeAreaProvider>
  );
}

export default App;
