"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import {
  DownloadOutlined,
  EditOutlined,
  InboxOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

type Platform = "windows-x64" | "ubuntu-x64" | "macos-arm64";
type PackageType = "server-pos" | "server" | "pos";
type Status = "latest" | "supported" | "legacy" | "deprecated" | "hidden";
type Channel = "pilot" | "stable" | "internal";

type ReleaseAsset = {
  id: string;
  platform: Platform;
  package_type: PackageType;
  version: string;
  channel: Channel;
  status: Status;
  is_latest: boolean;
  original_name: string;
  size_bytes: number;
  sha256: string;
  min_os: string;
  release_notes: string;
  created_at: string;
  updated_at: string;
};

type InferredFileMeta = {
  filename: string;
  platform: Platform | null;
  packageType: PackageType | null;
  version: string | null;
  size: number;
  sha256: string | null;
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body as T;
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

const STATUS_COLORS: Record<Status, string> = {
  latest: "green",
  supported: "blue",
  legacy: "gold",
  deprecated: "default",
  hidden: "red",
};

const PACKAGE_LABELS: Record<PackageType, string> = {
  "server-pos": "Server + POS",
  server: "Server only",
  pos: "POS Desktop only",
};

const PLATFORM_LABELS: Record<Platform, string> = {
  "windows-x64": "Windows x64",
  "ubuntu-x64": "Ubuntu x64",
  "macos-arm64": "macOS Apple Silicon",
};

function platformFromFilename(filename: string): Platform | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".exe")) return "windows-x64";
  if (lower.endsWith(".deb")) return "ubuntu-x64";
  if (lower.endsWith(".pkg") || lower.endsWith(".dmg")) return "macos-arm64";
  return null;
}

function packageTypeFromFilename(filename: string): PackageType | null {
  const lower = filename.toLowerCase();
  if (/(server[-_]?pos|pos[-_]?server|full)/.test(lower)) return "server-pos";
  if (/(^|[-_])pos([-_.]|$)/.test(lower)) return "pos";
  if (/(retail[-_]?local|server|bootstrap)/.test(lower)) return "server";
  return null;
}

function defaultMinOs(platform: Platform | null, packageType: PackageType | null): string {
  if (packageType === "pos") {
    if (platform === "windows-x64") return "Windows x64";
    if (platform === "ubuntu-x64") return "Ubuntu x64 with Secret Service or KWallet";
    if (platform === "macos-arm64") return "macOS 12 Monterey / Apple Silicon";
  }
  if (platform === "windows-x64") return "Windows 11 Pro x64";
  if (platform === "ubuntu-x64") return "Ubuntu 24.04 LTS x64";
  if (platform === "macos-arm64") return "macOS 15 Sequoia / Apple Silicon";
  return "";
}

function inferVersionFromFilename(filename: string): string | null {
  const clean = filename.replace(/\.(exe|deb|pkg|dmg)$/i, "");
  const deb = clean.match(/(?:^|[_-])(\d+\.\d+\.\d+(?:[-+._][a-z0-9]+(?:[._-]\d+)?)?)(?:[_-]amd64|[_-]x64|$)/i);
  if (deb?.[1]) return deb[1].replace(/_/g, "-");
  const generic = clean.match(/(\d+\.\d+\.\d+(?:[-+._][a-z0-9]+(?:[._-]\d+)?)?)/i);
  return generic?.[1]?.replace(/_/g, "-") ?? null;
}

