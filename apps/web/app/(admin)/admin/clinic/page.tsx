"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Button, Calendar, Card, DatePicker, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);
function bangkokInstant(value: unknown): string {
  return dayjs.tz((value as { format(pattern: string): string }).format("YYYY-MM-DD HH:mm:ss"), "Asia/Bangkok").toISOString();
}

type Bootstrap = { location?: { id: string; name: string }; roles: string[];
  practitioners: Array<{ id: string; name: string }>; nurses: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
  staff: Array<{ user_id: string; name: string; access_role: string; active: boolean; licence_no: string | null }> };
type Patient = { id: string; hn: string; fullName: string };
type Contact = { id: string; full_name: string; relationship: string; phone: string | null };
type Appointment = { id: string; patientId: string; patientHn: string; patientName: string;
  practitionerId: string; startsAt: string; endsAt: string; roomCode: string; status: string };
type Encounter = { id: string; patient_id: string; status: string; version: number;
  draft_record: Record<string, string>; notes: Array<{ id: string; note_kind: string; content: Record<string, string>; signed_at: string }> };
type ChargeSheet = { sheet: { id: string; status: string; order_id: string | null; order_status: string | null } | null;
  lines: Array<{ product_sku: string; size: string; qty: number; reviewed_unit_price: string }> };
type BillableEncounter = { id: string; patientHn: string; patientName: string; signedAt: string;
  chargeStatus: string | null; orderId: string | null };

const NOTE_FIELDS = ["chiefComplaint", "history", "allergies", "vitals", "examination",
  "diagnosis", "treatmentPlan", "medicationPlan", "referral"] as const;
const LABELS: Record<string, string> = {
  chiefComplaint: "clinic.chief_complaint", history: "clinic.history",
  allergies: "clinic.allergies", vitals: "clinic.vitals",
  examination: "clinic.examination", diagnosis: "clinic.diagnosis",
  treatmentPlan: "clinic.treatment_plan", medicationPlan: "clinic.medication_plan",
  referral: "clinic.copy_080",
};

