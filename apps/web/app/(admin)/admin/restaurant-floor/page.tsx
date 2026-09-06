"use client";

import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Popconfirm,
  Radio, Select, Space, Spin, Switch, Tag, Tooltip, Typography, message,
} from "antd";
import {
  DeleteOutlined, DownloadOutlined, EditOutlined, HolderOutlined, PlusOutlined,
  PrinterOutlined, QrcodeOutlined, ReloadOutlined, SaveOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import QRCode from "qrcode";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import RestaurantTableChairs from "@/components/RestaurantTableChairs";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import styles from "./page.module.css";

// ⚠️ ดรอปดาวน์สาขาต้องอ่านจาก bmsRestaurantFloorLocations ซึ่งคืนเฉพาะสาขาที่ผู้ใช้คนนี้
// ดูแลจริง (bms_user_allowed_locations, 9.37) — query ที่คืนทุกสาขาของร้านทำให้พนักงานที่
// ถูกจำกัดสาขาเลือกสาขาอื่นได้แล้วเจอ FORBIDDEN จาก server แทนที่จะไม่เห็นตั้งแต่แรก
const Q_BOOTSTRAP = gql`
  query RestaurantFloorBootstrap {
    bmsStoreProfile { businessArchetype }
    bmsRestaurantFloorLocations { id name active }
  }
`;

const Q_FLOOR = gql`
  query RestaurantFloorAdmin($locationId: ID!) {
    bmsRestaurantFloorAdmin(locationId: $locationId) {
      areas { id name sortOrder tableCount }
      tables { id areaId code name seats shape positionX positionY blocked active status }
    }
  }
`;

const M_CREATE_AREA = gql`
  mutation CreateRestaurantArea($locationId: ID!, $name: String!) {
    bmsCreateRestaurantArea(locationId: $locationId, name: $name) { id }
  }
`;
const M_RENAME_AREA = gql`
  mutation RenameRestaurantArea($areaId: ID!, $name: String!) {
    bmsRenameRestaurantArea(areaId: $areaId, name: $name) { id }
  }
`;
const M_REORDER_AREAS = gql`
  mutation ReorderRestaurantAreas($locationId: ID!, $orderedAreaIds: [ID!]!) {
    bmsReorderRestaurantAreas(locationId: $locationId, orderedAreaIds: $orderedAreaIds) { id }
  }
`;
const M_DELETE_AREA = gql`
  mutation DeleteRestaurantArea($areaId: ID!) { bmsDeleteRestaurantArea(areaId: $areaId) }
`;
const M_CREATE_TABLE = gql`
  mutation CreateRestaurantTable($locationId: ID!, $areaId: ID!, $name: String!, $seats: Int!, $shape: String!) {
    bmsCreateRestaurantTable(locationId: $locationId, areaId: $areaId, name: $name, seats: $seats, shape: $shape) { id }
  }
`;
const M_UPDATE_TABLE = gql`
  mutation UpdateRestaurantTable($tableId: ID!, $patch: BmsRestaurantTablePatchInput!) {
    bmsUpdateRestaurantTable(tableId: $tableId, patch: $patch) { id }
  }
`;
const M_DELETE_TABLE = gql`
  mutation DeleteRestaurantTable($tableId: ID!) { bmsDeleteRestaurantTable(tableId: $tableId) }
`;
const M_SAVE_LAYOUT = gql`
  mutation SaveRestaurantFloorLayout($locationId: ID!, $positions: [BmsRestaurantTablePositionInput!]!) {
    bmsSaveRestaurantFloorLayout(locationId: $locationId, positions: $positions)
  }
`;
const M_ISSUE_TABLE_QR = gql`
  mutation IssueRestaurantTableQr($tableId: ID!, $rotate: Boolean) {
    bmsIssueRestaurantTableQr(tableId: $tableId, rotate: $rotate) {
      token tableId tableCode tableName createdAt
    }
  }
`;

type Location = { id: string; name: string; active: boolean };
type Area = { id: string; name: string; sortOrder: number; tableCount: number };
type DiningTable = {
  id: string;
  areaId: string;
  code: string;
  name: string;
  seats: number;
  shape: "round" | "rect";
  positionX: number;
  positionY: number;
  blocked: boolean;
  active: boolean;
  status: "AVAILABLE" | "OCCUPIED" | "BLOCKED";
};
type Position = { x: number; y: number };
type TableQr = { token: string; tableId: string; tableCode: string; tableName: string; createdAt: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function RestaurantFloorPage() {
  const { t } = useI18n();
  const { can, loading: permissionsLoading } = useBmsPermissions();
  const canManage = can("restaurant.floor.manage");
  const bootstrap = useQuery(Q_BOOTSTRAP, { skip: !canManage, fetchPolicy: "cache-and-network" });
  const locations: Location[] = (bootstrap.data?.bmsRestaurantFloorLocations ?? []).filter((location: Location) => location.active);
  const [locationId, setLocationId] = useState<string | null>(null);
  const floor = useQuery(Q_FLOOR, {
    variables: { locationId: locationId ?? "" },
    skip: !canManage || !locationId,
    fetchPolicy: "cache-and-network",
  });
  const areas: Area[] = floor.data?.bmsRestaurantFloorAdmin?.areas ?? [];
  const tables: DiningTable[] = floor.data?.bmsRestaurantFloorAdmin?.tables ?? [];
  const [areaId, setAreaId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [areaModal, setAreaModal] = useState<{ mode: "create" | "rename"; area?: Area } | null>(null);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [tableQr, setTableQr] = useState<TableQr | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [areaForm] = Form.useForm();
  const [tableCreateForm] = Form.useForm();
  const [tableEditForm] = Form.useForm();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ tableId: string; pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);
  const draggedAreaId = useRef<string | null>(null);

  const [createArea, createAreaState] = useMutation(M_CREATE_AREA);
  const [renameArea, renameAreaState] = useMutation(M_RENAME_AREA);
  const [reorderAreas, reorderAreaState] = useMutation(M_REORDER_AREAS);
  const [deleteArea] = useMutation(M_DELETE_AREA);
  const [createTable, createTableState] = useMutation(M_CREATE_TABLE);
  const [updateTable, updateTableState] = useMutation(M_UPDATE_TABLE);
  const [deleteTable] = useMutation(M_DELETE_TABLE);
  const [saveLayout, saveLayoutState] = useMutation(M_SAVE_LAYOUT);
  const [issueTableQr, issueTableQrState] = useMutation(M_ISSUE_TABLE_QR);

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id);
    if (locationId && !locations.some((location) => location.id === locationId)) {
      setLocationId(locations[0]?.id ?? null);
    }
  }, [locationId, locations]);

  useEffect(() => {
    if (!areaId || !areas.some((area) => area.id === areaId)) setAreaId(areas[0]?.id ?? null);
  }, [areaId, areas]);

  useEffect(() => {
    const next: Record<string, Position> = {};
    for (const table of tables) next[table.id] = { x: table.positionX, y: table.positionY };
    setPositions(next);
    setDirtyIds(new Set());
  }, [floor.data]);

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) ?? null,
    [selectedTableId, tables]
  );

  useEffect(() => {
    if (!selectedTable) {
      tableEditForm.resetFields();
      return;
    }
    tableEditForm.setFieldsValue({
      name: selectedTable.name,
      seats: selectedTable.seats,
      shape: selectedTable.shape,
      blocked: selectedTable.blocked,
      areaId: selectedTable.areaId,
    });
  }, [selectedTable, tableEditForm]);

  async function refreshFloor() {
    await floor.refetch();
  }

  async function submitArea() {
    if (!areaModal || !locationId) return;
    try {
      const { name } = await areaForm.validateFields();
      if (areaModal.mode === "create") {
        await createArea({ variables: { locationId, name } });
        message.success(t("admin_restaurant_floor.area_created"));
      } else {
        await renameArea({ variables: { areaId: areaModal.area!.id, name } });
        message.success(t("admin_restaurant_floor.area_renamed"));
      }
      setAreaModal(null);
      areaForm.resetFields();
      await refreshFloor();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(errorMessage(error, t("admin_restaurant_floor.action_failed")));
    }
  }

  async function removeArea(area: Area) {
    try {
      await deleteArea({ variables: { areaId: area.id } });
      message.success(t("admin_restaurant_floor.area_deleted"));
      await refreshFloor();
    } catch (error) {
      message.error(errorMessage(error, t("admin_restaurant_floor.action_failed")));
    }
  }

  async function dropArea(targetId: string) {
    const sourceId = draggedAreaId.current;
    draggedAreaId.current = null;
    if (!sourceId || sourceId === targetId || !locationId) return;
    const ordered = [...areas];
    const from = ordered.findIndex((area) => area.id === sourceId);
    const to = ordered.findIndex((area) => area.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    try {
      await reorderAreas({ variables: { locationId, orderedAreaIds: ordered.map((area) => area.id) } });
      message.success(t("admin_restaurant_floor.area_reordered"));
      await refreshFloor();
    } catch (error) {
      message.error(errorMessage(error, t("admin_restaurant_floor.action_failed")));
    }
  }

  async function submitNewTable() {
    if (!locationId || !areaId) return;
    try {
      const values = await tableCreateForm.validateFields();
      await createTable({ variables: { locationId, areaId, ...values } });
      message.success(t("admin_restaurant_floor.table_created"));
      setTableModalOpen(false);
      tableCreateForm.resetFields();
      await refreshFloor();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(errorMessage(error, t("admin_restaurant_floor.action_failed")));
    }
  }

  async function saveTableDetails() {
    if (!selectedTable) return;
    try {
      const patch = await tableEditForm.validateFields();
      await updateTable({ variables: { tableId: selectedTable.id, patch } });
      message.success(t("admin_restaurant_floor.table_saved"));
      await refreshFloor();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(errorMessage(error, t("admin_restaurant_floor.action_failed")));
    }
  }

  async function removeTable(table: DiningTable) {
    try {
      await deleteTable({ variables: { tableId: table.id } });
      setSelectedTableId(null);
      message.success(t("admin_restaurant_floor.table_deleted"));
      await refreshFloor();
    } catch (error) {
      message.error(errorMessage(error, t("admin_restaurant_floor.action_failed")));
    }
  }

  function beginTableDrag(event: ReactPointerEvent<HTMLDivElement>, table: DiningTable) {
    const position = positions[table.id] ?? { x: table.positionX, y: table.positionY };
    dragRef.current = {
      tableId: table.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedTableId(table.id);
  }

  function moveTable(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !canvasRef.current) return;
    const table = tables.find((candidate) => candidate.id === drag.tableId);
    if (!table) return;
    const width = table.shape === "rect" ? 128 : 96;
    const height = table.shape === "rect" ? 76 : 96;
    const x = Math.max(0, Math.min(drag.originX + event.clientX - drag.pointerX, canvasRef.current.clientWidth - width));
    const y = Math.max(0, Math.min(drag.originY + event.clientY - drag.pointerY, canvasRef.current.clientHeight - height));
    setPositions((current) => ({ ...current, [drag.tableId]: { x: Math.round(x), y: Math.round(y) } }));
    setDirtyIds((current) => new Set(current).add(drag.tableId));
  }

  function endTableDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  async function persistLayout() {
    if (!locationId || dirtyIds.size === 0) {
      message.info(t("admin_restaurant_floor.layout_clean"));
      return;
    }
    try {
      const changed = [...dirtyIds].map((tableId) => ({ tableId, x: positions[tableId].x, y: positions[tableId].y }));
      await saveLayout({ variables: { locationId, positions: changed } });
      message.success(t("admin_restaurant_floor.layout_saved"));
      await refreshFloor();
    } catch (error) {
      message.error(errorMessage(error, t("admin_restaurant_floor.action_failed")));
    }
  }

  async function showTableQr(rotate = false) {
    if (!selectedTable) return;
    try {
      const result = await issueTableQr({ variables: { tableId: selectedTable.id, rotate } });
      const qr = result.data?.bmsIssueRestaurantTableQr as TableQr | undefined;
      if (!qr) throw new Error(t("admin_restaurant_floor.qr_failed"));
      const url = `${window.location.origin}/q/${encodeURIComponent(qr.token)}`;
      setTableQr(qr);
      setQrImage(await QRCode.toDataURL(url, { width: 720, margin: 2, errorCorrectionLevel: "M" }));
      setQrModalOpen(true);
      if (rotate) message.success(t("admin_restaurant_floor.qr_rotated"));
    } catch (error) {
      message.error(errorMessage(error, t("admin_restaurant_floor.qr_failed")));
    }
  }

  function downloadTableQr() {
    if (!tableQr || !qrImage) return;
    const link = document.createElement("a");
    const safeCode = tableQr.tableCode.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "table";
    link.download = `bms-qr-${safeCode}.png`;
    link.href = qrImage;
    link.click();
  }

  function printTableQr() {
    if (!tableQr || !qrImage) return;
    const popup = window.open("", "_blank", "width=520,height=720");
    if (!popup) return;
    const doc = popup.document;
    doc.title = tableQr.tableName;
    const main = doc.createElement("main");
    main.style.cssText = "font-family:system-ui;text-align:center;padding:32px";
    const appendText = (tag: "h1" | "h2" | "p", value: string) => {
      const node = doc.createElement(tag);
      node.textContent = value;
      main.appendChild(node);
    };
    appendText("h1", tableQr.tableName);
    appendText("p", tableQr.tableCode);
    const image = doc.createElement("img");
    image.alt = `${t("admin_restaurant_floor.table_qr")} ${tableQr.tableName}`;
    image.style.cssText = "width:360px;max-width:100%";
    image.addEventListener("load", () => popup.print(), { once: true });
    image.src = qrImage;
    main.appendChild(image);
    appendText("h2", "สแกนเพื่อสั่งอาหาร");
    appendText("p", "Scan to order");
    doc.body.replaceChildren(main);
  }

  if (!permissionsLoading && !canManage) {
    return <Alert closable type="error" showIcon message={t("admin_restaurant_floor.no_permission")} />;
  }
  if (!bootstrap.loading && bootstrap.data?.bmsStoreProfile?.businessArchetype !== "restaurant") {
    return <Alert closable type="warning" showIcon message={t("admin_restaurant_floor.restaurant_only")} />;
  }

  const areaTables = tables.filter((table) => table.areaId === areaId);
  const statusLabel = (status: DiningTable["status"]) => t(
    status === "OCCUPIED"
      ? "admin_restaurant_floor.status_occupied"
      : status === "BLOCKED"
        ? "admin_restaurant_floor.status_blocked"
        : "admin_restaurant_floor.status_available"
  );

  return (
    <Space direction="vertical" size="large" className={styles.page}>
      <AdminPageHeader title={t("admin_restaurant_floor.title")} />

      <Card className={styles.toolbarCard}>
        <div className={styles.toolbar}>
          {locations.length > 1 && (
            <label className={styles.branchPicker}>
              <span>{t("admin_restaurant_floor.branch")}</span>
              <Select
                value={locationId}
                placeholder={t("admin_restaurant_floor.branch_placeholder")}
                options={locations.map((location) => ({ value: location.id, label: location.name }))}
                onChange={(value) => {
                  setLocationId(value);
                  setAreaId(null);
                  setSelectedTableId(null);
                }}
              />
            </label>
          )}
          <Space wrap>
            <Typography.Text type={dirtyIds.size ? "warning" : "secondary"}>
              {dirtyIds.size ? t("admin_restaurant_floor.layout_dirty") : t("admin_restaurant_floor.drag_table_hint")}
            </Typography.Text>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saveLayoutState.loading}
              disabled={!dirtyIds.size}
              onClick={() => void persistLayout()}
            >
              {t("admin_restaurant_floor.save_layout")}
            </Button>
          </Space>
        </div>
      </Card>

      <Spin spinning={bootstrap.loading || floor.loading} tip={t("admin_restaurant_floor.loading")}>
        {areas.length === 0 ? (
          <Card>
            <Empty
              description={(
                <Space direction="vertical">
                  <span>{t("admin_restaurant_floor.floor_empty")}</span>
                  <Typography.Text type="secondary">{t("admin_restaurant_floor.floor_empty_hint")}</Typography.Text>
                </Space>
              )}
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                areaForm.resetFields();
                setAreaModal({ mode: "create" });
              }}>
                {t("admin_restaurant_floor.add_area")}
              </Button>
            </Empty>
          </Card>
        ) : (
          <>
            <div className={styles.areaBar}>
              <div className={styles.areaTabs} aria-label={t("admin_restaurant_floor.areas")}>
                {areas.map((area) => (
                  <button
                    type="button"
                    key={area.id}
                    draggable
                    className={`${styles.areaTab} ${area.id === areaId ? styles.areaTabActive : ""}`}
                    onClick={() => { setAreaId(area.id); setSelectedTableId(null); }}
                    onDragStart={() => { draggedAreaId.current = area.id; }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void dropArea(area.id)}
                    title={t("admin_restaurant_floor.drag_area_hint")}
                  >
                    <HolderOutlined />
                    <span>{area.name}</span>
                    <span className={styles.areaCount}>{area.tableCount}</span>
                  </button>
                ))}
              </div>
              <Space>
                <Button icon={<PlusOutlined />} onClick={() => {
                  areaForm.resetFields();
                  setAreaModal({ mode: "create" });
                }}>{t("admin_restaurant_floor.add_area")}</Button>
                {areaId && (
                  <Button icon={<EditOutlined />} onClick={() => {
                    const area = areas.find((candidate) => candidate.id === areaId)!;
                    areaForm.setFieldsValue({ name: area.name });
                    setAreaModal({ mode: "rename", area });
                  }}>{t("admin_restaurant_floor.rename_area")}</Button>
                )}
                {areaId && (
                  <Tooltip title={t("admin_restaurant_floor.delete_area_hint")}>
                    <span>
                      <Popconfirm
                        title={t("admin_restaurant_floor.delete_area_confirm")}
                        onConfirm={() => void removeArea(areas.find((candidate) => candidate.id === areaId)!)}
                      >
                        <Button danger icon={<DeleteOutlined />} disabled={areas.find((area) => area.id === areaId)?.tableCount !== 0}>
                          {t("admin_restaurant_floor.delete_area")}
                        </Button>
                      </Popconfirm>
                    </span>
                  </Tooltip>
                )}
              </Space>
            </div>

            <div className={styles.editorGrid}>
              <Card
                className={styles.canvasCard}
                title={areas.find((area) => area.id === areaId)?.name}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => {
                  tableCreateForm.setFieldsValue({ seats: 2, shape: "round" });
                  setTableModalOpen(true);
                }}>{t("admin_restaurant_floor.add_table")}</Button>}
              >
                <div ref={canvasRef} className={styles.canvas}>
                  {areaTables.length === 0 && (
                    <div className={styles.canvasEmpty}>{t("admin_restaurant_floor.area_empty")}</div>
                  )}
                  {areaTables.map((table) => {
                    const position = positions[table.id] ?? { x: table.positionX, y: table.positionY };
                    return (
                      <div
                        key={table.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${table.name} · ${statusLabel(table.status)}`}
                        className={`${styles.table} ${styles[table.shape]} ${styles[table.status.toLowerCase()]} ${selectedTableId === table.id ? styles.tableSelected : ""}`}
                        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
                        onPointerDown={(event) => beginTableDrag(event, table)}
                        onPointerMove={moveTable}
                        onPointerUp={endTableDrag}
                        onPointerCancel={endTableDrag}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedTableId(table.id); }}
                      >
                        <RestaurantTableChairs seats={table.seats} shape={table.shape} />
                        <strong>{table.code}</strong>
                        <span>{table.name}</span>
                        <small>{table.seats} · {statusLabel(table.status)}</small>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card className={styles.sidePanel} title={selectedTable ? t("admin_restaurant_floor.edit_table") : undefined}>
                {!selectedTable ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_restaurant_floor.select_table")} />
                ) : (
                  <Space direction="vertical" size="middle" className={styles.fullWidth}>
                    <div className={styles.tableHeading}>
                      <Typography.Title level={4}>{selectedTable.code}</Typography.Title>
                      <Tag color={selectedTable.status === "OCCUPIED" ? "orange" : selectedTable.status === "BLOCKED" ? "default" : "green"}>
                        {statusLabel(selectedTable.status)}
                      </Tag>
                    </div>
                    {selectedTable.status === "OCCUPIED" && (
                      <Alert closable type="warning" showIcon message={t("admin_restaurant_floor.occupied_locked")} />
                    )}
                    <Form form={tableEditForm} layout="vertical" disabled={selectedTable.status === "OCCUPIED"}>
                      <Form.Item name="name" label={t("admin_restaurant_floor.table_name")} rules={[{ required: true, message: t("admin_restaurant_floor.table_name_required") }]}>
                        <Input />
                      </Form.Item>
                      <Form.Item name="seats" label={t("admin_restaurant_floor.seats")} rules={[{ required: true }]}>
                        <InputNumber min={1} max={100} className={styles.fullWidth} />
                      </Form.Item>
                      <Form.Item name="shape" label={t("admin_restaurant_floor.shape")}>
                        <Radio.Group optionType="button" buttonStyle="solid" options={[
                          { value: "round", label: t("admin_restaurant_floor.shape_round") },
                          { value: "rect", label: t("admin_restaurant_floor.shape_rect") },
                        ]} />
                      </Form.Item>
                      <Form.Item name="areaId" label={t("admin_restaurant_floor.move_area")}>
                        <Select options={areas.map((area) => ({ value: area.id, label: area.name }))} />
                      </Form.Item>
                      <Form.Item name="blocked" label={t("admin_restaurant_floor.blocked")} valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Form>
                    <Typography.Text type="secondary">{t("admin_restaurant_floor.table_unsaved_hint")}</Typography.Text>
                    <Button
                      type="primary"
                      loading={updateTableState.loading}
                      disabled={selectedTable.status === "OCCUPIED"}
                      onClick={() => void saveTableDetails()}
                    >{t("admin_restaurant_floor.save_table")}</Button>
                    <Button
                      block
                      icon={<QrcodeOutlined />}
                      loading={issueTableQrState.loading}
                      onClick={() => void showTableQr(false)}
                    >{t("admin_restaurant_floor.table_qr")}</Button>
                    <Tooltip title={selectedTable.status === "OCCUPIED" ? t("admin_restaurant_floor.occupied_locked") : undefined}>
                      <span>
                        <Popconfirm title={t("admin_restaurant_floor.delete_table_confirm")} onConfirm={() => void removeTable(selectedTable)}>
                          <Button block danger icon={<DeleteOutlined />} disabled={selectedTable.status === "OCCUPIED"}>
                            {t("admin_restaurant_floor.delete_table")}
                          </Button>
                        </Popconfirm>
                      </span>
                    </Tooltip>
                  </Space>
                )}
              </Card>
            </div>
          </>
        )}
      </Spin>

      <Modal
        open={Boolean(areaModal)}
        title={areaModal?.mode === "rename" ? t("admin_restaurant_floor.rename_area") : t("admin_restaurant_floor.add_area")}
        okText={t("admin_restaurant_floor.save")}
        cancelText={t("admin_restaurant_floor.cancel")}
        confirmLoading={createAreaState.loading || renameAreaState.loading || reorderAreaState.loading}
        onOk={() => void submitArea()}
        onCancel={() => setAreaModal(null)}
      >
        <Form form={areaForm} layout="vertical">
          <Form.Item name="name" label={t("admin_restaurant_floor.area_name")} rules={[{ required: true, message: t("admin_restaurant_floor.area_name_required") }]}>
            <Input maxLength={80} autoFocus />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={qrModalOpen}
        title={tableQr ? `${t("admin_restaurant_floor.table_qr")} · ${tableQr.tableName}` : t("admin_restaurant_floor.table_qr")}
        footer={null}
        onCancel={() => setQrModalOpen(false)}
      >
        <div className={styles.qrPanel}>
          {qrImage && <img src={qrImage} alt={tableQr ? `${t("admin_restaurant_floor.table_qr")} ${tableQr.tableName}` : "QR"} />}
          <Typography.Title level={4}>{tableQr?.tableName}</Typography.Title>
          <Typography.Text type="secondary">{t("admin_restaurant_floor.qr_scan_hint")}</Typography.Text>
          <Space wrap className={styles.qrActions}>
            <Button icon={<DownloadOutlined />} onClick={downloadTableQr}>{t("admin_restaurant_floor.qr_download")}</Button>
            <Button icon={<PrinterOutlined />} onClick={printTableQr}>{t("admin_restaurant_floor.qr_print")}</Button>
            <Popconfirm
              title={t("admin_restaurant_floor.qr_rotate_confirm")}
              description={t("admin_restaurant_floor.qr_rotate_warning")}
              onConfirm={() => void showTableQr(true)}
            >
              <Button danger icon={<ReloadOutlined />} loading={issueTableQrState.loading}>{t("admin_restaurant_floor.qr_rotate")}</Button>
            </Popconfirm>
          </Space>
        </div>
      </Modal>

      <Modal
        open={tableModalOpen}
        title={t("admin_restaurant_floor.add_table")}
        okText={t("admin_restaurant_floor.save")}
        cancelText={t("admin_restaurant_floor.cancel")}
        confirmLoading={createTableState.loading}
        onOk={() => void submitNewTable()}
        onCancel={() => setTableModalOpen(false)}
      >
        <Form form={tableCreateForm} layout="vertical" initialValues={{ seats: 2, shape: "round" }}>
          <Form.Item name="name" label={t("admin_restaurant_floor.table_name")} rules={[{ required: true, message: t("admin_restaurant_floor.table_name_required") }]}>
            <Input maxLength={80} autoFocus />
          </Form.Item>
          <Form.Item name="seats" label={t("admin_restaurant_floor.seats")} rules={[{ required: true }]}>
            <InputNumber min={1} max={100} className={styles.fullWidth} />
          </Form.Item>
          <Form.Item name="shape" label={t("admin_restaurant_floor.shape")}>
            <Radio.Group optionType="button" buttonStyle="solid" options={[
              { value: "round", label: t("admin_restaurant_floor.shape_round") },
              { value: "rect", label: t("admin_restaurant_floor.shape_rect") },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
