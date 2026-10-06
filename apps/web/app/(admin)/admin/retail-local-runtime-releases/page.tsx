"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import {
  CloudUploadOutlined,
  DownloadOutlined,
  InboxOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  MANAGED_RUNTIME_PUBLIC_METADATA_FILES,
  MANAGED_RUNTIME_REQUIRED_COMPONENTS,
  MANAGED_RUNTIME_TARGETS,
} from "@/lib/bms/managedRuntimeReleaseContract";

type ReleaseSummary = {
  releaseVersion: string;
  platformTarget: string;
  manifestUrl: string;
  managed: boolean;
  channel: string | null;
  keyId: string | null;
  componentCount: number;
  totalBytes: number;
  publishedAt: string | null;
};

type ReleaseReadiness = {
  ready: boolean;
  message: string;
  keyIds: string[];
};

const REQUIRED_FILES = [
  ...MANAGED_RUNTIME_PUBLIC_METADATA_FILES,
  ...Object.keys(MANAGED_RUNTIME_REQUIRED_COMPONENTS).map((name) => `${name}.artifact`),
];

const isReleaseFile = (name: string) => REQUIRED_FILES.includes(name)
  || /^[a-z0-9][a-z0-9._-]{0,63}\.artifact$/.test(name);

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index < 2 ? 1 : 2)} ${units[index]}`;
}

function uploadRelease(body: FormData, onProgress: (value: number) => void): Promise<ReleaseSummary> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/admin/retail-local/runtime-release-upload");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ"));
    request.onabort = () => reject(new Error("การอัปโหลดถูกยกเลิก"));
    request.onload = () => {
      const payload = request.response || {};
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload.error || `HTTP ${request.status}`));
      } else {
        resolve(payload.release as ReleaseSummary);
      }
    };
    request.send(body);
  });
}

export default function RetailLocalRuntimeReleasesPage() {
  const [rows, setRows] = useState<ReleaseSummary[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [readiness, setReadiness] = useState<ReleaseReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/retail-local/runtime-releases", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setRows(payload.releases || []);
      setBaseUrl(payload.baseUrl || "");
      setReadiness(payload.readiness || null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedNames = useMemo(() => new Set(files.map((item) => item.originFileObj?.name || item.name)), [files]);
  const missing = REQUIRED_FILES.filter((name) => !selectedNames.has(name));
  const totalUploadBytes = files.reduce((sum, item) => sum + Number(item.originFileObj?.size || item.size || 0), 0);

  const submit = async () => {
    const values = await form.validateFields();
    const originals = files.map((item) => item.originFileObj).filter(Boolean) as File[];
    if (!originals.length) return message.error("เลือกโฟลเดอร์ release ก่อน");
    if (missing.length) return message.error(`ไฟล์ยังไม่ครบ: ${missing.join(", ")}`);
    const names = new Set<string>();
    for (const file of originals) {
      if (names.has(file.name)) return message.error(`ชื่อไฟล์ซ้ำ: ${file.name}`);
      names.add(file.name);
    }
    const body = new FormData();
    body.set("releaseVersion", values.releaseVersion.trim());
    body.set("platformTarget", values.platformTarget);
    for (const file of originals) body.append("files", file, file.name);
    Modal.confirm({
      title: `Publish ${values.releaseVersion.trim()} / ${values.platformTarget}?`,
      content: `ระบบจะตรวจ ${originals.length} ไฟล์ (${formatBytes(totalUploadBytes)}) แล้วเผยแพร่เป็นชุด immutable ซึ่งแก้ทับ version/target เดิมไม่ได้`,
      okText: "ตรวจสอบและ Publish",
      cancelText: "ยกเลิก",
      onOk: async () => {
        setUploading(true);
        setProgress(0);
        try {
          await uploadRelease(body, setProgress);
          message.success("ตรวจสอบและเผยแพร่ Managed Runtime release แล้ว");
          setFiles([]);
          form.resetFields();
          await load();
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error), 8);
        } finally {
          setUploading(false);
        }
      },
    });
  };

  return (
    <main style={{ padding: "clamp(12px, 3vw, 24px)", minWidth: 0 }}>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col>
            <Typography.Title level={2} style={{ marginBottom: 4 }}>Managed Runtime Releases</Typography.Title>
            <Typography.Text type="secondary">
              อัปโหลด signed manifest และ component artifacts เป็นหนึ่งชุด แล้วเผยแพร่แบบ immutable
            </Typography.Text>
          </Col>
          <Col>
            <Space wrap>
              <Link href="/admin/retail-local-releases"><Button icon={<DownloadOutlined />}>Installer releases</Button></Link>
              <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>รีเฟรช</Button>
            </Space>
          </Col>
        </Row>

        <Alert
          type="warning"
          showIcon
          closable
          message="หน้านี้ไม่เซ็น release และไม่รับ private key"
          description="เลือกเฉพาะโฟลเดอร์ที่สร้างและเซ็นจาก isolated release process แล้ว ระบบจะตรวจ public-key signature, version, target, component URL, byte size และ SHA-256 ก่อน publish ทั้งชุด ห้ามแก้ไฟล์หลังเซ็น"
        />
        <Alert
          type="info"
          showIcon
          closable
          message="Online Bootstrap ใช้ไฟล์หน้านี้ แต่ปุ่ม Update ใน Desktop ใช้ Installer releases"
          description="หลัง publish ให้เปิด Manifest link จากตารางเพื่อตรวจว่า release host มองเห็น storage แล้ว ส่วนตัวติดตั้ง .exe/.deb/.pkg/.dmg และแจ้งเตือนอัปเดตใน Desktop ยังจัดการที่หน้า Installer releases"
        />
        {readiness ? (
          <Alert
            type={readiness.ready ? "success" : "error"}
            showIcon
            closable
            message={readiness.ready ? "Release verifier พร้อมใช้งาน" : "Release verifier ยังไม่พร้อม — ยังไม่ส่งไฟล์ขึ้น server"}
            description={readiness.ready
              ? `${readiness.message} · trusted key: ${readiness.keyIds.join(", ")}`
              : readiness.message}
          />
        ) : null}

        <Card title={<Space><CloudUploadOutlined />Publish component set</Space>}>
          <Form form={form} layout="vertical">
            <Row gutter={16}>
              <Col xs={24} md={10}>
                <Form.Item name="releaseVersion" label="Release version" rules={[
                  { required: true },
                  { pattern: /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[A-Za-z0-9.-]+)?$/, message: "ใช้ version จริง เช่น 0.2.14-pilot.2" },
                ]}>
                  <Input placeholder="0.2.14-pilot.2" disabled={uploading} />
                </Form.Item>
              </Col>
              <Col xs={24} md={10}>
                <Form.Item name="platformTarget" label="Platform target" rules={[{ required: true }]}>
                  <Select disabled={uploading} options={MANAGED_RUNTIME_TARGETS.map((value) => ({
                    value,
                    label: value === "windows-10-x86" ? `${value} (POS-only)` : value,
                  }))} />
                </Form.Item>
              </Col>
            </Row>

            <Upload.Dragger
              directory
              multiple
              disabled={uploading}
              beforeUpload={() => false}
              fileList={files}
              onChange={(info) => setFiles(info.fileList.filter((file) => isReleaseFile(file.name)).slice(0, 16))}
              onRemove={(file) => {
                setFiles((current) => current.filter((item) => item.uid !== file.uid));
                return true;
              }}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">เลือกหรือลากโฟลเดอร์ platform เช่น macos-15-x64</p>
              <p className="ant-upload-hint">เผยแพร่เฉพาะ release.jws.json, SHA256SUMS และ *.artifact — build descriptor/private key จะไม่ถูกอัปโหลด</p>
            </Upload.Dragger>

            {files.length ? (
              <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
                <Typography.Text>เลือก {files.length} ไฟล์ · {formatBytes(totalUploadBytes)}</Typography.Text>
                {missing.length
                  ? <Alert type="error" showIcon closable message={`ไฟล์ยังไม่ครบ: ${missing.join(", ")}`} />
                  : <Alert type="success" showIcon closable message="พบไฟล์หลักครบ ระบบจะตรวจ signature และ checksum อีกครั้งบน server" />}
              </Space>
            ) : null}

            {uploading ? <Progress percent={progress} status="active" style={{ marginTop: 16 }} /> : null}
            <Button type="primary" size="large" icon={<CloudUploadOutlined />}
              loading={uploading} disabled={!readiness?.ready || !files.length || missing.length > 0}
              onClick={() => void submit()} style={{ marginTop: 16 }}>
              ตรวจสอบและ Publish
            </Button>
          </Form>
        </Card>

        <Card title="Published component sets" extra={baseUrl ? <Typography.Text type="secondary">{baseUrl}</Typography.Text> : null}>
          <Table
            rowKey={(row) => `${row.releaseVersion}:${row.platformTarget}`}
            loading={loading}
            dataSource={rows}
            scroll={{ x: 960 }}
            columns={[
              { title: "Version", dataIndex: "releaseVersion", width: 180, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
              { title: "Target", dataIndex: "platformTarget", width: 210 },
              { title: "Channel", dataIndex: "channel", width: 100, render: (value) => value ? <Tag color={value === "stable" ? "green" : "gold"}>{value}</Tag> : "-" },
              { title: "Components", dataIndex: "componentCount", width: 110 },
              { title: "Size", dataIndex: "totalBytes", width: 120, render: formatBytes },
              { title: "Managed", dataIndex: "managed", width: 150, render: (value) => value ? <Tag color="green">Verified at publish</Tag> : <Tag color="orange">Existing folder</Tag> },
              { title: "Published", dataIndex: "publishedAt", width: 180, render: (value) => value ? new Date(value).toLocaleString() : "-" },
              { title: "Manifest", dataIndex: "manifestUrl", width: 120, fixed: "right", render: (value) => <Button size="small" href={value} target="_blank">เปิด</Button> },
            ]}
          />
        </Card>
      </Space>
    </main>
  );
}
