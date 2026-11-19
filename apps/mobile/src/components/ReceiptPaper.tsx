import { createPosTranslator } from '../../../web/i18n/posClient';
import { receiptLabel, receiptLocale, posPaymentMethodLabel, type ReceiptLanguageMode } from '../../../web/lib/pos/receiptI18n';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { MobilePosReceiptFieldsFragment } from '../graphql/generated';

const thai = createPosTranslator('th');
const english = createPosTranslator('en');

type Receipt = MobilePosReceiptFieldsFragment;

function money(amount: number) {
  return `${amount < 0 ? '−' : ''}฿${Math.abs(amount).toFixed(2)}`;
}


function AmountRow({
  label,
  amount,
  strong = false,
}: {
  label: string;
  amount: number;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.text, styles.label, strong && styles.strong]}>
        {label}
      </Text>
      <Text style={[styles.text, styles.amount, strong && styles.strong]}>
        {money(amount)}
      </Text>
    </View>
  );
}

export function ReceiptPaper({ receipt, languageMode = 'th' }: { receipt: Receipt; languageMode?: ReceiptLanguageMode }) {
  const receiptText = (source: string, values?: Record<string, unknown>) =>
    receiptLabel(languageMode, thai(source, values), english(source, values));
  const reversed =
    Boolean(receipt.voidedAt) || receipt.orderStatus === 'CANCELLED';
  const returned =
    receipt.returnEvents.length > 0 || receipt.orderStatus === 'RETURNED';
  const receiptNumber = receipt.receiptNo ?? receipt.billNo;
  const payments = receipt.payments.length
    ? receipt.payments
    : receipt.paymentMethod
    ? [
        {
          id: 'legacy',
          method: receipt.paymentMethod,
          amount: receipt.total,
          cashTendered: receipt.cashTendered,
          cashChange: receipt.cashChange,
        },
      ]
    : [];

  return (
    <View style={styles.paper} testID="receipt-paper">
      <Text style={[styles.heading, styles.center]}>{receiptText("ใบเสร็จรับเงิน")}</Text>
      {receipt.locationName ? (
        <Text style={[styles.text, styles.center]}>{receipt.locationName}</Text>
      ) : null}
      {receipt.branchCode ? (
        <Text style={[styles.small, styles.center]}>
          {receiptText("สาขา") + " "}{receipt.branchCode}
        </Text>
      ) : null}
      {receipt.pickupQueueLabel ? (
        <View style={[styles.section, { alignItems: 'center' }]} testID="receipt-pickup-queue">
          <Text style={[styles.text, styles.center]}>{receiptText("คิวของคุณ")}</Text>
          <Text style={[styles.heading, styles.center, styles.queueNumber]}>
            {receipt.pickupQueueLabel}
          </Text>
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.text}>
          {receiptNumber
            ? receiptText("เลขที่ {v0}", { v0: receiptNumber })
            : receiptText("เลขอ้างอิงรายการ {v0}", { v0: receipt.orderId })}
        </Text>
        <Text style={styles.small}>
          {new Date(receipt.soldAt).toLocaleString(receiptLocale(languageMode), {
            timeZone: 'Asia/Bangkok',
          })}
        </Text>
        {receipt.posLabel ? (
          <Text style={styles.small}>{receiptText("เครื่องขาย") + " "}{receipt.posLabel}</Text>
        ) : null}
        {receipt.cashierName ? (
          <Text style={styles.small}>{receiptText("พนักงาน") + " "}{receipt.cashierName}</Text>
        ) : null}
        {receipt.memberName ? (
          <Text style={styles.small}>
            {receiptText("สมาชิก") + " "}{receipt.memberName}
            {receipt.memberNo ? ` · ${receipt.memberNo}` : ''}
          </Text>
        ) : null}
        {receipt.restaurantServiceMode ? (
          <Text style={styles.small}>
            {receipt.restaurantServiceMode === 'TAKEAWAY'
              ? receiptText("กลับบ้าน")
              : receiptText("กินในร้าน")}
          </Text>
        ) : null}
        {receipt.offlineTenderedAt ? (
          <Text style={styles.small}>{receiptText("รับเงินออฟไลน์ · ซิงก์สำเร็จแล้ว")}</Text>
        ) : null}
      </View>
      {reversed || returned ? (
        <Text style={styles.status}>
          {reversed ? receiptText("ยกเลิกบิลแล้ว") : receiptText("บิลนี้มีรายการคืนสินค้า")}
        </Text>
      ) : null}
      <View style={styles.section}>
        {receipt.lines.map(line => (
          <View key={line.orderItemId} style={styles.item}>
            <AmountRow label={line.receiptName} amount={line.lineTotal} />
            <Text style={styles.small}>
              {line.packQty} {line.unitName} × {money(line.packPrice)}
              {line.size ? ` · ${line.size}` : ''}
            </Text>
          </View>
        ))}
        {receipt.extraLines?.map((line, index) => (
          <AmountRow
            key={`extra-${index}`}
            label={`${line.label} × ${line.qty}`}
            amount={line.amount}
          />
        ))}
        {receipt.discountLines.map((line, index) => (
          <AmountRow
            key={`discount-${index}`}
            label={line.label}
            amount={-line.amount}
          />
        ))}
        {receipt.roundingAmount !== 0 ? (
          <AmountRow label={receiptText("ปัดเศษเงินสด")} amount={receipt.roundingAmount} />
        ) : null}
      </View>
      <View style={styles.section}>
        <AmountRow label={receiptText("ยอดสุทธิ")} amount={receipt.total} strong />
        {receipt.vat ? (
          <>
            <AmountRow label={receiptText("ยอดก่อน VAT")} amount={receipt.vat.netBeforeVat} />
            <AmountRow
              label={`VAT ${receipt.vat.rate}%`}
              amount={receipt.vat.vatAmount}
            />
            {receipt.vat.exemptAmount > 0 ? (
              <AmountRow
                label={receiptText("ยอดยกเว้น VAT")}
                amount={receipt.vat.exemptAmount}
              />
            ) : null}
          </>
        ) : null}
      </View>
      <View style={styles.section}>
        {payments.map(payment => (
          <View key={payment.id}>
            <AmountRow
              label={posPaymentMethodLabel(payment.method, languageMode)}
              amount={payment.amount}
            />
            {payment.cashTendered != null ? (
              <AmountRow label={receiptText("รับเงินสด")} amount={payment.cashTendered} />
            ) : null}
            {payment.cashChange != null ? (
              <AmountRow label={receiptText("เงินทอน")} amount={payment.cashChange} />
            ) : null}
          </View>
        ))}
      </View>
      {[
        ...(receipt.promotionNotes ?? []),
        ...(receipt.boardGameTimeNotes ?? []),
      ].map((note, index) => (
        <Text key={`note-${index}`} style={styles.small}>
          {note}
        </Text>
      ))}
      {receipt.returnEvents.map(event => (
        <View key={event.id} style={styles.section}>
          <AmountRow
            label={event.isVoid ? receiptText("ยกเลิกบิล") : receiptText("คืนสินค้า")}
            amount={event.refundAmount}
          />
          <Text style={styles.small}>
            {new Date(event.returnedAt).toLocaleString(receiptLocale(languageMode), {
              timeZone: 'Asia/Bangkok',
            })}
          </Text>
          <Text style={styles.small}>
            {event.settlementStatus === 'COMPLETED'
              ? receiptText("คืนเงินครบแล้ว")
              : receiptText("รอดำเนินการคืนเงิน")}
          </Text>
        </View>
      ))}
      {receipt.taxRequestUrl && !reversed && !returned ? (
        <View style={styles.qr}>
          <Text style={[styles.text, styles.center]}>
            {receiptText("สแกนขอใบกำกับภาษีเต็มรูป") + " "}</Text>
          <QRCode
            value={receipt.taxRequestUrl}
            size={160}
            quietZone={12}
            ecl="M"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  queueNumber: { fontSize: 40, lineHeight: 46 },
  paper: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d5d8dc',
    borderRadius: 4,
  },
  heading: {
    fontSize: 19,
    lineHeight: 27,
    fontWeight: '700',
    color: '#16191d',
  },
  text: { fontSize: 15, lineHeight: 22, color: '#16191d' },
  small: { fontSize: 13, lineHeight: 20, color: '#52575e' },
  center: { textAlign: 'center' },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#b7bec6',
    paddingTop: 12,
    marginTop: 12,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  label: { flexGrow: 1, flexShrink: 1, flexBasis: '50%' },
  amount: {
    maxWidth: '100%',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  strong: { fontWeight: '700', fontSize: 17, lineHeight: 24 },
  item: { marginBottom: 8 },
  status: {
    color: '#ad2929',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    marginTop: 12,
  },
  qr: { alignItems: 'center', gap: 12, paddingTop: 20 },
});
