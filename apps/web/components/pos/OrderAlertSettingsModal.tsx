"use client";

import { Alert, Button, Modal, Select, Slider, Switch } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import type { OrderAlertsApi } from "@/app/hooks/useOrderAlerts";
import { ALERT_TONE_IDS, type AlertKind, type AlertToneId } from "@/lib/pos/orderAlertSound";

/**
 * หน้าตั้งค่าเสียงเตือนของ "เครื่องนี้" — ใช้ร่วมกันระหว่างจอครัวที่เครื่องขายกับจอครัวหลังบ้าน
 *
 * ⚠️ คุณค่าจริงของหน้านี้ไม่ใช่ "เลือกเสียงที่ชอบ" แต่คือสามอย่าง:
 *   1. แยกเสียงตามงาน — ครัวได้ยินเสียงเดียวทั้งวันจะเลิกแยกออกว่าอะไรคืออะไร
 *   2. แยกเสียงจากเครื่องอื่นในร้าน (เครื่องรูดบัตร/ไลน์/กระดิ่ง) ที่ดังอยู่ก่อนแล้ว
 *   3. **ปุ่มฟังตัวอย่างคือสิ่งที่ปลดล็อกเสียงของเบราว์เซอร์** และตอบว่า "ลำโพงต่ออยู่ไหม
 *      ดังพอไหม" ได้ตั้งแต่ก่อนเปิดร้าน ไม่ใช่ตอนออร์เดอร์เข้ามาแล้วเงียบ
 *
 * รับ `kinds` มาเพื่อแสดงเฉพาะเหตุการณ์ที่ "จอนี้เห็นจริง" — ตัวเลือกที่ตั้งแล้วไม่มีผล
 * บนหน้าที่กำลังเปิดอยู่คือคำโกหกที่ทำให้คนเลิกเชื่อหน้าตั้งค่าทั้งหน้า
 */
export default function OrderAlertSettingsModal({
  open, onClose, alerts, kinds,
}: {
  open: boolean;
  onClose: () => void;
  alerts: OrderAlertsApi;
  kinds: readonly AlertKind[];
}) {
  const { t } = useI18n();
  const { settings } = alerts;

  const toneOptions = ALERT_TONE_IDS.map((id) => ({ value: id, label: t(`pos_alerts.tone_${id.toLowerCase()}`) }));
  const repeatOptions = [0, 10, 20, 30, 60, 120].map((seconds) => ({
    value: seconds,
    label: seconds === 0 ? t("pos_alerts.repeat_off") : t("pos_alerts.repeat_every", { seconds }),
  }));

  return <Modal
    open={open}
    onCancel={onClose}
    title={t("pos_alerts.title")}
    footer={<Button type="primary" onClick={onClose}>{t("pos_alerts.done")}</Button>}
    destroyOnClose
    width={520}
  >
    <p style={{ marginTop: 0, opacity: 0.75 }}>{t("pos_alerts.device_scope")}</p>

    {alerts.blocked && <Alert
      closable
      type="warning"
      showIcon
      style={{ marginBottom: 12 }}
      message={t("pos_alerts.blocked_title")}
      description={t("pos_alerts.blocked_desc")}
      action={<Button size="small" onClick={() => alerts.preview(settings.tones.ORDER_NEW)}>{t("pos_alerts.blocked_action")}</Button>}
    />}

    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0" }}>
      <span>{t("pos_alerts.enabled")}</span>
      <Switch checked={settings.enabled} onChange={(checked) => alerts.update({ enabled: checked })} />
    </label>

    <div style={{ padding: "8px 0", opacity: settings.enabled ? 1 : 0.45 }}>
      <div style={{ marginBottom: 4 }}>{t("pos_alerts.volume")}</div>
      <Slider
        min={0}
        max={100}
        disabled={!settings.enabled}
        value={Math.round(settings.volume * 100)}
        // ปล่อยเสียงตัวอย่างตอนปล่อยนิ้ว ไม่ใช่ทุกก้าวที่ลาก — ไม่งั้นได้เสียงรัวเป็นสิบครั้ง
        onChangeComplete={(value) => { alerts.update({ volume: Number(value) / 100 }); alerts.preview(settings.tones.ORDER_NEW); }}
        onChange={(value) => alerts.update({ volume: Number(value) / 100 })}
      />
    </div>

    <div style={{ opacity: settings.enabled ? 1 : 0.45 }}>
      {kinds.map((kind) => <div key={kind} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
        <span style={{ flex: 1, minWidth: 0 }}>{t(`pos_alerts.kind_${kind.toLowerCase()}`)}</span>
        <Select
          disabled={!settings.enabled}
          value={settings.tones[kind]}
          options={toneOptions}
          style={{ width: 160 }}
          onChange={(value: AlertToneId) => { alerts.update({ tones: { ...settings.tones, [kind]: value } }); alerts.preview(value); }}
        />
        <Button
          disabled={!settings.enabled || settings.tones[kind] === "NONE"}
          icon={<PlayCircleOutlined />}
          onClick={() => alerts.preview(settings.tones[kind])}
          title={t("pos_alerts.preview")}
          aria-label={t("pos_alerts.preview_of", { kind: t(`pos_alerts.kind_${kind.toLowerCase()}`) })}
        />
      </div>)}
    </div>

    <div style={{ borderTop: "1px solid rgba(128,128,128,.25)", marginTop: 12, paddingTop: 12, opacity: settings.enabled ? 1 : 0.45 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0 }}>{t("pos_alerts.repeat")}</span>
        <Select
          disabled={!settings.enabled}
          value={settings.repeatSeconds}
          options={repeatOptions}
          style={{ width: 160 }}
          onChange={(value: number) => alerts.update({ repeatSeconds: value })}
        />
      </div>
      <p style={{ margin: "6px 0 0", opacity: 0.75, fontSize: 12 }}>{t("pos_alerts.repeat_hint")}</p>
    </div>
  </Modal>;
}
