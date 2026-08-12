'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  List,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  MedicineBoxOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { useI18n } from "@/lib/i18nContext";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ⚠️ ข้อมูลเคสจำลองทั้งหมดด้านล่าง (patientFacts / aiFindings / redFlags / pharmacistChecklist /
// mockConversation / initialMedicationRows และค่าใน Descriptions ของหน้า) **คงเป็นภาษาไทยโดยเจตนา**
// — เป็น "ข้อมูลตัวอย่างทางคลินิก" ไม่ใช่ UI copy: มันจำลองบทสนทนาของคนไข้ไทยและ draft ยา/ขนาดยา
// การแปลเนื้อหาคลินิกเป็นอังกฤษเสี่ยงคลาดเคลื่อนและไม่ได้ประโยชน์กับหน้าที่เป็น design mockup
// (หลักเดียวกับ /live-dashboard ที่ตั้งใจไม่แปลเพราะเป็น mock data) — ส่วน chrome ของหน้าแปลครบแล้ว
const patientFacts = [
  ['ผู้ป่วย', 'เด็กชาย อายุ 6 ปี'],
  ['อาการหลัก', 'ไอ 3 วัน มีไข้ต่ำ ไม่มีหอบ ไม่มีเจ็บหน้าอก'],
  ['ประวัติแพ้ยา', 'ไม่มี'],
  ['ยาที่ใช้อยู่', 'ไม่มี'],
  ['โรคประจำตัว', 'ไม่มีข้อมูลที่บ่งชี้'],
  ['ข้อมูลสำคัญเพิ่ม', 'ไม่มีเสมหะ, ไม่มีเลือดปน, ดื่มน้ำได้, กินอาหารได้'],
];

const aiFindings = [
  'เคสนี้ดูเข้ากลุ่ม upper respiratory tract infection / viral cough ที่ยังไม่พบ red flag รุนแรง',
  'ข้อมูลค่อนข้างครบสำหรับเภสัช review ต่อ โดยยังควรเช็กน้ำหนักเด็กก่อนเลือกขนาดยาบางรายการ',
  'ยังไม่ควรใช้ยาปฏิชีวนะจากข้อมูลปัจจุบัน',
  'ควรให้คำแนะนำเรื่องการสังเกตอาการแย่ลง เช่น หอบ ซึม กินน้ำไม่ได้ ไข้สูงต่อเนื่อง',
];

const redFlags = [
  'หายใจลำบาก / หอบเหนื่อย',
  'เจ็บแน่นหน้าอก',
  'ซึมลง ดื่มน้ำไม่ได้',
  'ไข้สูงต่อเนื่องหลายวัน',
];

const pharmacistChecklist = [
  'ยืนยันน้ำหนักเด็กก่อน finalize dose',
  'เช็กว่าไข้ล่าสุดกี่องศา และมีเครื่องวัดจริงหรือไม่',
  'ดูว่าควรส่งกลับเป็นคำแนะนำอย่างเดียว หรือเปิดออเดอร์ยาให้ลูกค้าเลย',
  'ปรับ/ลบรายการยาที่ AI draft ไว้ก่อน approve',
];

const mockConversation = [
  { role: 'customer', text: 'ลูกชายไอมา 3 วันค่ะ มีไข้ต่ำ ๆ แต่ยังเล่นได้อยู่' },
  { role: 'ai', text: 'ขอสอบถามเพิ่มนะคะ มีหอบ เหนื่อย หรือเจ็บหน้าอกร่วมด้วยไหมคะ' },
  { role: 'customer', text: 'ไม่มีค่ะ กินน้ำได้ ไม่มีหอบ' },
  { role: 'ai', text: 'มีเสมหะไหมคะ และมีประวัติแพ้ยาหรือไม่' },
  { role: 'customer', text: 'ไม่มีเสมหะค่ะ ไม่เคยแพ้ยา' },
  { role: 'ai', text: 'สรุปข้อมูลครบแล้ว เตรียมส่งให้เภสัชกรตรวจสอบค่ะ' },
];

type DraftMedicationRow = {
  key: string;
  group: string;
  product: string;
  sku: string;
  stock: string;
  draft: string;
  why: string;
  caution: string;
  enabled: boolean;
  qty: number;
  unitPrice: number;
  pharmacistNote: string;
};

