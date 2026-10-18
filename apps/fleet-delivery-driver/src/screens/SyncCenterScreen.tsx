import React from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Card, Screen, screenStyles } from '../components/Screen';
import { useI18n } from '../i18n';
import { describeCommand } from '../lib/presentation';
import { useDriverRuntime } from '../state/DriverRuntimeContext';
import { colors } from '../theme';

export function SyncCenterScreen() {
  const { t } = useI18n();
  const runtime = useDriverRuntime();
  const syncing = runtime.status === 'SYNCING';

  const confirmClear = () => Alert.alert(t('clearQueue'), t('queuedNotice'), [
    { text: t('reject'), style: 'cancel' },
    { text: t('clearQueue'), style: 'destructive', onPress: () => runtime.clearQueue() },
  ]);

  return (
    <Screen title={t('sync')} subtitle={t('internalBuild')}>
      <Card><Text style={screenStyles.muted}>{t('secureQueue')}</Text></Card>
      {runtime.error ? <Card><Text accessibilityRole="alert" style={screenStyles.error}>{runtime.error}</Text></Card> : null}
      <Card>
        <Text style={screenStyles.sectionTitle}>{t('queuedCommands')} ({runtime.queuedCommands.length})</Text>
        {runtime.queuedCommands.length === 0 ? <Text style={screenStyles.muted}>{t('queueEmpty')}</Text> : runtime.queuedCommands.map(command => (
          <Text key={command.commandId} style={styles.command}>
            {describeCommand(command.kind)} · {new Date(command.createdAt).toLocaleTimeString()}
          </Text>
        ))}
        <PrimaryButton disabled={syncing || runtime.queuedCommands.length === 0} label={syncing ? t('syncing') : t('syncNow')} onPress={() => runtime.flush()} />
        <PrimaryButton disabled={syncing || runtime.queuedCommands.length === 0} label={t('clearQueue')} onPress={confirmClear} tone="danger" />
      </Card>
      {runtime.rejected.length > 0 ? (
        <Card>
          <Text style={screenStyles.sectionTitle}>{t('rejectedCommands')}</Text>
          {runtime.rejected.map(item => (
            <Text key={item.commandId} style={screenStyles.error}>{t('serverCode')}: {item.code}</Text>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  command: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, color: colors.text, paddingVertical: 8 },
});
