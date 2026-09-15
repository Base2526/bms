import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  MobilePosAddBoardGameParticipantDocument,
  MobilePosAdjustBoardGameTimingDocument,
  MobilePosBoardGameSessionDocument,
  MobilePosBoardGameWorkspaceDocument,
  MobilePosCancelBoardGameSessionDocument,
  MobilePosCheckoutBoardGameCopyDocument,
  MobilePosCloseBoardGameSessionDocument,
  MobilePosLeaveBoardGameParticipantDocument,
  MobilePosMembersDocument,
  MobilePosOpenBoardGameSessionDocument,
  MobilePosReturnBoardGameCopyDocument,
  type MobilePosMembersQuery,
  type MobilePosBoardGameWorkspaceQuery,
} from '../../graphql/generated';
import {
  createIdempotencyKey,
  isDecidedRejection,
  isStaleOperationConflict,
} from '../../lib/operation';
import type { BoardGameStackParamList } from '../../navigation/types';
import { useSession } from '../../state/SessionContext';
import { useTheme } from '../../theme/ThemeProvider';

type Props = NativeStackScreenProps<BoardGameStackParamList, 'BoardGame'>;
type Table =
  MobilePosBoardGameWorkspaceQuery['bmsPosBoardGameWorkspace']['floor']['tables'][number];
type ParticipantDraft = {
  key: string;
  customerId: string | null;
  memberNo: string | null;
  displayName: string;
  rateId: string;
  participantType: string;
  billingGroupNo: number;
};
type Member = MobilePosMembersQuery['bmsPosMemberSearch']['members'][number];

