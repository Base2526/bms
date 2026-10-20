import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PrimaryButton } from '../components/PrimaryButton';
import { Card, Screen, screenStyles } from '../components/Screen';
import { useI18n } from '../i18n';
import { formatDistance, offerRemainingSeconds } from '../lib/presentation';
import type { RootStackParamList } from '../navigation/types';
import { useDriverRuntime } from '../state/DriverRuntimeContext';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { t } = useI18n();
  const runtime = useDriverRuntime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  const availability = runtime.snapshot?.availability?.state ?? 'OFFLINE';
  const assignment = runtime.snapshot?.assignment ?? null;
  const pending = runtime.status !== 'IDLE';

  return (
    <Screen title={t('home')} subtitle={t('internalBuild')}>
      {runtime.error ? (
        <Card><Text accessibilityRole="alert" style={screenStyles.error}>{t('loadError')}: {runtime.error}</Text></Card>
      ) : null}
      {runtime.queuedCommands.length > 0 ? (
        <Card>
          <Text style={screenStyles.warning}>{t('queuedNotice')}</Text>
          <PrimaryButton label={`${t('sync')} (${runtime.queuedCommands.length})`} tone="secondary" onPress={() => navigation.navigate('SyncCenter')} />
        </Card>
      ) : null}
      <Card>
        <Text style={screenStyles.sectionTitle}>{t('latestServerState')}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, availability === 'ONLINE' ? styles.online : availability === 'BUSY' ? styles.busy : styles.offline]} />
          <Text style={styles.status}>{availability === 'ONLINE' ? t('online') : availability === 'BUSY' ? t('busy') : t('offline')}</Text>
        </View>
        <Text style={screenStyles.muted}>
          {runtime.snapshotReceivedAt ? new Date(runtime.snapshotReceivedAt).toLocaleTimeString() : t('neverSynced')}
        </Text>
        {availability !== 'BUSY' ? (
          <View style={screenStyles.row}>
            <PrimaryButton
              disabled={pending || availability === 'ONLINE'}
              label={t('online')}
              onPress={() => runtime.setAvailability('ONLINE')}
              style={styles.flex}
            />
            <PrimaryButton
              disabled={pending || availability === 'OFFLINE'}
              label={t('offline')}
              onPress={() => runtime.setAvailability('OFFLINE')}
              style={styles.flex}
              tone="secondary"
            />
          </View>
        ) : null}
        <PrimaryButton disabled={pending} label={pending ? t('syncing') : t('refresh')} onPress={() => runtime.refresh()} tone="secondary" />
      </Card>

      <Card>
        <Text style={screenStyles.sectionTitle}>{t('currentAssignment')}</Text>
        {!assignment ? <Text style={screenStyles.muted}>{t('noAssignment')}</Text> : (
          <>
            <Text style={styles.identifier}>{t('delivery')} {shortRef(assignment.deliveryId)}</Text>
            <Text style={screenStyles.body}>{assignment.deliveryState}</Text>
            {assignment.deliveryState === 'ASSIGNED' ? (
              <PrimaryButton disabled={pending} label={t('startPickup')} onPress={() =>
                runtime.advanceJourney(assignment.deliveryId, 'start_pickup', assignment.deliveryVersion)
              } />
            ) : null}
            {assignment.deliveryState === 'EN_ROUTE_PICKUP' ? (
              <PrimaryButton disabled={pending} label={t('arrivePickup')} onPress={() =>
                runtime.advanceJourney(assignment.deliveryId, 'arrive_pickup', assignment.deliveryVersion)
              } />
            ) : null}
            {assignment.deliveryState === 'AT_PICKUP' ? <Text style={screenStyles.warning}>{t('awaitingMerchantHandoff')}</Text> : null}
            {assignment.deliveryState === 'PICKED_UP' ? (
              <PrimaryButton disabled={pending} label={t('startDelivery')} onPress={() =>
                runtime.advanceJourney(assignment.deliveryId, 'start_delivery', assignment.deliveryVersion)
              } />
            ) : null}
            {assignment.deliveryState === 'IN_TRANSIT' ? (
              <View style={screenStyles.gap}>
                <PrimaryButton disabled={pending} label={t('arriveDropoff')} onPress={() =>
                  runtime.advanceJourney(assignment.deliveryId, 'arrive_dropoff', assignment.deliveryVersion)
                } />
                <PrimaryButton disabled={pending} label={t('reportFailure')} tone="secondary" onPress={() =>
                  runtime.advanceJourney(assignment.deliveryId, 'report_failure', assignment.deliveryVersion, {
                    failure: {
                      reasonCode: 'OTHER', safetyException: false, contactAttemptCount: 0, syntheticOnly: true,
                    },
                  })
                } />
              </View>
            ) : null}
            {assignment.deliveryState === 'AT_DROPOFF' ? (
              <View style={screenStyles.gap}>
                <PrimaryButton disabled={pending} label={t('deliverWithPod')} onPress={() =>
                  runtime.advanceJourney(assignment.deliveryId, 'deliver_with_pod', assignment.deliveryVersion, {
                    pod: {
                      evidenceRef: `synthetic-photo:${makeEvidenceRef()}`,
                      sha256: '0'.repeat(64),
                      contentType: 'image/jpeg', byteSize: 1, pixelWidth: 1, pixelHeight: 1,
                      syntheticOnly: true,
                    },
                  })
                } />
                <PrimaryButton disabled={pending} label={t('reportFailure')} tone="secondary" onPress={() =>
                  runtime.advanceJourney(assignment.deliveryId, 'report_failure', assignment.deliveryVersion, {
                    failure: {
                      reasonCode: 'OTHER', safetyException: false, contactAttemptCount: 0, syntheticOnly: true,
                    },
                  })
                } />
              </View>
            ) : null}
            {assignment.deliveryState === 'DELIVERY_FAILED' || assignment.deliveryState === 'RETURN_REQUESTED' ? (
              <Text style={screenStyles.warning}>{t('awaitingReturnApproval')}</Text>
            ) : null}
            {assignment.deliveryState === 'RETURN_APPROVED' ? (
              <PrimaryButton disabled={pending} label={t('startReturn')} onPress={() =>
                runtime.advanceJourney(assignment.deliveryId, 'start_return', assignment.deliveryVersion)
              } />
            ) : null}
            {assignment.deliveryState === 'RETURN_IN_TRANSIT' ? (
              <PrimaryButton disabled={pending} label={t('arriveReturn')} onPress={() =>
                runtime.advanceJourney(assignment.deliveryId, 'arrive_return', assignment.deliveryVersion)
              } />
            ) : null}
          </>
        )}
      </Card>

      <View style={screenStyles.gap}>
        <Text style={screenStyles.sectionTitle}>{t('offers')}</Text>
        {runtime.snapshot?.offers.length ? runtime.snapshot.offers.map(offer => {
          const remaining = runtime.snapshotReceivedAt
            ? offerRemainingSeconds(runtime.snapshot!.serverNow, offer.expiresAt, runtime.snapshotReceivedAt, now)
            : 0;
          const expired = remaining === 0;
          return (
            <Card key={offer.offerId}>
              <Text style={styles.identifier}>{t('delivery')} {shortRef(offer.deliveryId)}</Text>
              <Text style={screenStyles.body}>{t('pickupDistance')}: {formatDistance(offer.pickupDistanceM)}</Text>
              <Text style={expired ? screenStyles.error : screenStyles.muted}>
                {expired ? t('expired') : `${t('expiresIn')} ${remaining} ${t('seconds')}`}
              </Text>
              <View style={screenStyles.row}>
                <PrimaryButton disabled={pending || expired} label={t('accept')} onPress={() =>
                  runtime.decideOffer(offer.offerId, 'accept', offer.version)
                } style={styles.flex} />
                <PrimaryButton disabled={pending || expired} label={t('reject')} onPress={() =>
                  runtime.decideOffer(offer.offerId, 'reject', offer.version)
                } style={styles.flex} tone="secondary" />
              </View>
            </Card>
          );
        }) : <Card><Text style={screenStyles.muted}>{t('noOffers')}</Text></Card>}
      </View>
    </Screen>
  );
}

function shortRef(value: string): string {
  return `${value.slice(0, 8)}…`;
}

function makeEvidenceRef(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

const styles = StyleSheet.create({
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  dot: { borderRadius: 6, height: 12, width: 12 },
  online: { backgroundColor: colors.success },
  busy: { backgroundColor: colors.warning },
  offline: { backgroundColor: colors.muted },
  status: { color: colors.text, fontSize: 20, fontWeight: '800' },
  identifier: { color: colors.text, fontSize: 16, fontWeight: '800' },
  flex: { flex: 1 },
});