const initialMedicationRows: DraftMedicationRow[] = [
  {
    key: '1',
    group: 'ลดไข้/บรรเทาปวด',
    product: 'Paracetamol syrup 120 mg/5 mL',
    sku: 'PCM-SYR-120',
    stock: 'พร้อมขาย 18 ขวด',
    draft: '10-15 mg/kg/dose ทุก 4-6 ชม. เมื่อมีไข้',
    why: 'เหมาะกับอายุเด็กและใช้บรรเทาไข้ได้',
    caution: 'ต้องคำนวณตามน้ำหนักจริงก่อนจ่าย',
    enabled: true,
    qty: 1,
    unitPrice: 65,
    pharmacistNote: 'รอน้ำหนักเด็ก',
  },
  {
    key: '2',
    group: 'บรรเทาไอ/ระคายคอ',
    product: 'Honey lemon cough syrup (เด็ก > 1 ปี)',
    sku: 'COUGH-HONEY-60',
    stock: 'พร้อมขาย 9 ขวด',
    draft: '5 mL หลังอาหาร วันละ 3 ครั้ง',
    why: 'ช่วยลดระคายคอและอาการไอทั่วไป',
    caution: 'ควรยืนยันว่าไม่มีประวัติแพ้น้ำผึ้ง และอายุเกิน 1 ปี',
    enabled: true,
    qty: 1,
    unitPrice: 89,
    pharmacistNote: '',
  },
  {
    key: '3',
    group: 'non-drug support',
    product: 'Nasal saline drop',
    sku: 'SALINE-NOSE-15',
    stock: 'พร้อมขาย 24 ขวด',
    draft: 'หยอดจมูกตามอาการ',
    why: 'ช่วยถ้ามีน้ำมูก/คัดจมูกร่วม',
    caution: 'เป็นตัวเลือกเสริม ไม่จำเป็นต้องจ่ายทุกเคส',
    enabled: false,
    qty: 1,
    unitPrice: 45,
    pharmacistNote: '',
  },
];

