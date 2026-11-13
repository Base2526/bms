"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";

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
  DeleteOutlined,
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

function uploadRelease(body: FormData, onProgress: (value: number) => void, uiText: UiTranslator = thaiUiText): Promise<ReleaseSummary> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/admin/retail-local/runtime-release-upload");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error(uiText("admin_ui.could_not_connect_to_the_server_8ae9f")));
    request.onabort = () => reject(new Error(uiText("admin_ui.upload_cancelled_fe2e4")));
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
  const uiText = useUiText();
  const [rows, setRows] = useState<ReleaseSummary[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [readiness, setReadiness] = useState<ReleaseReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
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
    if (!originals.length) return message.error(uiText("admin_ui.select_a_release_folder_first_111be"));
    if (missing.length) return message.error(uiText("admin_ui.missing_files_76a02", { v0: missing.join(", ") }));
    const names = new Set<string>();
    for (const file of originals) {
      if (names.has(file.name)) return message.error(uiText("admin_ui.duplicate_filenames_5b190", { v0: file.name }));
      names.add(file.name);
    }
    const body = new FormData();
    body.set("releaseVersion", values.releaseVersion.trim());
    body.set("platformTarget", values.platformTarget);
    for (const file of originals) body.append("files", file, file.name);
    Modal.confirm({
      title: uiText("admin_ui.en_publish_80452", { v0: values.releaseVersion.trim(), v1: values.platformTarget }),
      content: uiText("admin_ui.the_system_will_verify_files_and_publish_an_36f4a", { v0: originals.length, v1: formatBytes(totalUploadBytes) }),
      okText: uiText("admin_ui.verify_and_publish_5221a"),
      cancelText: uiText("admin_ui.cancelled_fba6e"),
      onOk: async () => {
        setUploading(true);
        setProgress(0);
        try {
          await uploadRelease(body, setProgress, uiText);
          message.success(uiText("admin_ui.managed_runtime_release_verified_and_published_97deb"));
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

  const deleteRelease = (row: ReleaseSummary) => {
    const key = `${row.releaseVersion}:${row.platformTarget}`;
    Modal.confirm({
      title: uiText("admin_ui.delete_47ef4", { v0: row.releaseVersion, v1: row.platformTarget }),
      content: uiText("admin_ui.this_removes_the_manifest_and_all_component_files_1691e", { v0: formatBytes(row.totalBytes) }),
      okText: uiText("admin_ui.delete_release_and_all_files_6d032"),
      okType: "danger",
      cancelText: uiText("admin_ui.cancelled_fba6e"),
      onOk: async () => {
        setDeleting(key);
        try {
          const response = await fetch("/api/admin/retail-local/runtime-releases", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ releaseVersion: row.releaseVersion, platformTarget: row.platformTarget }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
          message.success(uiText("admin_ui.deleted_and_its_files_81fd0", { v0: row.releaseVersion, v1: row.platformTarget }));
          await load();
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error), 8);
          throw error;
        } finally {
          setDeleting(null);
        }
      },
    });
  };

  return (
    <main style={{ padding: "clamp(12px, 3vw, 24px)", minWidth: 0 }}>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col>
            <Typography.Title level={2} style={{ marginBottom: 4 }}>{uiText("admin_ui.en_managed_runtime_releases_bd22a")}</Typography.Title>
            <Typography.Text type="secondary">
              {uiText("admin_ui.upload_a_signed_manifest_and_component_artifacts_together_9bd71")}</Typography.Text>
          </Col>
          <Col>
            <Space wrap>
              <Link href="/admin/retail-local-releases"><Button icon={<DownloadOutlined />}>{uiText("admin_ui.en_installer_releases_8ddf9")}</Button></Link>
              <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>{uiText("admin_ui.refresh_78a47")}</Button>
            </Space>
          </Col>
        </Row>

        <Alert
          type="warning"
          showIcon
          closable
          message={uiText("admin_ui.this_page_does_not_sign_releases_or_accept_82073")}
          description={uiText("admin_ui.select_only_a_folder_built_and_signed_by_7c3d3")}
        />
        <Alert
          type="info"
          showIcon
          closable
          message={uiText("admin_ui.online_bootstrap_uses_these_files_desktop_s_update_b8937")}
          description={uiText("admin_ui.after_publishing_open_the_manifest_link_in_the_02e6e")}
        />
        {readiness ? (
          <Alert
            type={readiness.ready ? "success" : "error"}
            showIcon
            closable
            message={readiness.ready ? uiText("admin_ui.release_verifier_ready_aa5c1") : uiText("admin_ui.release_verifier_not_ready_files_have_not_been_947b0")}
            description={readiness.ready
              ? uiText("admin_ui.en_trusted_key_6ac88", { v0: readiness.message, v1: readiness.keyIds.join(", ") })
              : readiness.message}
          />
        ) : null}

        <Card title={<Space><CloudUploadOutlined />{uiText("admin_ui.en_publish_component_set_3e4d3")}</Space>}>
          <Form form={form} layout="vertical">
            <Row gutter={16}>
              <Col xs={24} md={10}>
                <Form.Item name="releaseVersion" label={uiText("admin_ui.en_release_version_03553")} rules={[
                  { required: true },
                  { pattern: /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[A-Za-z0-9.-]+)?$/, message: uiText("admin_ui.use_an_actual_version_e_g_0_2_871c8") },
                ]}>
                  <Input placeholder="0.2.14-pilot.2" disabled={uploading} />
                </Form.Item>
              </Col>
              <Col xs={24} md={10}>
                <Form.Item name="platformTarget" label={uiText("admin_ui.en_platform_target_a8c70")} rules={[{ required: true }]}>
                  <Select disabled={uploading} options={MANAGED_RUNTIME_TARGETS.map((value) => ({
                    value,
                    label: value === "windows-10-x86" ? uiText("admin_ui.en_pos_only_a422b", { v0: value }) : value,
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
              <p className="ant-upload-text">{uiText("admin_ui.select_or_drag_a_platform_folder_e_g_17937")}</p>
              <p className="ant-upload-hint">{uiText("admin_ui.only_release_jws_json_sha256sums_and_artifact_are_cc3cd")}</p>
            </Upload.Dragger>

            {files.length ? (
              <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
                <Typography.Text>{uiText("admin_ui.select_d0690")} {files.length}  {uiText("admin_ui.files_34e34")} {formatBytes(totalUploadBytes)}</Typography.Text>
                {missing.length
                  ? <Alert type="error" showIcon closable message={uiText("admin_ui.missing_files_76a02", { v0: missing.join(", ") })} />
                  : <Alert type="success" showIcon closable message={uiText("admin_ui.all_required_files_found_the_server_will_verify_a9691")} />}
              </Space>
            ) : null}

            {uploading ? <Progress percent={progress} status="active" style={{ marginTop: 16 }} /> : null}
            <Button type="primary" size="large" icon={<CloudUploadOutlined />}
              loading={uploading} disabled={!readiness?.ready || !files.length || missing.length > 0}
              onClick={() => void submit()} style={{ marginTop: 16 }}>
              {uiText("admin_ui.verify_and_publish_5221a")}</Button>
          </Form>
        </Card>

        <Card title={uiText("admin_ui.en_published_component_sets_fb8fe")} extra={baseUrl ? <Typography.Text type="secondary">{baseUrl}</Typography.Text> : null}>
          <Table
            rowKey={(row) => `${row.releaseVersion}:${row.platformTarget}`}
            loading={loading}
            dataSource={rows}
            scroll={{ x: 960 }}
            columns={[
              { title: uiText("admin_ui.en_version_2da60"), dataIndex: "releaseVersion", width: 180, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
              { title: uiText("admin_ui.en_target_61ad5"), dataIndex: "platformTarget", width: 210 },
              { title: uiText("admin_ui.en_channel_879f0"), dataIndex: "channel", width: 100, render: (value) => value ? <Tag color={value === "stable" ? "green" : "gold"}>{value}</Tag> : "-" },
              { title: uiText("admin_ui.en_components_92894"), dataIndex: "componentCount", width: 110 },
              { title: uiText("admin_ui.en_size_b7152"), dataIndex: "totalBytes", width: 120, render: formatBytes },
              { title: uiText("admin_ui.en_managed_7f0ca"), dataIndex: "managed", width: 150, render: (value) => value ? <Tag color="green">{uiText("admin_ui.en_verified_at_publish_7b454")}</Tag> : <Tag color="orange">{uiText("admin_ui.en_existing_folder_4e720")}</Tag> },
              { title: uiText("admin_ui.en_published_483bf"), dataIndex: "publishedAt", width: 180, render: (value) => value ? new Date(value).toLocaleString(uiText.locale) : "-" },
              { title: uiText("admin_ui.en_actions_c3cd6"), key: "actions", width: 155, fixed: "right", render: (_, row) => <Space>
                <Button size="small" href={row.manifestUrl} target="_blank">{uiText("admin_ui.open_22aad")}</Button>
                <Button size="small" danger icon={<DeleteOutlined />}
                  loading={deleting === `${row.releaseVersion}:${row.platformTarget}`}
                  disabled={uploading || deleting !== null}
                  onClick={() => deleteRelease(row)}>{uiText("admin_ui.remove_f535f")}</Button>
              </Space> },
            ]}
          />
        </Card>
      </Space>
    </main>
  );
}
