import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';
import { PrimaryButton } from '../components/PrimaryButton';
import { Card, Screen, screenStyles } from '../components/Screen';
import { DRIVER_APP_CAPABILITIES } from '../config/capabilities';
import { useI18n } from '../i18n';
import { useDriverSession } from '../state/DriverSessionContext';
import { colors, spacing } from '../theme';

export function ActivationScreen() {
  const { t } = useI18n();
  const { state, activate, reload } = useDriverSession();
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:8080');
  const [accessToken, setAccessToken] = useState('');
  const [tenantRef, setTenantRef] = useState('');
  const [branchRef, setBranchRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.kind === 'LOADING') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={screenStyles.muted}>{t('loading')}</Text>
      </View>
    );
  }

  if (state.kind === 'UNAVAILABLE') {
    return (
      <Screen title={t('appName')} subtitle={t('internalBuild')} topInset>
        <Card>
          <Text style={screenStyles.sectionTitle}>{t('storageUnavailable')}</Text>
          <Text style={screenStyles.error}>{state.error}</Text>
          <PrimaryButton label={t('retry')} onPress={() => reload()} />
        </Card>
      </Screen>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await activate({ apiBaseUrl, accessToken, tenantRef, branchRef });
    } catch (caught) {
      if (caught instanceof z.ZodError) setError(`${t('validationFailed')}: ${caught.issues[0]?.message ?? ''}`);
      else setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen title={t('appName')} subtitle={t('internalBuild')} topInset>
      <Card>
        <Text style={screenStyles.sectionTitle}>{t('productionLocked')}</Text>
        <Text style={screenStyles.warning}>{t('activationBlocked')}</Text>
      </Card>
      {DRIVER_APP_CAPABILITIES.debugActivation ? (
        <Card>
          <Text style={screenStyles.sectionTitle}>{t('activationTitle')}</Text>
          <Text style={screenStyles.muted}>{t('debugOnly')}</Text>
          <Field label={t('apiUrl')} value={apiBaseUrl} onChangeText={setApiBaseUrl} />
          <Field label={t('accessToken')} value={accessToken} onChangeText={setAccessToken} secret />
          <Field label={t('tenantRef')} value={tenantRef} onChangeText={setTenantRef} />
          <Field label={t('branchRef')} value={branchRef} onChangeText={setBranchRef} />
          {error ? <Text accessibilityRole="alert" style={screenStyles.error}>{error}</Text> : null}
          <PrimaryButton disabled={submitting} label={submitting ? t('loading') : t('connect')} onPress={submit} />
        </Card>
      ) : null}
    </Screen>
  );
}

function Field({ label, value, onChangeText, secret = false }: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  secret?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        secureTextEntry={secret}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: spacing.md, justifyContent: 'center' },
  field: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
});