export default function PharmacyReviewMockupPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<DraftMedicationRow[]>(initialMedicationRows);
  const [pharmacistSummary, setPharmacistSummary] = useState(
    'ยืนยันเคสไอทั่วไปในเด็ก ยังไม่พบ red flag เร่งด่วน จ่ายยาตามอาการ พร้อมแนะนำสังเกตอาการ'
  );
  const [customerMessage, setCustomerMessage] = useState(
    [
      'จากข้อมูลเบื้องต้น ยังไม่พบสัญญาณอันตรายเร่งด่วน',
      'แนะนำยาลดไข้และยาบรรเทาอาการไอตามที่เภสัชกรตรวจสอบแล้ว',
      'หากมีหอบ ซึมลง กินน้ำไม่ได้ หรือไข้สูงต่อเนื่อง ให้ไปพบแพทย์ทันที',
    ].join('\n')
  );
  const [showConversation, setShowConversation] = useState(true);

  const selectedRows = useMemo(() => rows.filter((row) => row.enabled), [rows]);
  const estimatedTotal = useMemo(
    () => selectedRows.reduce((sum, row) => sum + row.qty * row.unitPrice, 0),
    [selectedRows]
  );

  const patchRow = (key: string, patch: Partial<DraftMedicationRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const simulateApprove = () => {
    message.success(t("admin_pharmacy_review_mockup.approved_toast"));
  };

  return (
    <div>
      <AdminPageHeader
        title={<Title level={4} style={{ margin: 0 }}>Pharmacy Review Mockup</Title>}
      >
        <Tag color="blue">Mockup</Tag>
      </AdminPageHeader>

      <Alert
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message={t("admin_pharmacy_review_mockup.mockup_notice")}
        description={t("admin_pharmacy_review_mockup.mockup_notice_desc")}
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <Tag color="orange">Risk: NORMAL</Tag>
          <Tag color="green">Completeness: 92%</Tag>
          <Tag color="blue">AI confidence: medium-high</Tag>
          <Tag color="purple">Catalog matched: 3 items</Tag>
          <Tag color="gold">Ready for pharmacist review</Tag>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            size="small"
            title={
              <Space>
                <UserOutlined />
                <span>Patient Snapshot</span>
                <Tag color="green">{t("admin_pharmacy_review_mockup.tag_enough_info")}</Tag>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <List
              size="small"
              dataSource={patientFacts}
              renderItem={(item) => (
                <List.Item>
                  <div style={{ width: '100%' }}>
                    <Text strong>{item[0]}: </Text>
                    <Text>{item[1]}</Text>
                  </div>
                </List.Item>
              )}
            />
          </Card>

          <Card size="small" title="Structured Intake + Patient Memory" style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_age")}>6 ปี</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_sex")}>ชาย</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_weight")}>ยังไม่ยืนยัน</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_last_fever")}>37.8 C</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_allergies")}>ไม่มี</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_current_meds")}>ไม่มี</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_similar_cases")}>เคยซื้อ paracetamol syrup เมื่อ 2 เดือนก่อน</Descriptions.Item>
              <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_patient_memory")}>ครอบครัวนี้ชอบรับคำแนะนำก่อนตัดสินใจซื้อ</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <RobotOutlined />
                <span>AI Analysis Summary</span>
              </Space>
            }
            extra={<Tag color="gold">Draft for pharmacist review</Tag>}
            style={{ marginBottom: 16 }}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert
                type="success"
                showIcon
                message="AI assessment"
                description="เบื้องต้นจัดเป็นเคสไอทั่วไปในเด็ก ยังไม่พบ red flag ที่บังคับ refer ทันที แต่ยังต้องให้เภสัชกรยืนยันขนาดยาและคำแนะนำ"
              />

              <List
                size="small"
                bordered
                dataSource={aiFindings}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />

              <div>
                <Text strong>{t("admin_pharmacy_review_mockup.ai_watchlist")}</Text>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {redFlags.map((flag) => (
                    <Tag key={flag} color="red">{flag}</Tag>
                  ))}
                </div>
              </div>
            </Space>
          </Card>

          <Card
            size="small"
            title="What AI thinks pharmacist should verify before finalizing"
            style={{ marginBottom: 16 }}
          >
            <List
              size="small"
              bordered
              dataSource={[
                'ถามน้ำหนักเด็กเพื่อคำนวณ dose พาราให้แม่นขึ้น',
                'ถ้าไข้สูงขึ้นหรือไอนานเกิน 5-7 วัน ควรประเมินซ้ำ',
                'ถ้ามีเสมหะเปลี่ยนสีหรือเริ่มหอบ ให้เปลี่ยน risk level',
                'เลือกว่าจะจ่ายยา 1-2 รายการหลัก หรือให้คำแนะนำอย่างเดียว',
              ]}
              renderItem={(item) => <List.Item>{item}</List.Item>}
            />
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <MedicineBoxOutlined />
                <span>AI Draft Medication Plan</span>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Table
              size="small"
              pagination={false}
              dataSource={rows}
              scroll={{ x: 1400 }}
              columns={[
                {
                  title: t("admin_pharmacy_review_mockup.col_select"),
                  key: 'enabled',
                  width: 72,
                  render: (_, row) => (
                    <Switch
                      checked={row.enabled}
                      onChange={(checked) => patchRow(row.key, { enabled: checked })}
                    />
                  ),
                },
                { title: t("admin_pharmacy_review_mockup.col_group"), dataIndex: 'group', key: 'group', width: 140 },
                {
                  title: t("admin_pharmacy_review_mockup.col_product_from_shop"),
                  key: 'product',
                  width: 220,
                  render: (_, row) => (
                    <Space direction="vertical" size={0}>
                      <Text strong>{row.product}</Text>
                      <Text type="secondary">{row.sku}</Text>
                    </Space>
                  ),
                },
                { title: t("admin_pharmacy_review_mockup.col_stock"), dataIndex: 'stock', key: 'stock', width: 140 },
                { title: 'AI draft dosage', dataIndex: 'draft', key: 'draft', width: 220 },
                {
                  title: t("admin_pharmacy_review_mockup.col_qty"),
                  key: 'qty',
                  width: 90,
                  render: (_, row) => (
                    <InputNumber
                      min={1}
                      value={row.qty}
                      onChange={(value) => patchRow(row.key, { qty: Number(value || 1) })}
                    />
                  ),
                },
                {
                  title: t("admin_pharmacy_review_mockup.col_unit_price"),
                  key: 'unitPrice',
                  width: 110,
                  render: (_, row) => (
                    <InputNumber
                      min={0}
                      value={row.unitPrice}
                      onChange={(value) => patchRow(row.key, { unitPrice: Number(value || 0) })}
                    />
                  ),
                },
                { title: t("admin_pharmacy_review_mockup.col_reason"), dataIndex: 'why', key: 'why', width: 220 },
                {
                  title: t("admin_pharmacy_review_mockup.col_caution"),
                  dataIndex: 'caution',
                  key: 'caution',
                  width: 260,
                  render: (value: string) => <Text type="warning">{value}</Text>,
                },
                {
                  title: t("admin_pharmacy_review_mockup.col_pharmacist_note"),
                  key: 'pharmacistNote',
                  width: 220,
                  render: (_, row) => (
                    <Input
                      value={row.pharmacistNote}
                      onChange={(event) => patchRow(row.key, { pharmacistNote: event.target.value })}
                      placeholder={t("admin_pharmacy_review_mockup.note_placeholder")}
                    />
                  ),
                },
              ]}
            />

            <Divider />

            <Alert
              type="warning"
              showIcon
              message={t("admin_pharmacy_review_mockup.concept_title")}
              description={t("admin_pharmacy_review_mockup.concept_desc")}
            />
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <EditOutlined />
                <span>Pharmacist Summary Draft</span>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <TextArea
                rows={4}
                value={pharmacistSummary}
                onChange={(event) => setPharmacistSummary(event.target.value)}
              />
              <Alert
                type="info"
                showIcon
                message={t("admin_pharmacy_review_mockup.block_goal_title")}
                description={t("admin_pharmacy_review_mockup.block_goal_desc")}
              />
            </Space>
          </Card>

          <Card
            size="small"
            title="Draft response to customer after pharmacist approval"
            style={{ marginBottom: 16 }}
          >
            <TextArea
              rows={6}
              value={customerMessage}
              onChange={(event) => setCustomerMessage(event.target.value)}
            />
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card size="small" title="Conversation history" style={{ marginBottom: 16 }}>
            <Space style={{ marginBottom: 12 }}>
              <Switch checked={showConversation} onChange={setShowConversation} />
              <Text>{t("admin_pharmacy_review_mockup.show_conversation")}</Text>
            </Space>
            {showConversation ? (
              <List
                size="small"
                dataSource={mockConversation}
                renderItem={(item) => (
                  <List.Item>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Tag color={item.role === 'customer' ? 'blue' : 'purple'}>
                        {item.role === 'customer' ? 'Customer' : 'AI intake'}
                      </Tag>
                      <div
                        style={{
                          background: item.role === 'customer' ? '#f0f5ff' : '#faf5ff',
                          borderRadius: 12,
                          padding: 12,
                        }}
                      >
                        {item.text}
                      </div>
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <Text type="secondary">{t("admin_pharmacy_review_mockup.conversation_hidden")}</Text>
            )}
          </Card>

          <Card size="small" title={t("admin_pharmacy_review_mockup.decisions_title")} style={{ marginBottom: 16 }}>
            <List
              size="small"
              dataSource={pharmacistChecklist}
              renderItem={(item) => (
                <List.Item>
                  <Space align="start">
                    <CheckCircleOutlined style={{ color: '#1677ff', marginTop: 4 }} />
                    <span>{item}</span>
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          <Card size="small" title="Recommended layout blocks" style={{ marginBottom: 16 }}>
            <Timeline
              items={[
                {
                  color: 'blue',
                  dot: <UserOutlined />,
                  children: t("admin_pharmacy_review_mockup.step_1"),
                },
                {
                  color: 'purple',
                  dot: <RobotOutlined />,
                  children: '2. AI analysis summary + confidence + missing data',
                },
                {
                  color: 'green',
                  dot: <MedicineBoxOutlined />,
                  children: t("admin_pharmacy_review_mockup.step_3"),
                },
                {
                  color: 'gold',
                  dot: <ClockCircleOutlined />,
                  children: '4. Pharmacist edit/approve/send response',
                },
              ]}
            />
          </Card>

          <Card size="small" title="Action workspace" style={{ marginBottom: 16 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_med_count")}>{t("admin_pharmacy_review_mockup.med_count_unit", { n: selectedRows.length })}</Descriptions.Item>
                <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_estimated_value")}>฿{estimatedTotal.toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label={t("admin_pharmacy_review_mockup.label_reviewer")}>Fake Staff ap8IY</Descriptions.Item>
              </Descriptions>

              <Space wrap>
                <Button type="primary" icon={<SendOutlined />} onClick={simulateApprove}>
                  Approve and send to customer
                </Button>
                <Button>Request more info</Button>
                <Button danger>Refer to doctor</Button>
              </Space>
            </Space>
          </Card>

          <Card size="small" title="What this page should reduce">
            <Space direction="vertical" size={10}>
              <Paragraph style={{ marginBottom: 0 }}>
                <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 8 }} />
                {t("admin_pharmacy_review_mockup.benefit_1")}
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 8 }} />
                {t("admin_pharmacy_review_mockup.benefit_2")}
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 8 }} />
                {t("admin_pharmacy_review_mockup.benefit_3")}
              </Paragraph>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