async function clinicGet(action: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`/api/bms/clinic?${query}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || data.status !== "OK") throw new Error(data.status || "");
  return data.result;
}
async function clinicPost(action: string, body: Record<string, unknown> = {}) {
  const response = await fetch("/api/bms/clinic", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || data.status !== "OK") throw new Error(data.status || "");
  return data.result;
}

export default function ClinicPilotPage() {
  const { lang, t } = useI18n();
  const en = lang === "en";
  const { can } = useBmsPermissions();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [activeTab, setActiveTab] = useState("patients");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsTruncated, setAppointmentsTruncated] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => dayjs().tz("Asia/Bangkok").startOf("month"));
  const appointmentRequest = useRef<{ signature: string; key: string } | null>(null);
  const rescheduleRequest = useRef<{ signature: string; key: string } | null>(null);
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [record, setRecord] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Array<{ id: string; status: string; created_at: string }>>([]);
  const [charge, setCharge] = useState<ChargeSheet | null>(null);
  const [billingEncounterId, setBillingEncounterId] = useState<string | null>(null);
  const [billingSearch, setBillingSearch] = useState("");
  const [billable, setBillable] = useState<BillableEncounter[]>([]);
  const [billableTruncated, setBillableTruncated] = useState(false);
  const [chargeLines, setChargeLines] = useState<Array<{ sku: string; size: string; qty: number }>>([{ sku: "", size: "STD", qty: 1 }]);
  const [accessEvents, setAccessEvents] = useState<Array<{ actor_user_id: string; source: string; created_at: string }>>([]);
  const [attachments, setAttachments] = useState<Array<{ id: string; file_name: string; byte_size: number }>>([]);
  const [form] = Form.useForm();
  const [appointmentForm] = Form.useForm();
  const [staffForm] = Form.useForm();
  const [contactForm] = Form.useForm();
  const [addendumReason, setAddendumReason] = useState("");
  const [addendumText, setAddendumText] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleForm] = Form.useForm();
  const [nurseId, setNurseId] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (caught) { setError(caught instanceof Error && caught.message ? caught.message : t("clinic.unavailable")); }
    finally { setBusy(false); }
  }, []);
  const loadAppointments = useCallback(async (locationId: string, month = calendarMonth) => {
    const from = month.tz("Asia/Bangkok").startOf("month");
    const to = from.add(1, "month");
    setAppointments([]); setAppointmentsTruncated(false);
    const result: { appointments: Appointment[]; truncated: boolean } = await clinicGet("appointments",
      { locationId, from: from.toISOString(), to: to.toISOString() });
    setAppointments(result.appointments); setAppointmentsTruncated(result.truncated);
  }, [calendarMonth]);
  const loadBillable = useCallback(async (searchTerm = "") => {
    const result: { encounters: BillableEncounter[]; truncated: boolean } =
      await clinicGet("billableEncounters", { search: searchTerm });
    setBillable(result.encounters); setBillableTruncated(result.truncated);
  }, []);
  const loadEncounter = useCallback(async (id: string) => {
    const next: Encounter = await clinicGet("encounter", { encounterId: id });
    setEncounter(next); setRecord(next.draft_record ?? {});
    try { setAttachments(await clinicGet("attachments", { encounterId: id })); }
    catch { setAttachments([]); }
    if (can("clinic.billing.manage") && next.status === "SIGNED") {
      setBillingEncounterId(id);
      setCharge(await clinicGet("chargeSheet", { encounterId: id }));
    }
  }, [can]);
  useEffect(() => {
    void run(async () => {
      const next: Bootstrap = await clinicGet("bootstrap");
      setBootstrap(next);
    });
  }, [run]);
  useEffect(() => {
    if (bootstrap?.location && can("clinic.appointment.manage"))
      void run(() => loadAppointments(bootstrap.location!.id));
  }, [bootstrap?.location, can, loadAppointments, run]);
  useEffect(() => {
    if (can("clinic.billing.manage")) void run(() => loadBillable());
  }, [can, loadBillable, run]);
  useEffect(() => {
    if (can("clinic.patient.read") || can("clinic.patient.register")) return;
    if (can("clinic.billing.manage")) setActiveTab("billing");
    else if (can("clinic.appointment.manage")) setActiveTab("appointments");
    else if (can("clinic.record.read")) setActiveTab("encounters");
    else if (can("clinic.staff.manage") || can("clinic.audit.read")) setActiveTab("admin");
  }, [can]);

  const showPatient = async (next: Patient) => {
    setPatient(next); setEncounter(null); setHistory([]); setCharge(null); setBillingEncounterId(null);
    try { setContacts(await clinicGet("contacts", { patientId: next.id })); }
    catch { setContacts([]); }
    if (can("clinic.record.read")) {
      try { setHistory(await clinicGet("history", { patientId: next.id })); } catch { setHistory([]); }
    }
    if (can("clinic.audit.read")) setAccessEvents(await clinicGet("accessEvents", { patientId: next.id }));
  };
  const searchPatients = () => void run(async () => setPatients(await clinicGet("searchPatients", { search })));
  const createPatient = (values: Record<string, unknown>) => void run(async () => {
    const next: Patient = await clinicPost("registerPatient", values);
    form.resetFields(); setPatients([next]); await showPatient(next);
    message.success(t("clinic.copy_001"));
  });
  const addContact = (values: Record<string, unknown>) => void run(async () => {
    if (!patient) return;
    await clinicPost("addContact", { patientId: patient.id, ...values,
      confirmation: "CONFIRM VERIFIED CONTACT" });
    contactForm.resetFields();
    setContacts(await clinicGet("contacts", { patientId: patient.id }));
  });
  const createAppointment = (values: Record<string, unknown>) => void run(async () => {
    if (!patient || !bootstrap?.location) return;
    const payload = {
      patientId: patient.id, locationId: bootstrap.location.id,
      practitionerId: values.practitionerId, roomCode: values.roomCode,
      startsAt: bangkokInstant(values.startsAt), endsAt: bangkokInstant(values.endsAt),
    };
    const signature = JSON.stringify(payload);
    if (appointmentRequest.current?.signature !== signature)
      appointmentRequest.current = { signature, key: crypto.randomUUID() };
    await clinicPost("createAppointment", { ...payload, requestKey: appointmentRequest.current.key });
    appointmentRequest.current = null;
    appointmentForm.resetFields(); await loadAppointments(bootstrap.location.id);
    message.success(t("clinic.copy_002"));
  });
  const transition = (id: string, action: string) => void run(async () => {
    await clinicPost("appointmentTransition", { appointmentId: id, transition: action });
    if (bootstrap?.location) await loadAppointments(bootstrap.location.id);
  });
  const reschedule = (values: Record<string, unknown>) => void run(async () => {
    if (!rescheduleId) return;
    const payload = { appointmentId: rescheduleId,
      practitionerId: values.practitionerId, roomCode: values.roomCode,
      startsAt: bangkokInstant(values.startsAt), endsAt: bangkokInstant(values.endsAt) };
    const signature = JSON.stringify(payload);
    if (rescheduleRequest.current?.signature !== signature)
      rescheduleRequest.current = { signature, key: crypto.randomUUID() };
    await clinicPost("rescheduleAppointment", { ...payload, requestKey: rescheduleRequest.current.key });
    rescheduleRequest.current = null;
    setRescheduleId(null); rescheduleForm.resetFields();
    if (bootstrap?.location) await loadAppointments(bootstrap.location.id);
  });
  const openEncounter = (id: string) => void run(async () => {
    const result: { id: string } = await clinicPost("openEncounter", { appointmentId: id });
    await loadEncounter(result.id);
  });
  const saveRecord = () => void run(async () => {
    if (!encounter) return;
    await clinicPost("saveDraft", { encounterId: encounter.id, expectedVersion: encounter.version, record });
    await loadEncounter(encounter.id);
    message.success(t("clinic.copy_003"));
  });
  const signRecord = () => void run(async () => {
    if (!encounter) return;
    await clinicPost("signEncounter", { encounterId: encounter.id, expectedVersion: encounter.version,
      confirmation: "SIGN CLINICAL RECORD" });
    await loadEncounter(encounter.id);
  });
  const saveCharges = () => void run(async () => {
    if (!billingEncounterId) return;
    await clinicPost("saveChargeSheet", { encounterId: billingEncounterId, lines: chargeLines });
    setCharge(await clinicGet("chargeSheet", { encounterId: billingEncounterId }));
    await loadBillable(billingSearch);
  });
  const reviewCharges = () => void run(async () => {
    if (!charge?.sheet || !billingEncounterId) return;
    await clinicPost("reviewChargeSheet", { sheetId: charge.sheet.id, confirmation: "CONFIRM CLINIC CHARGES" });
    setCharge(await clinicGet("chargeSheet", { encounterId: billingEncounterId }));
    await loadBillable(billingSearch);
  });
  const createOrder = () => void run(async () => {
    if (!charge?.sheet || !billingEncounterId) return;
    await clinicPost("createChargeOrder", { sheetId: charge.sheet.id, confirmation: "CREATE CLINIC ORDER" });
    setCharge(await clinicGet("chargeSheet", { encounterId: billingEncounterId }));
    await loadBillable(billingSearch);
  });
  const selectBillingEncounter = (id: string) => void run(async () => {
    const next: ChargeSheet = await clinicGet("chargeSheet", { encounterId: id });
    setBillingEncounterId(id); setCharge(next);
    setChargeLines(next.sheet?.status === "DRAFT" && next.lines.length
      ? next.lines.map(line => ({ sku: line.product_sku, size: line.size, qty: line.qty }))
      : [{ sku: "", size: "STD", qty: 1 }]);
  });
  const uploadAttachment = (file: File) => void run(async () => {
    if (!encounter) return;
    const response = await fetch(`/api/bms/clinic/attachments?encounterId=${encodeURIComponent(encounter.id)}`, {
      method: "POST", headers: { "Content-Type": file.type, "x-clinic-file-name": file.name },
      body: file, cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.status ?? "");
    setAttachments(await clinicGet("attachments", { encounterId: encounter.id }));
  });

  const patientTab = <Space direction="vertical" style={{ width: "100%" }}>
    <Card title={t("clinic.copy_004")}>
      <Form form={form} layout="vertical" onFinish={createPatient}>
        <Form.Item name="fullName" label={t("clinic.copy_005")} rules={[{ required: true }]}><Input maxLength={200} /></Form.Item>
        <Space wrap>
          <Form.Item name="dob" label={t("clinic.copy_006")}><Input placeholder={t("clinic.date_format")} /></Form.Item>
          <Form.Item name="sex" label={t("clinic.copy_007")} initialValue="UNKNOWN"><Select style={{ width: 160 }} options={["UNKNOWN", "FEMALE", "MALE", "OTHER"].map(value => ({ value, label: value }))} /></Form.Item>
          <Form.Item name="phone" label={t("clinic.copy_008")}><Input maxLength={40} /></Form.Item>
        </Space>
        <Button type="primary" htmlType="submit" disabled={!can("clinic.patient.register") || busy}>{t("clinic.copy_009")}</Button>
      </Form>
    </Card>
    <Card title={t("clinic.copy_010")}>
      <Space.Compact style={{ width: "100%" }}><Input value={search} onChange={e => setSearch(e.target.value)} onPressEnter={searchPatients} maxLength={100} /><Button onClick={searchPatients} loading={busy}>{t("clinic.copy_011")}</Button></Space.Compact>
      <Table size="small" rowKey="id" pagination={{ pageSize: 10 }} dataSource={patients} columns={[
        { title: t("clinic.hn"), dataIndex: "hn" }, { title: t("clinic.copy_012"), dataIndex: "fullName" },
        { title: "", render: (_, row: Patient) => <Button onClick={() => void run(() => showPatient(row))}>{t("clinic.copy_013")}</Button> },
      ]} />
    </Card>
    {patient && <Card title={`${t("clinic.contacts")} · ${patient.hn}`}>
      <Table<Contact> rowKey="id" size="small" dataSource={contacts} pagination={false} columns={[
        { title: t("clinic.copy_012"), dataIndex: "full_name" },
        { title: t("clinic.relationship"), dataIndex: "relationship" },
        { title: t("clinic.copy_008"), dataIndex: "phone" },
      ]} />
      <Form form={contactForm} layout="vertical" onFinish={addContact}>
        <Space wrap>
          <Form.Item name="fullName" label={t("clinic.copy_012")} rules={[{ required: true }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="relationship" label={t("clinic.relationship")} rules={[{ required: true }]}>
            <Select style={{ width: 160 }} options={["PARENT", "GUARDIAN", "OTHER"].map(value => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="phone" label={t("clinic.copy_008")}><Input maxLength={40} /></Form.Item>
        </Space>
        <Popconfirm title={t("clinic.confirm_contact")} onConfirm={() => contactForm.submit()}>
          <Button disabled={!can("clinic.patient.register")}>{t("clinic.add_contact")}</Button>
        </Popconfirm>
      </Form>
    </Card>}
  </Space>;
  const appointmentTab = <Space direction="vertical" style={{ width: "100%" }}>
    <Card title={t("clinic.copy_014")}>
      <Typography.Text>{patient ? `${patient.hn} · ${patient.fullName}` : t("clinic.copy_015")}</Typography.Text>
      <Form form={appointmentForm} layout="vertical" onFinish={createAppointment}>
        <Space wrap>
          <Form.Item name="practitionerId" label={t("clinic.copy_016")} rules={[{ required: true }]}><Select style={{ width: 220 }} options={bootstrap?.practitioners.map(p => ({ value: p.id, label: p.name }))} /></Form.Item>
          <Form.Item name="roomCode" label={t("clinic.copy_017")} rules={[{ required: true }]}><Input maxLength={40} /></Form.Item>
          <Form.Item name="startsAt" label={t("clinic.copy_018")} rules={[{ required: true }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item name="endsAt" label={t("clinic.copy_019")} rules={[{ required: true }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" /></Form.Item>
        </Space>
        <Button htmlType="submit" type="primary" disabled={!patient || busy}>{t("clinic.copy_020")}</Button>
      </Form>
    </Card>
    <Card title={t("clinic.copy_021")} extra={<Button onClick={() => bootstrap?.location && void run(() => loadAppointments(bootstrap.location!.id))}>{t("clinic.copy_022")}</Button>}>
      {appointmentsTruncated && <div role="alert" style={{ marginBottom: 12 }}>
        <Typography.Text type="warning">{t("clinic.appointments_truncated")}</Typography.Text>
      </div>}
      <Calendar fullscreen={false} value={calendarMonth}
        onPanelChange={date => {
          setCalendarMonth(dayjs.tz(date.format("YYYY-MM-01"), "Asia/Bangkok"));
        }}
        cellRender={(date, info) => {
          if (appointmentsTruncated || info.type !== "date" || date.format("YYYY-MM") !== calendarMonth.format("YYYY-MM")) return null;
          const count = appointments.filter(item => dayjs(item.startsAt).tz("Asia/Bangkok").format("YYYY-MM-DD") === date.format("YYYY-MM-DD")).length;
          return count ? <Tag color="blue">{count}</Tag> : null;
        }} />
      <Table size="small" rowKey="id" scroll={{ x: 900 }} dataSource={appointments} pagination={{ pageSize: 20 }} columns={[
        { title: t("clinic.hn"), dataIndex: "patientHn" }, { title: t("clinic.copy_012"), dataIndex: "patientName" },
        { title: t("clinic.copy_023"), render: (_, row: Appointment) => new Date(row.startsAt).toLocaleString(en ? "en-GB" : "th-TH", { timeZone: "Asia/Bangkok" }) },
        { title: t("clinic.copy_017"), dataIndex: "roomCode" },
        { title: t("clinic.copy_024"), render: (_, row: Appointment) => <Tag>{row.status}</Tag> },
        { title: "", render: (_, row: Appointment) => <Space wrap>
          {row.status === "CONFIRMED" && <><Button onClick={() => transition(row.id, "CHECK_IN")}>{t("clinic.copy_025")}</Button>
            <Button onClick={() => setRescheduleId(row.id)}>{t("clinic.copy_026")}</Button>
            <Popconfirm title={t("clinic.copy_027")} onConfirm={() => transition(row.id, "CANCEL")}><Button danger>{t("clinic.copy_028")}</Button></Popconfirm>
            <Button onClick={() => transition(row.id, "NO_SHOW")}>{t("clinic.no_show")}</Button></>}
          {row.status === "CHECKED_IN" && <Button onClick={() => openEncounter(row.id)}>{t("clinic.copy_029")}</Button>}
        </Space> },
      ]} />
    </Card>
    {rescheduleId && <Card title={t("clinic.copy_030")}>
      <Form form={rescheduleForm} layout="vertical" onFinish={reschedule}>
        <Space wrap>
          <Form.Item name="practitionerId" label={t("clinic.copy_016")} rules={[{ required: true }]}><Select style={{ width: 220 }} options={bootstrap?.practitioners.map(p => ({ value: p.id, label: p.name }))} /></Form.Item>
          <Form.Item name="roomCode" label={t("clinic.copy_017")} rules={[{ required: true }]}><Input maxLength={40} /></Form.Item>
          <Form.Item name="startsAt" label={t("clinic.copy_018")} rules={[{ required: true }]}><DatePicker showTime /></Form.Item>
          <Form.Item name="endsAt" label={t("clinic.copy_019")} rules={[{ required: true }]}><DatePicker showTime /></Form.Item>
        </Space>
        <Space><Button htmlType="submit" type="primary">{t("clinic.copy_031")}</Button><Button onClick={() => setRescheduleId(null)}>{t("clinic.copy_032")}</Button></Space>
      </Form>
    </Card>}
  </Space>;
  const encounterTab = <Space direction="vertical" style={{ width: "100%" }}>
    {patient && <Card title={`${patient.hn} · ${patient.fullName}`}>
      {can("clinic.record.read") && <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
        <Alert type="warning" closable message={t("clinic.copy_033")} />
        <Input.TextArea value={emergencyReason} onChange={e => setEmergencyReason(e.target.value)} maxLength={500}
          placeholder={t("clinic.copy_034")} />
        <Popconfirm title={t("clinic.copy_035")} onConfirm={() => void run(async () => {
          await clinicPost("emergencyAccess", { patientId: patient.id, reason: emergencyReason,
            confirmation: "CONFIRM EMERGENCY CLINICAL ACCESS" });
          setHistory(await clinicGet("history", { patientId: patient.id }));
          setEmergencyReason("");
        })}><Button danger disabled={emergencyReason.trim().length < 20}>{t("clinic.copy_036")}</Button></Popconfirm>
      </Space>}
      <Table<{ id: string; status: string; created_at: string }> size="small" rowKey="id" dataSource={history} columns={[
        { title: t("clinic.copy_037"), render: (_, row: { id: string; created_at: string }) => new Date(row.created_at).toLocaleString(en ? "en-GB" : "th-TH", { timeZone: "Asia/Bangkok" }) },
        { title: t("clinic.copy_024"), dataIndex: "status" },
        { title: "", render: (_, row: { id: string; status: string; created_at: string }) => <Button onClick={() => void run(() => loadEncounter(row.id))}>{t("clinic.copy_038")}</Button> },
      ]} />
    </Card>}
    {encounter && <Card title={`${t("clinic.copy_039")} ${encounter.id}`} extra={<Tag>{encounter.status}</Tag>}>
      {can("clinic.record.sign") && <Space wrap style={{ marginBottom: 12 }}>
        <Select style={{ width: 220 }} placeholder={t("clinic.nurse")} value={nurseId}
          onChange={setNurseId} options={bootstrap?.nurses.map(nurse => ({ value: nurse.id, label: nurse.name }))} />
        <Popconfirm title={t("clinic.confirm_nurse")} onConfirm={() => void run(async () => {
          await clinicPost("assignNurse", { encounterId: encounter.id, nurseUserId: nurseId,
            active: true, confirmation: "CONFIRM CARE TEAM ACCESS" });
          setNurseId(null);
        })}><Button disabled={!nurseId}>{t("clinic.assign_nurse")}</Button></Popconfirm>
      </Space>}
      <Card size="small" title={t("clinic.copy_040")} style={{ marginBottom: 12 }}>
        {can("clinic.record.write") && <input type="file" accept="application/pdf,image/png,image/jpeg"
          onChange={event => { const file = event.target.files?.[0]; if (file) uploadAttachment(file); event.target.value = ""; }} />}
        {attachments.map(file => <p key={file.id}><a href={`/api/bms/clinic/attachments?id=${encodeURIComponent(file.id)}`}>{file.file_name}</a> ({file.byte_size} B)</p>)}
      </Card>
      {encounter.status === "OPEN" ? <>
        {NOTE_FIELDS.map(field => <div key={field} style={{ marginBottom: 12 }}>
          <Typography.Text strong>{t(LABELS[field])}</Typography.Text>
          <Input.TextArea rows={2} maxLength={field === "history" ? 8000 : 4000} value={record[field] ?? ""}
            onChange={e => setRecord(prev => ({ ...prev, [field]: e.target.value }))} />
        </div>)}
        <Space><Button onClick={saveRecord} disabled={busy || !can("clinic.record.write")}>{t("clinic.copy_041")}</Button>
          <Popconfirm title={t("clinic.copy_042")} onConfirm={signRecord}>
            <Button type="primary" disabled={busy || !can("clinic.record.sign")}>{t("clinic.copy_043")}</Button>
          </Popconfirm></Space>
      </> : <>
        {encounter.notes.map(note => <Card key={note.id} size="small" title={`${note.note_kind} · ${new Date(note.signed_at).toLocaleString(en ? "en-GB" : "th-TH", { timeZone: "Asia/Bangkok" })}`} style={{ marginBottom: 12 }}>
          {Object.entries(note.content).map(([key, value]) => <p key={key}><strong>{LABELS[key] ? t(LABELS[key]) : key}:</strong> {value}</p>)}
        </Card>)}
        <Input placeholder={t("clinic.copy_044")} value={addendumReason} onChange={e => setAddendumReason(e.target.value)} maxLength={500} />
        <Input.TextArea placeholder={t("clinic.copy_045")} value={addendumText} onChange={e => setAddendumText(e.target.value)} maxLength={4000} rows={3} />
        <Popconfirm title={t("clinic.copy_046")} onConfirm={() => void run(async () => {
          await clinicPost("addendum", { encounterId: encounter.id, parentNoteId: encounter.notes[0]?.id,
            reason: addendumReason, record: { treatmentPlan: addendumText }, confirmation: "SIGN CLINICAL ADDENDUM" });
          setAddendumReason(""); setAddendumText(""); await loadEncounter(encounter.id);
        })}><Button disabled={!can("clinic.record.sign")}>{t("clinic.copy_047")}</Button></Popconfirm>
      </>}
    </Card>}
  </Space>;
  const billingTab = <Space direction="vertical" style={{ width: "100%" }}>
    <Alert type="warning" showIcon closable message={t("clinic.copy_048")} />
    <Card title={t("clinic.billing_worklist")}>
      <Space.Compact style={{ width: "100%", maxWidth: 500, marginBottom: 12 }}>
        <Input value={billingSearch} onChange={event => setBillingSearch(event.target.value)}
          onPressEnter={() => void run(() => loadBillable(billingSearch))}
          placeholder={t("clinic.billing_search")} maxLength={100} />
        <Button onClick={() => void run(() => loadBillable(billingSearch))}>{t("clinic.copy_011")}</Button>
      </Space.Compact>
      {billableTruncated && <Alert type="warning" showIcon closable style={{ marginBottom: 12 }}
        message={t("clinic.billing_truncated")} />}
      <Table size="small" rowKey="id" dataSource={billable} scroll={{ x: 750 }}
        pagination={{ pageSize: 10 }} columns={[
          { title: t("clinic.hn"), dataIndex: "patientHn" },
          { title: t("clinic.copy_012"), dataIndex: "patientName" },
          { title: t("clinic.signed_at"), render: (_, row: BillableEncounter) =>
            new Date(row.signedAt).toLocaleString(en ? "en-GB" : "th-TH", { timeZone: "Asia/Bangkok" }) },
          { title: t("clinic.copy_024"), render: (_, row: BillableEncounter) =>
            <Tag>{row.chargeStatus ?? t("clinic.new")}</Tag> },
          { title: "", render: (_, row: BillableEncounter) =>
            <Button onClick={() => selectBillingEncounter(row.id)}>{t("clinic.copy_013")}</Button> },
        ]} />
    </Card>
    {billingEncounterId && <Card title={`${t("clinic.copy_049")} · ${billable.find(item => item.id === billingEncounterId)?.patientHn ?? billingEncounterId}`}
      extra={<Tag>{charge?.sheet?.status ?? t("clinic.new")}</Tag>}>
      {charge?.sheet?.status === "ORDER_CREATED" ? <Space direction="vertical">
        <Typography.Text>{t("clinic.copy_050")}: {charge.sheet.order_id} · {charge.sheet.order_status}</Typography.Text>
        {charge.sheet.order_status === "CANCELLED" || charge.sheet.order_status === "RETURNED"
          ? <Alert type="warning" showIcon closable message={t("clinic.closed_order_review")} />
          : <Link href={`/admin/payment?orderId=${encodeURIComponent(charge.sheet.order_id ?? "")}`}>{t("clinic.copy_051")}</Link>}
      </Space> : <>
        {charge?.sheet?.status !== "READY" && chargeLines.map((line, index) => <Space key={index} wrap style={{ display: "flex", marginBottom: 8 }}>
          <Input placeholder={t("clinic.sku")} value={line.sku} maxLength={100} onChange={e => setChargeLines(prev => prev.map((x, i) => i === index ? { ...x, sku: e.target.value } : x))} />
          <Input placeholder={t("clinic.size")} value={line.size} maxLength={64} onChange={e => setChargeLines(prev => prev.map((x, i) => i === index ? { ...x, size: e.target.value } : x))} />
          <InputNumber min={1} max={1000} value={line.qty} onChange={value => setChargeLines(prev => prev.map((x, i) => i === index ? { ...x, qty: value ?? 1 } : x))} />
          <Button onClick={() => setChargeLines(prev => prev.filter((_, i) => i !== index))}>{t("clinic.copy_052")}</Button>
        </Space>)}
        {charge?.sheet?.status !== "READY" && <Space><Button onClick={() => setChargeLines(prev => [...prev, { sku: "", size: "STD", qty: 1 }])}>{t("clinic.copy_053")}</Button><Button onClick={saveCharges} disabled={busy}>{t("clinic.copy_054")}</Button></Space>}
        <Table size="small" rowKey="line_no" dataSource={charge?.lines ?? []} pagination={false} columns={[
          { title: t("clinic.sku"), dataIndex: "product_sku" }, { title: t("clinic.size"), dataIndex: "size" },
          { title: t("clinic.copy_055"), dataIndex: "qty" }, { title: t("clinic.copy_056"), dataIndex: "reviewed_unit_price" },
        ]} />
        {charge?.sheet?.status === "DRAFT" && <Popconfirm title={t("clinic.copy_057")} onConfirm={reviewCharges}><Button>{t("clinic.copy_058")}</Button></Popconfirm>}
        {charge?.sheet?.status === "READY" && <Popconfirm title={t("clinic.copy_059")} onConfirm={createOrder}><Button type="primary">{t("clinic.copy_060")}</Button></Popconfirm>}
      </>}
    </Card>}
  </Space>;
  const adminTab = <Space direction="vertical" style={{ width: "100%" }}>
    {can("clinic.staff.manage") && <Card title={t("clinic.copy_061")}>
      <Form form={staffForm} layout="vertical" onFinish={values => void run(async () => {
        await clinicPost("grantStaff", { ...values, active: true, confirmation: "CONFIRM CLINIC STAFF ACCESS" });
        staffForm.resetFields(); setBootstrap(await clinicGet("bootstrap"));
      })}>
        <Form.Item name="userId" label={t("clinic.copy_062")} rules={[{ required: true }]}><Select options={bootstrap?.users.map(user => ({ value: user.id, label: user.name }))} /></Form.Item>
        <Form.Item name="role" label={t("clinic.copy_063")} rules={[{ required: true }]}><Select options={["REGISTRAR", "NURSE", "CLINICIAN", "CASHIER"].map(value => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="licenceNo" label={t("clinic.copy_064")}><Input maxLength={80} /></Form.Item>
        <Popconfirm title={t("clinic.copy_065")} onConfirm={() => staffForm.submit()}><Button>{t("clinic.copy_066")}</Button></Popconfirm>
      </Form>
    </Card>}
    {can("clinic.staff.manage") && <Card title={t("clinic.staff_access")}>
      <Table size="small" rowKey={row => `${row.user_id}:${row.access_role}`} dataSource={bootstrap?.staff ?? []}
        pagination={{ pageSize: 20 }} columns={[
          { title: t("clinic.copy_062"), dataIndex: "name" },
          { title: t("clinic.copy_063"), dataIndex: "access_role" },
          { title: t("clinic.staff_status"), render: (_, row: Bootstrap["staff"][number]) =>
            <Tag color={row.active ? "green" : "default"}>{row.active ? t("clinic.active") : t("clinic.inactive")}</Tag> },
          { title: "", render: (_, row: Bootstrap["staff"][number]) => row.active &&
            <Popconfirm title={t("clinic.confirm_revoke")} onConfirm={() => void run(async () => {
              await clinicPost("grantStaff", { userId: row.user_id, role: row.access_role,
                active: false, licenceNo: row.licence_no, confirmation: "CONFIRM CLINIC STAFF ACCESS" });
              setBootstrap(await clinicGet("bootstrap"));
            })}><Button danger disabled={busy}>{t("clinic.revoke_access")}</Button></Popconfirm> },
        ]} />
    </Card>}
    {patient && <Card title={t("clinic.copy_067")}>
      <Table rowKey={(_, i) => String(i)} dataSource={accessEvents} columns={[
        { title: t("clinic.copy_068"), dataIndex: "actor_user_id" },
        { title: t("clinic.copy_069"), dataIndex: "source" },
        { title: t("clinic.copy_070"), render: (_, row: { created_at: string }) => new Date(row.created_at).toLocaleString(en ? "en-GB" : "th-TH", { timeZone: "Asia/Bangkok" }) },
      ]} />
    </Card>}
  </Space>;
  return <div style={{ maxWidth: 1300, margin: "0 auto", padding: 24 }}>
    <Typography.Title level={2}>{t("clinic.copy_071")}</Typography.Title>
    <Typography.Paragraph><Link href="/admin/manual/clinic">{t("clinic.operator_manual")} →</Link></Typography.Paragraph>
    <Alert type="warning" showIcon closable style={{ marginBottom: 16 }} message={t("clinic.copy_072")} />
    {error && <Alert type="error" showIcon closable style={{ marginBottom: 16 }} message={error} />}
    {bootstrap?.location && <Typography.Paragraph>{t("clinic.copy_073")}: {bootstrap.location.name} · {patient ? `${patient.hn} ${patient.fullName}` : t("clinic.copy_074")}</Typography.Paragraph>}
    <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
      { key: "patients", label: t("clinic.copy_075"), children: patientTab,
        disabled: !can("clinic.patient.read") && !can("clinic.patient.register") },
      { key: "appointments", label: t("clinic.copy_076"), children: appointmentTab, disabled: !can("clinic.appointment.manage") },
      { key: "encounters", label: t("clinic.copy_077"), children: encounterTab, disabled: !can("clinic.record.read") },
      { key: "billing", label: t("clinic.copy_078"), children: billingTab, disabled: !can("clinic.billing.manage") },
      { key: "admin", label: t("clinic.copy_079"), children: adminTab, disabled: !can("clinic.staff.manage") && !can("clinic.audit.read") },
    ]} />
  </div>;
}
