import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Card, Screen, screenStyles } from '../components/Screen';
import { DRIVER_APP_CAPABILITIES } from '../config/capabilities';
import { useI18n } from '../i18n';
import { useDriverRuntime } from '../state/DriverRuntimeContext';
import { useDriverSession } from '../state/DriverSessionContext';
import { colors, spacing } from '../theme';

const blockedCapabilities = Object.entries(DRIVER_APP_CAPABILITIES)
  .filter(([, enabled]) => !enabled)
  .map(([name]) => name);

export function SettingsScreen() {
  const { language, setLanguage, t } = useI18n();
  const { state, signOut } = useDriverSession();
  const { clearQueue } = useDriverRuntime();
  const session = state.kind === 'ACTIVE' ? state.session : null;

  const confirmSignOut = () => Alert.alert(t('signOut'), t('secureQueue'), [
    { text: t('reject'), style: 'cancel' },
    {
      text: t('signOut'),
      style: 'destructive',
      onPress: () => clearQueue().then(signOut),
    },
  ]);

  return (
    <Screen title={t('settings')} subtitle={t('internalBuild')}>
      <Card>
        <Text style={screenStyles.sectionTitle}>{t('language')}</Text>
        <View style={screenStyles.row}>
          <PrimaryButton label={t('thai')} disabled={language === 'th'} onPress={() => setLanguage('th')} style={styles.flex} />
          <PrimaryButton label={t('english')} disabled={language === 'en'} onPress={() => setLanguage('en')} style={styles.flex} tone="secondary" />
        </View>
      </Card>
      <Card>
        <Text style={screenStyles.sectionTitle}>{t('session')}</Text>
        <Text style={screenStyles.body}>{session?.apiBaseUrl ?? '—'}</Text>
        <Text style={screenStyles.muted}>{t('tenantRef')}: {session?.tenantRef ?? '—'}</Text>
        <Text style={screenStyles.muted}>{t('branchRef')}: {session?.branchRef ?? '—'}</Text>
      </Card>
      <Card>
        <Text style={screenStyles.sectionTitle}>{t('blockedCapabilities')}</Text>
        <Text style={screenStyles.warning}>{t('disabledExplanation')}</Text>
        {blockedCapabilities.map(capability => (
          <Text key={capability} style={styles.blocked}>• {capability}</Text>
        ))}
      </Card>
      <PrimaryButton label={t('signOut')} onPress={confirmSignOut} tone="danger" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  blocked: { color: colors.muted, fontSize: 14, lineHeight: 20, marginLeft: spacing.xs },
});