async function sha256Hex(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function RetailLocalReleasesPage() {
  const { lang } = useI18n();
  const th = lang === "th";
  const [rows, setRows] = useState<ReleaseAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<ReleaseAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [inferredFile, setInferredFile] = useState<InferredFileMeta | null>(null);
  const [uploadForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const copy = th ? {
    title: "Retail Local Releases",
    subtitle: "อัปโหลดตัวติดตั้งและจัดการ version ที่หน้าเว็บใช้ดาวน์โหลด",
    upload: "อัปโหลด release",
    refresh: "รีเฟรช",
    platform: "ระบบ",
    packageType: "ประเภทติดตั้ง",
    version: "เวอร์ชัน",
    status: "สถานะ",
    channel: "ช่องทาง",
    file: "ไฟล์",
    size: "ขนาด",
    checksum: "SHA-256",
    minOs: "OS ขั้นต่ำ",
    notes: "Release notes",
    created: "สร้างเมื่อ",
    actions: "จัดการ",
    latest: "Latest",
    save: "บันทึก",
    download: "ทดสอบดาวน์โหลด",
    uploadHint: "Server/แพ็กเกจรวมใช้ .exe, .deb หรือ .pkg ส่วน POS Desktop บน macOS ใช้ .dmg",
    publicRule: "Latest แยกตามระบบและประเภทติดตั้ง หน้าเว็บจึงมี Server + POS, Server only และ POS Desktop only ได้พร้อมกัน",
    inferred: "อ่านจากไฟล์",
    inferredHint: "ระบบเดา platform, version, ขนาด และ SHA-256 จากไฟล์ให้ก่อนบันทึก",
    saved: "บันทึกแล้ว",
    uploaded: "อัปโหลดแล้ว",
  } : {
    title: "Retail Local releases",
    subtitle: "Upload installers and manage the versions used by the public download page.",
    upload: "Upload release",
    refresh: "Refresh",
    platform: "Platform",
    packageType: "Package type",
    version: "Version",
    status: "Status",
    channel: "Channel",
    file: "File",
    size: "Size",
    checksum: "SHA-256",
    minOs: "Minimum OS",
    notes: "Release notes",
    created: "Created",
    actions: "Actions",
    latest: "Latest",
    save: "Save",
    download: "Test download",
    uploadHint: "Server and combined packages use .exe, .deb or .pkg. macOS POS Desktop uses .dmg.",
    publicRule: "Latest is tracked per platform and package type, so Server + POS, Server only, and POS Desktop only can be published together.",
    inferred: "Read from file",
    inferredHint: "The form infers platform, version, size and SHA-256 from the selected installer before saving.",
    saved: "Saved",
    uploaded: "Uploaded",
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await jsonRequest<{ releases: ReleaseAsset[] }>("/api/admin/retail-local/releases");
      setRows(result.releases);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const latestByPlatform = useMemo(() => {
    const result = new Map<string, ReleaseAsset>();
    rows.filter((row) => row.is_latest).forEach((row) => result.set(`${row.platform}:${row.package_type}`, row));
    return result;
  }, [rows]);

  const openUpload = () => {
    uploadForm.resetFields();
    setFileList([]);
    setInferredFile(null);
    setUploadOpen(true);
  };

  const closeUpload = () => {
    setUploadOpen(false);
    uploadForm.resetFields();
    setFileList([]);
    setInferredFile(null);
  };

  const submitUpload = async () => {
    const values = await uploadForm.validateFields();
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.error(copy.file);
      return;
    }

    const body = new FormData();
    body.set("file", file);
    body.set("platform", values.platform);
    body.set("packageType", values.packageType);
    body.set("version", values.version);
    body.set("channel", values.channel);
    body.set("status", values.status);
    body.set("isLatest", values.isLatest ? "true" : "false");
    body.set("minOs", values.minOs);
    body.set("releaseNotes", values.releaseNotes || "");

    setUploading(true);
    try {
      await jsonRequest("/api/admin/retail-local/releases", { method: "POST", body });
      message.success(copy.uploaded);
      closeUpload();
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  const handleUploadChange = async (nextList: UploadFile[]) => {
    const next = nextList.slice(-1);
    setFileList(next);
    const file = next[0]?.originFileObj;
    if (!file) {
      setInferredFile(null);
      return;
    }

    const platform = platformFromFilename(file.name);
    const packageType = packageTypeFromFilename(file.name);
    const version = inferVersionFromFilename(file.name);
    uploadForm.setFieldsValue({
      ...(platform ? { platform, minOs: defaultMinOs(platform, packageType) } : {}),
      ...(packageType ? { packageType } : {}),
      ...(version ? { version } : {}),
    });
    setInferredFile({
      filename: file.name,
      platform,
      packageType,
      version,
      size: file.size,
      sha256: null,
    });
    try {
      const sha256 = await sha256Hex(file);
      setInferredFile((current) => current?.filename === file.name ? { ...current, sha256 } : current);
    } catch {
      setInferredFile((current) => current?.filename === file.name ? { ...current, sha256: null } : current);
    }
  };

  const openEdit = (row: ReleaseAsset) => {
    setEditing(row);
    editForm.setFieldsValue({
      status: row.status,
      isLatest: row.is_latest,
      minOs: row.min_os,
      releaseNotes: row.release_notes,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const values = await editForm.validateFields();
    setSaving(true);
    try {
      await jsonRequest(`/api/admin/retail-local/releases/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      message.success(copy.saved);
      setEditing(null);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ padding: "clamp(12px, 3vw, 24px)", minWidth: 0 }}>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col>
            <Typography.Title level={2} style={{ marginBottom: 4 }}>{copy.title}</Typography.Title>
            <Typography.Text type="secondary">{copy.subtitle}</Typography.Text>
          </Col>
          <Col>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>{copy.refresh}</Button>
              <Button type="primary" icon={<UploadOutlined />} onClick={openUpload}>{copy.upload}</Button>
            </Space>
          </Col>
        </Row>

        <Alert showIcon type="info" message={copy.publicRule} />

        <Row gutter={[16, 16]}>
          {(Object.keys(PLATFORM_LABELS) as Platform[]).map((platform) => (
            <Col xs={24} lg={8} key={platform}>
              <Card size="small" title={PLATFORM_LABELS[platform]}>
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  {(Object.keys(PACKAGE_LABELS) as PackageType[]).map((packageType) => {
                    const release = latestByPlatform.get(`${platform}:${packageType}`);
                    return (
                      <div key={packageType} style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        <Typography.Text strong>{PACKAGE_LABELS[packageType]}</Typography.Text>
                        <Typography.Text type="secondary" ellipsis title={release?.original_name}>
                          {release ? `${release.version} · ${release.original_name}` : "Not published"}
                        </Typography.Text>
                      </div>
                    );
                  })}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>

        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1240 }}
          columns={[
            {
              title: copy.version,
              dataIndex: "version",
              width: 150,
              render: (value, row) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{value}</Typography.Text>
                  {row.is_latest && <Tag color="green">{copy.latest}</Tag>}
                </Space>
              ),
            },
            { title: copy.platform, dataIndex: "platform", width: 140 },
            { title: copy.packageType, dataIndex: "package_type", width: 150, render: (value: PackageType) => PACKAGE_LABELS[value] },
            { title: copy.status, dataIndex: "status", width: 120, render: (value: Status) => <Tag color={STATUS_COLORS[value]}>{value}</Tag> },
            { title: copy.channel, dataIndex: "channel", width: 100 },
            { title: copy.file, dataIndex: "original_name", width: 260, ellipsis: true },
            { title: copy.size, dataIndex: "size_bytes", width: 100, render: formatBytes },
            { title: copy.checksum, dataIndex: "sha256", width: 220, render: (value: string) => <Typography.Text code copyable={{ text: value }}>{value.slice(0, 16)}...</Typography.Text> },
            { title: copy.minOs, dataIndex: "min_os", width: 220, ellipsis: true },
            { title: copy.created, dataIndex: "created_at", width: 170, render: (value: string) => new Date(value).toLocaleString() },
            {
              title: copy.actions,
              width: 220,
              fixed: "right",
              render: (_, row) => (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>{copy.save}</Button>
                  {row.status !== "hidden" && (
                    <Button size="small" icon={<DownloadOutlined />} href={`/api/retail-local/download/${row.id}`}>
                      {copy.download}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Space>

      <Modal
        title={copy.upload}
        open={uploadOpen}
        onCancel={closeUpload}
        onOk={submitUpload}
        confirmLoading={uploading}
        okText={copy.upload}
        width={720}
      >
        <Alert showIcon type="warning" message={copy.uploadHint} style={{ marginBottom: 16 }} />
        <Form form={uploadForm} layout="vertical" initialValues={{ platform: "windows-x64", packageType: "server", channel: "pilot", status: "supported", isLatest: false }}>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item name="platform" label={copy.platform} rules={[{ required: true }]}>
                <Select options={[
                  { value: "windows-x64", label: "Windows x64 (.exe)" },
                  { value: "ubuntu-x64", label: "Ubuntu x64 (.deb)" },
                  { value: "macos-arm64", label: "macOS Apple Silicon (.pkg)" },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="packageType" label={copy.packageType} rules={[{ required: true }]}>
                <Select options={(Object.keys(PACKAGE_LABELS) as PackageType[]).map((value) => ({ value, label: PACKAGE_LABELS[value] }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="version" label={copy.version} rules={[{ required: true }]}>
                <Input placeholder="0.3.0-internal.1" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item name="channel" label={copy.channel} rules={[{ required: true }]}>
                <Select options={["pilot", "stable", "internal"].map((value) => ({ value, label: value }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="status" label={copy.status} rules={[{ required: true }]}>
                <Select options={["supported", "legacy", "deprecated", "hidden"].map((value) => ({ value, label: value }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="isLatest" label={copy.latest} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="minOs" label={copy.minOs} rules={[{ required: true }]}>
            <Input placeholder="Windows 11 Pro x64 / Ubuntu 24.04 LTS x64 / macOS 15 Apple Silicon" />
          </Form.Item>
          <Form.Item name="releaseNotes" label={copy.notes}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Upload.Dragger
            beforeUpload={() => false}
            maxCount={1}
            fileList={fileList}
            onChange={(info) => void handleUploadChange(info.fileList)}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">{copy.file}</p>
          </Upload.Dragger>
          {inferredFile && (
            <Alert
              showIcon
              type="success"
              style={{ marginTop: 16 }}
              message={copy.inferred}
              description={(
                <Space direction="vertical" size={4}>
                  <Typography.Text>{copy.inferredHint}</Typography.Text>
                  <Typography.Text code>{inferredFile.filename}</Typography.Text>
                  <Typography.Text>{copy.platform}: {inferredFile.platform ?? "-"}</Typography.Text>
                  <Typography.Text>{copy.packageType}: {inferredFile.packageType ? PACKAGE_LABELS[inferredFile.packageType] : "-"}</Typography.Text>
                  <Typography.Text>{copy.version}: {inferredFile.version ?? "-"}</Typography.Text>
                  <Typography.Text>{copy.size}: {formatBytes(inferredFile.size)}</Typography.Text>
                  <Typography.Text copyable={inferredFile.sha256 ? { text: inferredFile.sha256 } : false}>
                    {copy.checksum}: {inferredFile.sha256 ? `${inferredFile.sha256.slice(0, 24)}...` : "calculating"}
                  </Typography.Text>
                </Space>
              )}
            />
          )}
        </Form>
      </Modal>

      <Drawer
        title={editing ? `${copy.version} ${editing.version}` : copy.save}
        open={!!editing}
        onClose={() => setEditing(null)}
        width="min(520px, 100vw)"
        extra={<Button type="primary" onClick={saveEdit} loading={saving}>{copy.save}</Button>}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="status" label={copy.status} rules={[{ required: true }]}>
            <Select options={["latest", "supported", "legacy", "deprecated", "hidden"].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="isLatest" label={copy.latest} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="minOs" label={copy.minOs} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="releaseNotes" label={copy.notes}>
            <Input.TextArea rows={8} />
          </Form.Item>
        </Form>
      </Drawer>
    </main>
  );
}