function elapsedLabel(startedAt: string | null | undefined, now: number) {
  if (!startedAt) return '-';
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(startedAt).getTime()) / 60000),
  );
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} ชม. ${minutes % 60} นาที` : `${minutes} นาที`;
}

function alertLabel(status: string | null | undefined) {
  if (status === 'OVERDUE') return 'เกินเวลา';
  if (status === 'ENDING_SOON') return 'ใกล้หมดเวลา';
  if (status === 'CLOSING') return 'รอชำระ';
  return 'กำลังเล่น';
}

export default function BoardGameScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { session } = useSession();
  const credentials = session?.credentials;
  const inputCredentials = credentials ?? { cashierUserId: '', pin: '' };
  const [now, setNow] = useState(Date.now());
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [openingTable, setOpeningTable] = useState<Table | null>(null);
  const [billingMode, setBillingMode] = useState<
    'OPEN_ENDED' | 'FIXED_DURATION'
  >('OPEN_ENDED');
  const [durationMinutes, setDurationMinutes] = useState('120');
  const [alertBeforeMinutes, setAlertBeforeMinutes] = useState('15');
  const [sessionNote, setSessionNote] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participantRateId, setParticipantRateId] = useState('');
  const [participantGroup, setParticipantGroup] = useState('1');
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);
  const [returnNote, setReturnNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [working, setWorking] = useState('');
  const notified = useRef(new Set<string>());
  const operationKeys = useRef<Record<string, string>>({});

  const workspace = useQuery(MobilePosBoardGameWorkspaceDocument, {
    variables: { credentials: inputCredentials },
    skip: !credentials,
    pollInterval: 5000,
  });
  const sessionQuery = useQuery(MobilePosBoardGameSessionDocument, {
    variables: { credentials: inputCredentials, id: selectedSessionId },
    skip: !credentials || !selectedSessionId,
    pollInterval: 5000,
  });
  const members = useQuery(MobilePosMembersDocument, {
    variables: { q: memberSearch.trim(), amount: null },
    skip: !credentials || memberSearch.trim().length < 3,
  });
  const [openSession] = useMutation(MobilePosOpenBoardGameSessionDocument);
  const [addParticipant] = useMutation(
    MobilePosAddBoardGameParticipantDocument,
  );
  const [leaveParticipant] = useMutation(
    MobilePosLeaveBoardGameParticipantDocument,
  );
  const [adjustTiming] = useMutation(MobilePosAdjustBoardGameTimingDocument);
  const [closeSession] = useMutation(MobilePosCloseBoardGameSessionDocument);
  const [cancelSession] = useMutation(MobilePosCancelBoardGameSessionDocument);
  const [checkoutCopy] = useMutation(MobilePosCheckoutBoardGameCopyDocument);
  const [returnCopy] = useMutation(MobilePosReturnBoardGameCopyDocument);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!credentials) return;
      workspace.refetch().catch(() => undefined);
      if (selectedSessionId) sessionQuery.refetch().catch(() => undefined);
    }, [credentials, selectedSessionId, sessionQuery, workspace]),
  );

  const data = workspace.data?.bmsPosBoardGameWorkspace;
  const activeRates = useMemo(
    () => (data?.rates ?? []).filter(rate => rate.active),
    [data?.rates],
  );
  const selectedSession = sessionQuery.data?.bmsPosBoardGameSession;
  const selectedTable = data?.floor.tables.find(
    table => table.id === selectedSession?.tableId,
  );
  const availableCopies = useMemo(
    () =>
      (data?.library ?? []).flatMap(title =>
        title.copies
          .filter(copy => copy.status === 'AVAILABLE')
          .map(copy => ({ ...copy, title: title.title })),
      ),
    [data?.library],
  );

  useEffect(() => {
    for (const table of data?.floor.tables ?? []) {
      const current = table.openSession;
      if (
        !current?.id ||
        !['ENDING_SOON', 'OVERDUE'].includes(current.alertStatus ?? '')
      )
        continue;
      const key = `${current.id}:${current.alertStatus}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      Alert.alert(
        current.alertStatus === 'OVERDUE'
          ? 'โต๊ะเกินเวลาแล้ว'
          : 'โต๊ะใกล้หมดเวลา',
        `${table.code} ${table.name} · ${alertLabel(current.alertStatus)}`,
        [
          { text: 'รับทราบ' },
          {
            text: 'เปิดโต๊ะ',
            onPress: () => setSelectedSessionId(current.id ?? ''),
          },
        ],
      );
    }
  }, [data?.floor.tables]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (!credentials || working) return;
    setWorking(key);
    try {
      await action();
      delete operationKeys.current[key];
      await Promise.all([
        workspace.refetch(),
        selectedSessionId ? sessionQuery.refetch() : Promise.resolve(),
      ]).catch(() => undefined);
    } catch (cause) {
      // เก็บคีย์ไว้เฉพาะตอนยังไม่รู้ผล (เน็ตล้ม/500) เพื่อให้กดซ้ำแล้ว replay คำตอบเดิม
      // · คำขอที่เซิร์ฟเวอร์ตัดสินแล้วต้องออกคีย์ใหม่ ไม่งั้นแก้ตามที่ error บอกแล้วกดใหม่
      //   จะไปชนคีย์เดิมด้วยข้อมูลคนละชุด แล้วล้มซ้ำแบบที่หน้าจอพาออกไม่ได้
      const stale = isStaleOperationConflict(cause);
      if (isDecidedRejection(cause)) {
        delete operationKeys.current[key];
      }
      if (stale) {
        await Promise.all([
          workspace.refetch(),
          selectedSessionId ? sessionQuery.refetch() : Promise.resolve(),
        ]).catch(() => undefined);
      }
      Alert.alert(
        stale ? 'ข้อมูลเปลี่ยนไปแล้ว' : 'ทำรายการไม่สำเร็จ',
        cause instanceof Error ? cause.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorking('');
    }
  };
  const retryKey = (key: string) =>
    (operationKeys.current[key] ??= createIdempotencyKey(`board-${key}`));

  const addDraftParticipant = () => {
    const rate = activeRates.find(item => item.id === participantRateId);
    const group = Number(participantGroup);
    if (!rate || !Number.isInteger(group) || group < 1 || group > 20) {
      Alert.alert('ข้อมูลผู้เล่นไม่ครบ', 'เลือกอัตราและระบุกลุ่มบิล 1-20');
      return;
    }
    setParticipants(previous => [
      ...previous,
      {
        key: `${Date.now()}-${previous.length}`,
        customerId: selectedMember?.customerId ?? null,
        memberNo: selectedMember?.memberNo ?? null,
        displayName: participantName.trim(),
        rateId: rate.id,
        participantType: rate.customerType,
        billingGroupNo: group,
      },
    ]);
    setParticipantName('');
    setMemberSearch('');
    setSelectedMember(null);
  };

  const chooseMember = (member: Member) => {
    setSelectedMember(member);
    setParticipantName(member.name);
    setMemberSearch(member.memberNo ?? member.name);
    const memberRate = activeRates.find(rate => rate.customerType === 'MEMBER');
    if (memberRate) setParticipantRateId(memberRate.id);
  };

  const beginOpen = (table: Table) => {
    if (table.blocked) return;
    if (table.openSession?.id) {
      setSelectedSessionId(table.openSession.id);
      return;
    }
    setOpeningTable(table);
    setSelectedSessionId('');
    setParticipants([]);
    setMemberSearch('');
    setSelectedMember(null);
    setParticipantRateId(activeRates[0]?.id ?? '');
  };

  const inputStyle = [
    styles.input,
    {
      borderColor: colors.border,
      color: colors.text,
      backgroundColor: colors.surface,
    },
  ];

  return (
    <ScreenContainer>
      <ScreenHeader
        title="Board Game"
        subtitle={`${session?.branch.name ?? '-'} · โต๊ะ เวลา ผู้เล่น และเกม`}
      />
      <ScrollView
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        {workspace.loading && !data ? (
          <Card>
            <Text style={[typography.body, { color: colors.textMuted }]}>
              กำลังโหลดผังโต๊ะ...
            </Text>
          </Card>
        ) : null}
        {workspace.error && !data ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              โหลดข้อมูล Board Game ไม่สำเร็จ
            </Text>
            <Button
              label="ลองใหม่"
              variant="secondary"
              onPress={() => workspace.refetch()}
            />
          </Card>
        ) : null}
        {selectedSessionId && !selectedSession && sessionQuery.loading ? (
          <Card>
            <Text style={[typography.body, { color: colors.textMuted }]}>
              กำลังโหลดรายละเอียดโต๊ะ...
            </Text>
          </Card>
        ) : null}
        {selectedSessionId && !selectedSession && sessionQuery.error ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              เปิดรายละเอียดโต๊ะไม่สำเร็จ
            </Text>
            <Button
              label="กลับผัง"
              variant="secondary"
              onPress={() => setSelectedSessionId('')}
            />
          </Card>
        ) : null}
        {openingTable ? (
          <Card style={{ gap: spacing.md }}>
            <View style={styles.between}>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                เปิด {openingTable.code} · {openingTable.name}
              </Text>
              <Button
                label="ปิด"
                variant="ghost"
                onPress={() => setOpeningTable(null)}
              />
            </View>
            <View style={styles.wrap}>
              <Button
                label="ไม่กำหนดเวลา"
                variant={billingMode === 'OPEN_ENDED' ? 'primary' : 'secondary'}
                onPress={() => setBillingMode('OPEN_ENDED')}
              />
              <Button
                label="กำหนดเวลา"
                variant={
                  billingMode === 'FIXED_DURATION' ? 'primary' : 'secondary'
                }
                onPress={() => setBillingMode('FIXED_DURATION')}
              />
            </View>
            {billingMode === 'FIXED_DURATION' ? (
              <View style={styles.row}>
                <TextInput
                  value={durationMinutes}
                  onChangeText={setDurationMinutes}
                  placeholder="นาทีที่ซื้อ"
                  placeholderTextColor={colors.textSoft}
                  keyboardType="number-pad"
                  style={[inputStyle, styles.flex]}
                />
                <TextInput
                  value={alertBeforeMinutes}
                  onChangeText={setAlertBeforeMinutes}
                  placeholder="เตือนก่อน"
                  placeholderTextColor={colors.textSoft}
                  keyboardType="number-pad"
                  style={[inputStyle, styles.flex]}
                />
              </View>
            ) : null}
            <Text style={[typography.bodyStrong, { color: colors.text }]}>
              ผู้เล่นและกลุ่มบิล
            </Text>
            <View style={styles.wrap}>
              {activeRates.map(rate => (
                <Button
                  key={rate.id}
                  label={`${rate.name} ฿${rate.pricePerHour}/ชม.`}
                  variant={
                    participantRateId === rate.id ? 'primary' : 'secondary'
                  }
                  onPress={() => setParticipantRateId(rate.id)}
                />
              ))}
            </View>
            {activeRates.length === 0 ? (
              <Text
                style={[typography.captionStrong, { color: colors.danger }]}
              >
                ยังไม่มีอัตราค่าบริการที่เปิดใช้ กรุณาตั้งค่าจาก Admin
              </Text>
            ) : null}
            <TextInput
              value={memberSearch}
              onChangeText={value => {
                setMemberSearch(value);
                setSelectedMember(null);
              }}
              placeholder="ค้นหาสมาชิกด้วยชื่อ เลขสมาชิก หรือเบอร์โทร"
              placeholderTextColor={colors.textSoft}
              style={inputStyle}
            />
            {memberSearch.trim().length >= 3 && !selectedMember ? (
              <View style={styles.wrap}>
                {(members.data?.bmsPosMemberSearch.members ?? [])
                  .slice(0, 5)
                  .map(member => (
                    <Button
                      key={member.customerId}
                      label={`${member.name}${
                        member.memberNo ? ` · ${member.memberNo}` : ''
                      }`}
                      variant="secondary"
                      onPress={() => chooseMember(member)}
                    />
                  ))}
              </View>
            ) : null}
            {selectedMember ? (
              <Text
                style={[typography.captionStrong, { color: colors.success }]}
              >
                สมาชิกที่เลือก: {selectedMember.name}
                {selectedMember.memberNo ? ` · ${selectedMember.memberNo}` : ''}
              </Text>
            ) : null}
            <View style={styles.row}>
              <TextInput
                value={participantName}
                onChangeText={setParticipantName}
                placeholder="ชื่อเรียก (ไม่บังคับ)"
                placeholderTextColor={colors.textSoft}
                style={[inputStyle, styles.flex]}
              />
              <TextInput
                value={participantGroup}
                onChangeText={setParticipantGroup}
                placeholder="กลุ่มบิล"
                placeholderTextColor={colors.textSoft}
                keyboardType="number-pad"
                style={[inputStyle, styles.groupInput]}
              />
            </View>
            <Button
              label="เพิ่มผู้เล่น"
              variant="secondary"
              disabled={!participantRateId}
              onPress={addDraftParticipant}
            />
            {participants.map((participant, index) => {
              const rate = activeRates.find(
                item => item.id === participant.rateId,
              );
              return (
                <View key={participant.key} style={styles.between}>
                  <Text
                    style={[typography.body, { color: colors.text, flex: 1 }]}
                  >
                    {participant.displayName || `ผู้เล่น ${index + 1}`}
                    {participant.memberNo
                      ? ` · ${participant.memberNo}`
                      : ''} · {rate?.name ?? '-'} · บิล{' '}
                    {participant.billingGroupNo}
                  </Text>
                  <Button
                    label="ลบ"
                    variant="ghost"
                    onPress={() =>
                      setParticipants(rows =>
                        rows.filter(item => item.key !== participant.key),
                      )
                    }
                  />
                </View>
              );
            })}
            <TextInput
              value={sessionNote}
              onChangeText={setSessionNote}
              placeholder="หมายเหตุโต๊ะ"
              placeholderTextColor={colors.textSoft}
              style={inputStyle}
            />
            <Button
              label="เริ่มจับเวลา"
              fullWidth
              loading={working === `open-${openingTable.id}`}
              disabled={
                participants.length === 0 ||
                (billingMode === 'FIXED_DURATION' &&
                  Number(durationMinutes) <= 0)
              }
              onPress={() =>
                run(`open-${openingTable.id}`, async () => {
                  const response = await openSession({
                    variables: {
                      input: {
                        ...inputCredentials,
                        idempotencyKey: retryKey(`open-${openingTable.id}`),
                        tableId: openingTable.id,
                        billingMode,
                        expectedDurationMinutes:
                          billingMode === 'FIXED_DURATION'
                            ? Number(durationMinutes)
                            : null,
                        alertBeforeMinutes: Number(alertBeforeMinutes),
                        note: sessionNote.trim() || null,
                        participants: participants.map(item => ({
                          rateId: item.rateId,
                          customerId: item.customerId,
                          displayName: item.displayName || null,
                          participantType: item.participantType,
                          billingGroupNo: item.billingGroupNo,
                        })),
                      },
                    },
                  });
                  const result = response.data?.bmsPosOpenBoardGameSession;
                  const id = result?.id ?? result?.sessionId;
                  if (!id) throw new Error('เปิดโต๊ะไม่สำเร็จ');
                  setOpeningTable(null);
                  setSelectedSessionId(id);
                })
              }
            />
          </Card>
        ) : null}

        {selectedSession ? (
          <Card style={{ gap: spacing.md }}>
            <View style={styles.between}>
              <View style={styles.flex}>
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  {selectedTable?.code ?? ''} ·{' '}
                  {selectedTable?.name ?? 'โต๊ะบอร์ดเกม'}
                </Text>
                <Text
                  style={[
                    typography.captionStrong,
                    {
                      color: ['OVERDUE', 'ENDING_SOON'].includes(
                        selectedSession.alertStatus,
                      )
                        ? colors.warning
                        : colors.success,
                    },
                  ]}
                >
                  {alertLabel(
                    selectedSession.status === 'CLOSING'
                      ? 'CLOSING'
                      : selectedSession.alertStatus,
                  )}{' '}
                  · {elapsedLabel(selectedSession.startedAt, now)}
                </Text>
              </View>
              <Button
                label="กลับผัง"
                variant="ghost"
                onPress={() => setSelectedSessionId('')}
              />
            </View>
            {selectedSession.expectedEndAt ? (
              <Text style={[typography.body, { color: colors.text }]}>
                หมดเวลา{' '}
                {new Date(selectedSession.expectedEndAt).toLocaleTimeString(
                  'th-TH',
                  { hour: '2-digit', minute: '2-digit' },
                )}{' '}
                · เตือนก่อน {selectedSession.alertBeforeMinutes} นาที
              </Text>
            ) : null}
            {selectedSession.status === 'CLOSING' ? (
              <>
                <Text style={[typography.numeric, { color: colors.text }]}>
                  ฿{selectedSession.amountDue.toFixed(2)}
                </Text>
                <Button
                  label="ไปชำระเงิน"
                  fullWidth
                  onPress={() =>
                    navigation
                      .getParent<any>()
                      ?.navigate('SellTab', {
                        screen: 'Checkout',
                        params: {
                          source: 'board_game',
                          boardGameSessionId: selectedSession.id,
                        },
                      })
                  }
                />
              </>
            ) : (
              <>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  ผู้เล่น
                </Text>
                {selectedSession.participants.map((participant, index) => (
                  <View key={participant.id} style={styles.between}>
                    <Text
                      style={[
                        typography.body,
                        {
                          color: participant.leftAt
                            ? colors.textMuted
                            : colors.text,
                          flex: 1,
                        },
                      ]}
                    >
                      {participant.displayName || `ผู้เล่น ${index + 1}`} ·{' '}
                      {participant.participantType ?? '-'} · ฿
                      {(participant.hourlyRate ?? 0).toFixed(2)}/ชม. · บิล{' '}
                      {participant.billingGroupNo ?? 1}
                      {participant.leftAt ? ' · ออกแล้ว' : ''}
                    </Text>
                    {!participant.leftAt ? (
                      <Button
                        label="ออก"
                        variant="ghost"
                        loading={working === `leave-${participant.id}`}
                        onPress={() =>
                          run(`leave-${participant.id}`, async () => {
                            await leaveParticipant({
                              variables: {
                                input: {
                                  ...inputCredentials,
                                  idempotencyKey: retryKey(
                                    `leave-${participant.id}`,
                                  ),
                                  sessionId: selectedSession.id,
                                  participantId: participant.id,
                                },
                              },
                            });
                          })
                        }
                      />
                    ) : null}
                  </View>
                ))}
                <View style={styles.wrap}>
                  {activeRates.map(rate => (
                    <Button
                      key={rate.id}
                      label={rate.name}
                      variant={
                        participantRateId === rate.id ? 'primary' : 'secondary'
                      }
                      onPress={() => setParticipantRateId(rate.id)}
                    />
                  ))}
                </View>
                <TextInput
                  value={memberSearch}
                  onChangeText={value => {
                    setMemberSearch(value);
                    setSelectedMember(null);
                  }}
                  placeholder="ค้นหาสมาชิกด้วยชื่อ เลขสมาชิก หรือเบอร์โทร"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />
                {memberSearch.trim().length >= 3 && !selectedMember ? (
                  <View style={styles.wrap}>
                    {(members.data?.bmsPosMemberSearch.members ?? [])
                      .slice(0, 5)
                      .map(member => (
                        <Button
                          key={member.customerId}
                          label={`${member.name}${
                            member.memberNo ? ` · ${member.memberNo}` : ''
                          }`}
                          variant="secondary"
                          onPress={() => chooseMember(member)}
                        />
                      ))}
                  </View>
                ) : null}
                {selectedMember ? (
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.success },
                    ]}
                  >
                    สมาชิกที่เลือก: {selectedMember.name}
                    {selectedMember.memberNo
                      ? ` · ${selectedMember.memberNo}`
                      : ''}
                  </Text>
                ) : null}
                <View style={styles.row}>
                  <TextInput
                    value={participantName}
                    onChangeText={setParticipantName}
                    placeholder="ชื่อผู้เล่นเพิ่ม"
                    placeholderTextColor={colors.textSoft}
                    style={[inputStyle, styles.flex]}
                  />
                  <TextInput
                    value={participantGroup}
                    onChangeText={setParticipantGroup}
                    placeholder="กลุ่ม"
                    placeholderTextColor={colors.textSoft}
                    keyboardType="number-pad"
                    style={[inputStyle, styles.groupInput]}
                  />
                  <Button
                    label="เพิ่ม"
                    disabled={!participantRateId}
                    loading={
                      working === `add-participant-${selectedSession.id}`
                    }
                    onPress={() =>
                      run(`add-participant-${selectedSession.id}`, async () => {
                        const rate = activeRates.find(
                          item => item.id === participantRateId,
                        );
                        if (!rate) throw new Error('เลือกอัตราค่าบริการ');
                        await addParticipant({
                          variables: {
                            input: {
                              ...inputCredentials,
                              idempotencyKey: retryKey(
                                `add-participant-${selectedSession.id}`,
                              ),
                              sessionId: selectedSession.id,
                              rateId: rate.id,
                              customerId: selectedMember?.customerId ?? null,
                              displayName: participantName.trim() || null,
                              participantType: rate.customerType,
                              billingGroupNo: Number(participantGroup),
                            },
                          },
                        });
                        setParticipantName('');
                        setMemberSearch('');
                        setSelectedMember(null);
                      })
                    }
                  />
                </View>

                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  เกมที่ยืม
                </Text>
                {selectedSession.games
                  .filter(game => game.status === 'CHECKED_OUT')
                  .map(game => (
                    <View key={game.id} style={styles.between}>
                      <Text
                        style={[
                          typography.body,
                          { color: colors.text, flex: 1 },
                        ]}
                      >
                        {game.title} · {game.copyCode}
                      </Text>
                      <View style={styles.wrap}>
                        <Button
                          label="คืนปกติ"
                          variant="secondary"
                          loading={working === `return-${game.id}`}
                          onPress={() =>
                            run(`return-${game.id}`, async () => {
                              await returnCopy({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    idempotencyKey: retryKey(
                                      `return-${game.id}`,
                                    ),
                                    loanId: game.id,
                                    status: 'RETURNED',
                                    copyStatus: 'AVAILABLE',
                                    returnNote: returnNote.trim() || null,
                                  },
                                },
                              });
                              setReturnNote('');
                            })
                          }
                        />
                        <Button
                          label="มีปัญหา"
                          variant="danger"
                          onPress={() =>
                            run(`issue-${game.id}`, async () => {
                              await returnCopy({
                                variables: {
                                  input: {
                                    ...inputCredentials,
                                    idempotencyKey: retryKey(
                                      `issue-${game.id}`,
                                    ),
                                    loanId: game.id,
                                    status: 'ISSUE',
                                    copyStatus: 'NEEDS_CHECK',
                                    returnNote:
                                      returnNote.trim() ||
                                      'พนักงานระบุว่าต้องตรวจกล่อง',
                                  },
                                },
                              });
                              setReturnNote('');
                            })
                          }
                        />
                      </View>
                    </View>
                  ))}
                <TextInput
                  value={returnNote}
                  onChangeText={setReturnNote}
                  placeholder="หมายเหตุสภาพเกมตอนคืน"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />
                <ScrollView
                  horizontal
                  // ค่าปริยายของ RN คือ flexGrow: 1 — วันนี้อยู่ใน ScrollView แนวตั้งจึงไม่มีที่ให้ขยาย
                  // แต่ประกาศไว้ให้ตรงกับเจตนา ไม่ใช่รอดเพราะบังเอิญ
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={styles.horizontalList}
                >
                  {availableCopies.map(copy => (
                    <Button
                      key={copy.id}
                      label={`${copy.title} · ${copy.copyCode}`}
                      variant="secondary"
                      loading={working === `loan-${copy.id}`}
                      onPress={() =>
                        run(`loan-${copy.id}`, async () => {
                          await checkoutCopy({
                            variables: {
                              input: {
                                ...inputCredentials,
                                idempotencyKey: retryKey(`loan-${copy.id}`),
                                sessionId: selectedSession.id,
                                copyId: copy.id,
                              },
                            },
                          });
                        })
                      }
                    />
                  ))}
                </ScrollView>
                {availableCopies.length === 0 ? (
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    ไม่มีกล่องเกมที่พร้อมยืมในสาขานี้
                  </Text>
                ) : null}

                <TextInput
                  value={cancelReason}
                  onChangeText={setCancelReason}
                  placeholder="เหตุผลยกเลิก session (กรอกเมื่อต้องยกเลิก)"
                  placeholderTextColor={colors.textSoft}
                  style={inputStyle}
                />

                <View style={styles.wrap}>
                  {selectedSession.billingMode === 'FIXED_DURATION' ? (
                    <Button
                      label="เพิ่มเวลา 30 นาที"
                      variant="secondary"
                      loading={working === `extend-${selectedSession.id}`}
                      onPress={() =>
                        run(`extend-${selectedSession.id}`, async () => {
                          const start = new Date(
                            selectedSession.startedAt,
                          ).getTime();
                          const end = new Date(
                            selectedSession.expectedEndAt ??
                              selectedSession.startedAt,
                          ).getTime();
                          const currentMinutes = Math.max(
                            1,
                            Math.round((end - start) / 60000),
                          );
                          await adjustTiming({
                            variables: {
                              input: {
                                ...inputCredentials,
                                idempotencyKey: retryKey(
                                  `extend-${selectedSession.id}`,
                                ),
                                sessionId: selectedSession.id,
                                billingMode: 'FIXED_DURATION',
                                expectedDurationMinutes: currentMinutes + 30,
                                alertBeforeMinutes:
                                  selectedSession.alertBeforeMinutes,
                              },
                            },
                          });
                        })
                      }
                    />
                  ) : null}
                  <Button
                    label="ปิดเวลา/คิดเงิน"
                    loading={working === `close-session-${selectedSession.id}`}
                    onPress={() =>
                      Alert.alert(
                        'ปิดเวลาและคิดเงิน',
                        'ระบบจะ freeze ค่าเวลาตามผู้เล่นและอัตราปัจจุบัน หลังจากนี้แก้รายการไม่ได้',
                        [
                          { text: 'กลับ' },
                          {
                            text: 'ยืนยัน',
                            onPress: () => {
                              run(
                                `close-session-${selectedSession.id}`,
                                async () => {
                                  const response = await closeSession({
                                    variables: {
                                      input: {
                                        ...inputCredentials,
                                        idempotencyKey: retryKey(
                                          `close-session-${selectedSession.id}`,
                                        ),
                                        sessionId: selectedSession.id,
                                        reason: null,
                                      },
                                    },
                                  });
                                  const bill =
                                    response.data?.bmsPosCloseBoardGameSession;
                                  if (!bill?.sessionId)
                                    throw new Error('ปิดเวลาไม่สำเร็จ');
                                  navigation
                                    .getParent<any>()
                                    ?.navigate('SellTab', {
                                      screen: 'Checkout',
                                      params: {
                                        source: 'board_game',
                                        boardGameSessionId: bill.sessionId,
                                      },
                                    });
                                },
                              );
                            },
                          },
                        ],
                      )
                    }
                  />
                  <Button
                    label="ยกเลิก session"
                    variant="danger"
                    disabled={!cancelReason.trim()}
                    onPress={() =>
                      Alert.alert('ยกเลิก session', cancelReason.trim(), [
                        { text: 'กลับ' },
                        {
                          text: 'ยืนยันยกเลิก',
                          style: 'destructive',
                          onPress: () => {
                            run(
                              `cancel-session-${selectedSession.id}`,
                              async () => {
                                await cancelSession({
                                  variables: {
                                    input: {
                                      ...inputCredentials,
                                      idempotencyKey: retryKey(
                                        `cancel-session-${selectedSession.id}`,
                                      ),
                                      sessionId: selectedSession.id,
                                      reason: cancelReason.trim(),
                                    },
                                  },
                                });
                                setCancelReason('');
                                setSelectedSessionId('');
                              },
                            );
                          },
                        },
                      ])
                    }
                  />
                </View>
              </>
            )}
          </Card>
        ) : null}

        {!selectedSessionId && !openingTable
          ? (data?.floor.areas ?? []).map(area => (
              <View key={area.id} style={{ gap: spacing.sm }}>
                <Text style={[typography.subtitle, { color: colors.text }]}>
                  {area.name}
                </Text>
                <View style={styles.tableGrid}>
                  {data?.floor.tables
                    .filter(table => table.areaId === area.id)
                    .map(table => {
                      const alertStatus = table.openSession?.alertStatus;
                      const tone = table.blocked
                        ? colors.textMuted
                        : alertStatus === 'OVERDUE'
                        ? colors.danger
                        : alertStatus === 'ENDING_SOON'
                        ? colors.warning
                        : table.openSession
                        ? colors.primary
                        : colors.success;
                      return (
                        <Card
                          key={table.id}
                          style={{ ...styles.tableCard, borderColor: tone }}
                          elevated={false}
                        >
                          <Text
                            style={[
                              typography.subtitle,
                              { color: colors.text },
                            ]}
                          >
                            {table.code}
                          </Text>
                          <Text
                            style={[
                              typography.caption,
                              { color: colors.textMuted },
                            ]}
                          >
                            {table.name} · {table.seats} ที่นั่ง
                          </Text>
                          <Text
                            style={[typography.captionStrong, { color: tone }]}
                          >
                            {table.blocked
                              ? 'ปิดใช้'
                              : table.openSession
                              ? `${alertLabel(alertStatus)} · ${elapsedLabel(
                                  table.openSession.startedAt,
                                  now,
                                )}`
                              : 'ว่าง'}
                          </Text>
                          <Button
                            label={
                              table.openSession ? 'เปิดรายละเอียด' : 'เปิดโต๊ะ'
                            }
                            variant={
                              table.openSession ? 'secondary' : 'primary'
                            }
                            disabled={table.blocked}
                            onPress={() => beginOpen(table)}
                            fullWidth
                          />
                        </Card>
                      );
                    })}
                </View>
              </View>
            ))
          : null}
        {!selectedSessionId &&
        !openingTable &&
        data &&
        data.floor.tables.length === 0 ? (
          <Card>
            <Text style={[typography.body, { color: colors.textMuted }]}>
              ยังไม่มีโต๊ะ Board Game ในสาขานี้ กรุณาตั้งค่าผังจาก Admin
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  groupInput: { width: 76 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  horizontalList: { gap: 8, paddingVertical: 4 },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tableCard: { width: '48%', minWidth: 156, gap: 8 },
});
