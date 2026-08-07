'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Alert, Typography, Tag, Card, Button, Space, Input, List, Timeline, message, Divider } from "antd";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const Q = gql`
  query PharmacyCase($id: ID!) {
    bmsPharmacyAssessment(id: $id) {
      id status riskLevel version patientRelationship consentStatus
      biologicalSex pregnancyStatus breastfeedingStatus patientAgeYears
      missingFields conflictingFields detectedRedFlags
      structuredAnswers rawMessages aiSummary aiSummaryVersion
      pharmacistDecisionNotes needsManualIntake protocolId medicationSuggestions
      createdAt updatedAt expiresAt
    }
    bmsPharmacyAssessmentConversationHistory(assessmentId: $id, limit: 100) {
      conversationId channel customerName customerRef status
      messages { id direction body sender createdAt status }
    }
    bmsPharmacyAssessmentEvents(assessmentId: $id, limit: 100) {
      id actor action previousState nextState createdAt
    }
  }
`;

const M_START_REVIEW = gql`mutation($id: ID!) { bmsStartPharmacistReview(assessmentId: $id) { id status version } }`;
const M_REQUEST_MORE = gql`
  mutation($id: ID!, $v: Int!, $fields: [String!]!, $note: String) {
    bmsRequestMoreInformation(assessmentId: $id, expectedVersion: $v, fields: $fields, note: $note) { id status version }
  }
`;
const M_APPROVE = gql`
  mutation($id: ID!, $v: Int!, $resp: String!) {
    bmsApproveAssessment(assessmentId: $id, expectedVersion: $v, pharmacistResponse: $resp) { id status version }
  }
`;
const M_REJECT = gql`
  mutation($id: ID!, $v: Int!, $reason: String!) {
    bmsRejectAssessment(assessmentId: $id, expectedVersion: $v, reason: $reason) { id status version }
  }
`;
const M_REFER = gql`
  mutation($id: ID!, $v: Int!, $reason: String!) {
    bmsReferAssessmentToDoctor(assessmentId: $id, expectedVersion: $v, reason: $reason) { id status version }
  }
`;
const M_EMERGENCY = gql`
  mutation($id: ID!, $reason: String!) {
    bmsEscalateAssessmentToEmergency(assessmentId: $id, reason: $reason) { id status version }
  }
`;
const M_EDIT_SUMMARY = gql`
  mutation($id: ID!, $text: String!) {
    bmsEditAssessmentSummary(assessmentId: $id, summaryText: $text) { id aiSummary aiSummaryVersion version }
  }
`;
const M_MANUAL_FILL = gql`
  mutation($id: ID!, $fields: JSON!) {
    bmsManualFillAssessmentFields(assessmentId: $id, fields: $fields) { id status missingFields conflictingFields version }
  }
`;
const M_SUGGEST_MEDICATION = gql`
  mutation($id: ID!) {
    bmsGenerateMedicationSuggestions(assessmentId: $id) { id medicationSuggestions }
  }
`;

export default function PharmacyCaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const router = useRouter();
  const { can, loading: permsLoading } = useBmsPermissions();
  const [pharmacistResponse, setPharmacistResponse] = useState("");
  const [reason, setReason] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null);
  const [manualFieldValues, setManualFieldValues] = useState<Record<string, string>>({});

  const { data, loading, error, refetch } = useQuery(Q, {
    variables: { id: params.caseId },
    skip: permsLoading || !can("pharmacy.assessment.read"),
    fetchPolicy: "cache-and-network",
  });

  const onDone = (label: string) => () => {
    message.success(label);
    refetch();
  };
  const onErr = (e: any) => message.error(e?.message || "ดำเนินการไม่สำเร็จ");

  const [startReview, { loading: starting }] = useMutation(M_START_REVIEW, { onCompleted: onDone("รับเคสแล้ว"), onError: onErr });
  const [requestMore, { loading: requestingMore }] = useMutation(M_REQUEST_MORE, { onCompleted: onDone("ขอข้อมูลเพิ่มแล้ว"), onError: onErr });
  const [approve, { loading: approving }] = useMutation(M_APPROVE, { onCompleted: onDone("อนุมัติแล้ว"), onError: onErr });
  const [reject, { loading: rejecting }] = useMutation(M_REJECT, { onCompleted: onDone("ปฏิเสธแล้ว"), onError: onErr });
  const [refer, { loading: referring }] = useMutation(M_REFER, { onCompleted: onDone("ส่งต่อแพทย์แล้ว"), onError: onErr });
  const [escalate, { loading: escalating }] = useMutation(M_EMERGENCY, {
    onCompleted: () => { message.success("ส่งต่อฉุกเฉินแล้ว"); setEmergencyReason(""); refetch(); },
    onError: onErr,
  });
  const [editSummary, { loading: editingSummary }] = useMutation(M_EDIT_SUMMARY, {
    onCompleted: () => { message.success("บันทึกการแก้ไขสรุปแล้ว"); setSummaryDraft(null); refetch(); },
    onError: onErr,
  });
  const [manualFill, { loading: manualFilling }] = useMutation(M_MANUAL_FILL, {
    onCompleted: () => { message.success("บันทึกข้อมูลที่กรอกเองแล้ว"); setManualFieldValues({}); refetch(); },
    onError: onErr,
  });
  const [suggestMedication, { loading: suggestingMedication }] = useMutation(M_SUGGEST_MEDICATION, {
    onCompleted: () => { message.success("ได้คำแนะนำยาจาก AI แล้ว — ตรวจสอบก่อนใช้เสมอ"); refetch(); },
    onError: onErr,
  });

  if (!permsLoading && !can("pharmacy.assessment.read")) {
    return <Alert type="warning" showIcon message="ไม่มีสิทธิ์ดูหน้านี้" />;
  }
  if (error) return <Alert type="error" showIcon message="โหลดเคสไม่ได้" description={error.message} />;

  const c = data?.bmsPharmacyAssessment;
  const history = data?.bmsPharmacyAssessmentConversationHistory;
  const events = data?.bmsPharmacyAssessmentEvents || [];
  if (loading && !c) return <Alert type="info" showIcon message="กำลังโหลด..." />;
  if (!c) return <Alert type="warning" showIcon message="ไม่พบเคสนี้" />;

  const missing: string[] = c.missingFields || [];
  const conflicting: string[] = c.conflictingFields || [];
  const redFlags: any[] = c.detectedRedFlags || [];
  const canApprove =
    c.status === "PHARMACIST_REVIEWING" && missing.length === 0 && Boolean(pharmacistResponse.trim());
  const canDecide = c.status === "PHARMACIST_REVIEWING";
  const canReview = c.status === "WAITING_FOR_PHARMACIST";

  return (
    <div>
      <AdminPageHeader
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>เคส {c.id.slice(0, 8)}</Typography.Title>
            <Tag>{c.status}</Tag>
          </Space>
        }
      >
        <Button onClick={() => router.push("/admin/pharmacy-queue")}>กลับไปคิว</Button>
      </AdminPageHeader>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="AI เป็นเพียงผู้ช่วยเก็บข้อมูล — ไม่ใช่การวินิจฉัยหรือคำแนะนำยา เภสัชกรต้องตัดสินใจเองทั้งหมด"
      />

      {redFlags.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="พบ Red Flag"
          description={redFlags.map((f: any, i: number) => (
            <div key={i}>{f.label} ({f.severity})</div>
          ))}
        />
      )}

      <Card size="small" title="ข้อมูลผู้ป่วย (allergies/current medications เด่นชัด)" style={{ marginBottom: 12 }}>
        <Paragraph>ความสัมพันธ์กับผู้ป่วย: {c.patientRelationship} · เพศ: {c.biologicalSex} · อายุ: {c.patientAgeYears ?? "UNKNOWN"} ปี</Paragraph>
        <Paragraph>ตั้งครรภ์: {c.pregnancyStatus} · ให้นมบุตร: {c.breastfeedingStatus}</Paragraph>
        <Divider style={{ margin: "8px 0" }} />
        <Text strong>ประวัติแพ้ยา: </Text>
        <Text>{String((c.structuredAnswers || {}).allergies ?? "UNKNOWN")}</Text>
        <br />
        <Text strong>ยาที่ใช้อยู่ปัจจุบัน: </Text>
        <Text>{String((c.structuredAnswers || {}).current_medications ?? "UNKNOWN")}</Text>
      </Card>

      {(missing.length > 0 || conflicting.length > 0) && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <>
              {missing.length > 0 && <div>ข้อมูลที่ยังขาด: {missing.join(", ")}</div>}
              {conflicting.length > 0 && <div>คำตอบที่ขัดแย้งกัน: {conflicting.join(", ")}</div>}
            </>
          }
        />
      )}

      {missing.length > 0 && can("pharmacy.assessment.review") && (
        <Card
          size="small"
          title="กรอกข้อมูลที่ขาดเอง (ใช้เมื่อ AI ไม่พร้อมใช้งานหรือลูกค้าไม่ตอบต่อ)"
          style={{ marginBottom: 12 }}
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            {missing.map((key) => (
              <Space key={key} style={{ width: "100%" }}>
                <Text style={{ width: 200, display: "inline-block" }}>{key}</Text>
                <Input
                  style={{ width: 320 }}
                  value={manualFieldValues[key] ?? ""}
                  onChange={(e) => setManualFieldValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder="กรอกค่าจากบทสนทนาต้นฉบับ"
                />
              </Space>
            ))}
            <Button
              type="primary"
              loading={manualFilling}
              disabled={missing.every((k) => !manualFieldValues[k]?.trim())}
              onClick={() =>
                manualFill({
                  variables: {
                    id: c.id,
                    fields: Object.fromEntries(Object.entries(manualFieldValues).filter(([, v]) => v.trim())),
                  },
                })
              }
            >
              บันทึกข้อมูลที่กรอกเอง
            </Button>
            <Text type="secondary">
              ข้อมูลที่กรอกจะถูกตรวจด้วย rule engine เดียวกับที่ AI ใช้ (Red Flag/ข้อมูลขัดแย้งยังตรวจอยู่เหมือนเดิม) — ไม่ใช่ทางลัดข้ามการตรวจสอบ
            </Text>
          </Space>
        </Card>
      )}

      <Card size="small" title="ข้อมูลโครงสร้าง (structured answers)" style={{ marginBottom: 12 }}>
        <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(c.structuredAnswers, null, 2)}</pre>
      </Card>

      <Card
        size="small"
        title="Conversation history"
        style={{ marginBottom: 12 }}
        extra={
          history ? (
            <Text type="secondary">
              {history.channel} · {history.status}
            </Text>
          ) : undefined
        }
      >
        {history ? (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Text type="secondary">
              ลูกค้า: {history.customerName || history.customerRef || "ไม่ทราบ"} · conversation {history.conversationId.slice(0, 8)}
            </Text>
            <List
              size="small"
              dataSource={history.messages || []}
              locale={{ emptyText: "ยังไม่มีข้อความใน conversation นี้" }}
              renderItem={(m: any) => (
                <List.Item>
                  <Space direction="vertical" size={0} style={{ width: "100%" }}>
                    <Space wrap size={8}>
                      <Tag color={m.direction === "IN" ? "blue" : "green"}>{m.direction === "IN" ? "customer" : "staff/outbound"}</Tag>
                      {m.sender ? <Text type="secondary">{m.sender}</Text> : null}
                      {m.status ? <Tag>{m.status}</Tag> : null}
                      <Text type="secondary">{new Date(m.createdAt).toLocaleString()}</Text>
                    </Space>
                    <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{m.body || "(empty message)"}</Paragraph>
                  </Space>
                </List.Item>
              )}
            />
          </Space>
        ) : (
          <Text type="secondary">เคสนี้ยังไม่ได้ผูกกับ customer conversation จริง จึงมีให้ดูเฉพาะ raw conversation ด้านล่าง</Text>
        )}
      </Card>

      <Card
        size="small"
        title={`สรุปโดย AI (v${c.aiSummaryVersion}) — ยังไม่ได้ตรวจสอบ`}
        style={{ marginBottom: 12 }}
        extra={
          canDecide && can("pharmacy.assessment.review") && summaryDraft === null ? (
            <a onClick={() => setSummaryDraft(c.aiSummary || "")}>แก้ไขสรุป</a>
          ) : undefined
        }
      >
        {summaryDraft !== null ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <TextArea value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} rows={4} />
            <Space>
              <Button type="primary" loading={editingSummary} onClick={() => editSummary({ variables: { id: c.id, text: summaryDraft } })}>
                บันทึกการแก้ไข
              </Button>
              <Button onClick={() => setSummaryDraft(null)}>ยกเลิก</Button>
            </Space>
          </Space>
        ) : (
          <Paragraph>{c.aiSummary || "ยังไม่มีสรุป"}</Paragraph>
        )}
        {c.needsManualIntake && <Tag color="red">เคสนี้ AI ไม่พร้อมใช้งานบางช่วง — ต้องดูบทสนทนาต้นฉบับโดยตรง</Tag>}
      </Card>

      <Card size="small" title="บทสนทนาต้นฉบับ (raw conversation)" style={{ marginBottom: 12 }}>
        <List
          size="small"
          dataSource={c.rawMessages || []}
          renderItem={(m: any) => (
            <List.Item>
              <Text type="secondary">[{m.role}] </Text>
              <Text>{m.text}</Text>
            </List.Item>
          )}
        />
      </Card>

      {can("pharmacy.assessment.review") && c.status === "PHARMACIST_REVIEWING" && (
        <Card
          size="small"
          title="AI แนะนำยา — เฉพาะเภสัชกรเห็นเท่านั้น (ยังไม่ผ่านการตรวจสอบ)"
          style={{ marginBottom: 12, borderColor: "#d48806" }}
          extra={
            <Button size="small" loading={suggestingMedication} onClick={() => suggestMedication({ variables: { id: c.id } })}>
              ขอคำแนะนำยาจาก AI
            </Button>
          }
        >
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="คำแนะนำนี้ห้ามส่งต่อให้ลูกค้าโดยตรง — เภสัชกรต้องตรวจสอบประวัติแพ้ยา/ยาที่ใช้อยู่/ข้อห้ามใช้เองก่อนทุกครั้ง แล้วค่อยกด “ใช้คำแนะนำนี้” เพื่อนำไปแก้ไขเป็นคำแนะนำจริงของตัวเอง"
          />
          {(c.medicationSuggestions || []).length === 0 ? (
            <Text type="secondary">ยังไม่มีคำแนะนำ — กด "ขอคำแนะนำยาจาก AI" ด้านบนขวา</Text>
          ) : (
            <List
              size="small"
              dataSource={c.medicationSuggestions}
              renderItem={(m: any) => (
                <List.Item
                  style={{ opacity: m.excluded ? 0.5 : 1 }}
                  actions={
                    m.excluded
                      ? []
                      : [
                          <a
                            key="use"
                            onClick={() =>
                              setPharmacistResponse((prev) =>
                                [prev, `${m.drugName} ${m.strength} — ${m.dosageInstruction}`].filter(Boolean).join("\n")
                              )
                            }
                          >
                            เพิ่มในร่างคำแนะนำเภสัชกร
                          </a>,
                        ]
                  }
                >
                  <Space direction="vertical" size={0}>
                    <Text strong>
                      {m.drugName} {m.strength}
                      {m.excluded && <Tag color="red" style={{ marginLeft: 8 }}>ถูกกรองออก</Tag>}
                    </Text>
                    <Text>{m.dosageInstruction}</Text>
                    {m.rationale && <Text type="secondary">เหตุผล: {m.rationale}</Text>}
                    {(m.catalogMatches || []).length > 0 ? (
                      <Space wrap size={4}>
                        <Text type="secondary">สินค้าในร้านที่ชื่อใกล้เคียง:</Text>
                        {(m.catalogMatches as any[]).map((item) => (
                          <Tag key={item.sku} color="blue">
                            {item.name} · {item.sku} · ฿{Number(item.price).toLocaleString()} · เหลือ {item.availableTotal}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <Text type="secondary">ไม่พบสินค้า active ที่มีสต็อกและชื่อใกล้เคียงในร้าน</Text>
                    )}
                    <Text type="secondary">ต้องตรวจสอบตัวยาสำคัญ/รูปแบบยา/ความแรงกับสินค้าจริงก่อนเลือกใช้</Text>
                    {m.excluded && m.exclusionReason && <Text type="danger">เหตุผลที่กรองออก: {m.exclusionReason}</Text>}
                    {(m.warnings || []).length > 0 && (
                      <Text type="warning">คำเตือน: {(m.warnings as string[]).join("; ")}</Text>
                    )}
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      )}

      <Card size="small" title="การดำเนินการของเภสัชกร" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          {canReview && can("pharmacy.assessment.review") && (
            <Button type="primary" loading={starting} onClick={() => startReview({ variables: { id: c.id } })}>
              รับเคส (Start Review)
            </Button>
          )}

          {canDecide && can("pharmacy.assessment.request_more_information") && (
            <Space.Compact style={{ width: "100%" }}>
              <Button
                loading={requestingMore}
                onClick={() =>
                  requestMore({ variables: { id: c.id, v: c.version, fields: missing.length ? missing : ["additional_info"], note: reason || null } })
                }
              >
                ขอข้อมูลเพิ่ม (จากช่องขาด)
              </Button>
            </Space.Compact>
          )}

          <TextArea
            placeholder="คำแนะนำของเภสัชกร (ข้อความนี้จะถูกส่งให้ลูกค้าโดยตรง เมื่อกดอนุมัติ)"
            value={pharmacistResponse}
            onChange={(e) => setPharmacistResponse(e.target.value)}
            rows={3}
            disabled={!canDecide}
          />
          <Input placeholder="เหตุผล (สำหรับปฏิเสธ/ส่งต่อแพทย์)" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canDecide} />

          <Space wrap>
            <Button
              type="primary"
              disabled={!canApprove}
              loading={approving}
              onClick={() => approve({ variables: { id: c.id, v: c.version, resp: pharmacistResponse } })}
            >
              Approve
            </Button>
            <Button danger disabled={!canDecide || !reason.trim()} loading={rejecting} onClick={() => reject({ variables: { id: c.id, v: c.version, reason } })}>
              Reject
            </Button>
            <Button disabled={!canDecide || !reason.trim()} loading={referring} onClick={() => refer({ variables: { id: c.id, v: c.version, reason } })}>
              Refer to doctor
            </Button>
          </Space>
          <Text type="secondary">
            ปุ่ม Approve ถูก disable ฝั่ง UI เมื่อข้อมูลไม่ครบ/ไม่มีคำแนะนำ — แต่ตัวบังคับจริงอยู่ที่ server (ต้องเป็นเภสัชกรที่มีใบประกอบวิชาชีพ +
            ข้อมูลครบ + สถานะถูกต้อง) ห้ามเชื่อสถานะ disabled ของปุ่มนี้เป็นการอนุญาต
          </Text>

          {c.status !== "CLOSED" && c.status !== "EMERGENCY_REFERRAL" && can("pharmacy.assessment.review") && (
            <>
              <Divider style={{ margin: "8px 0" }} />
              <Text strong type="danger">Emergency referral — ใช้เมื่อเภสัชกรพิจารณาว่าเคสนี้ต้องส่งฉุกเฉินทันที</Text>
              <Space.Compact style={{ width: "100%" }}>
                <Input
                  placeholder="เหตุผลที่ส่งฉุกเฉิน"
                  value={emergencyReason}
                  onChange={(e) => setEmergencyReason(e.target.value)}
                />
                <Button danger loading={escalating} disabled={!emergencyReason.trim()} onClick={() => escalate({ variables: { id: c.id, reason: emergencyReason } })}>
                  Emergency referral
                </Button>
              </Space.Compact>
            </>
          )}
        </Space>
      </Card>

      <Card size="small" title="Audit Timeline">
        <Timeline
          items={events.map((e: any) => ({
            children: (
              <div>
                <Text strong>{e.action}</Text> — {e.actor}
                {e.previousState && e.nextState ? ` (${e.previousState} → ${e.nextState})` : ""}
                <br />
                <Text type="secondary">{new Date(e.createdAt).toLocaleString()}</Text>
              </div>
            ),
          }))}
        />
      </Card>
    </div>
  );
}
