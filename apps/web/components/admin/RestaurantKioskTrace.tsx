"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, Space, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

type Trace = {
  requestCode: string; serviceMode: "DINE_IN" | "TAKEAWAY"; status: string;
  submittedAt: string; reviewedAt: string | null; reviewerName: string | null;
  checkId: string | null; checkStatus: string | null; currentOrderId: string | null;
  acceptedOrderId: string | null;
  orderStatus: string | null; settlement: "NOT_APPLICABLE" | "UNPAID" | "PAID" | "RETURNED" | "REVIEW";
  paidAt: string | null; paymentIds: string[]; receiptId: string | null; receiptNo: string | null;
  receiptType: string | null;
  tableCode: string | null; tableName: string | null; areaName: string | null;
  splitGroupNo: number | null; pickupNumber: string | null; pickupStatus: string | null;
  hasSplitDescendant: boolean;
  lineTraceComplete: boolean;
  lines: Array<{
    lineNo: number; checkItemId: string; productName: string; quantity: number;
    currentCheckId: string; checkStatus: string; currentOrderId: string | null;
    orderStatus: string | null; kitchenStatus: string | null;
    returnedQuantity: number; paidAt: string | null;
    settlement: "UNPAID" | "PAID" | "RETURNED" | "PARTIAL_RETURN" | "CANCELLED" | "REVIEW";
  }>;
};

export default function RestaurantKioskTrace({ locationId, lang }: {
  locationId: string | null; lang: "th" | "en";
}) {
  const en = lang === "en";
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [rows, setRows] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setRows([]);
    setError("");
    if (!locationId) return;
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      setLoading(true);
      try {
        const params = new URLSearchParams({ locationId, requestCode: code });
        const response = await fetch(`/api/bms/restaurant-kiosk-trace?${params}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { submissions?: Trace[] };
        if (!controller.signal.aborted) { setRows(body.submissions ?? []); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error && cause.message === "403"
          ? (en ? "You cannot view requests for this branch." : "ไม่มีสิทธิ์ดูคำขอของสาขานี้")
          : cause instanceof Error && cause.message === "400"
            ? (en ? "Enter at least 8 characters from the request code, without spaces or symbols."
              : "กรอกรหัสคำขออย่างน้อย 8 ตัว โดยไม่ใส่ช่องว่างหรือสัญลักษณ์")
            : (en ? "Cannot verify request status. Check the POS before entering a new order."
              : "ตรวจสถานะคำขอไม่ได้ ตรวจใน POS ก่อนคีย์รายการใหม่"));
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [locationId, code, refreshKey, en]);

  const statusText = (row: Trace) => {
    if (row.status === "PENDING") return en ? "Waiting for staff review · not a sale" : "รอพนักงานตรวจ · ยังไม่ใช่ยอดขาย";
    if (row.status === "REJECTED") return en ? "Rejected · not a sale" : "ปฏิเสธแล้ว · ยังไม่ใช่ยอดขาย";
    if (row.status === "EXPIRED") return en ? "Expired · not a sale" : "หมดอายุ · ยังไม่ใช่ยอดขาย";
    if (row.settlement === "PAID") return en ? "All request items paid at POS" : "รายการจากคำขอนี้ชำระครบที่ POS";
    if (row.settlement === "RETURNED") return en ? "Returned or adjusted · check sale history" : "คืนหรือปรับรายการแล้ว · ตรวจประวัติขาย";
    if (row.settlement === "UNPAID") return en ? "Accepted · payment pending" : "รับคำขอแล้ว · ยังไม่ชำระ";
    return en ? "Accepted · verify payment in POS" : "รับคำขอแล้ว · ตรวจการชำระใน POS";
  };

  const date = (value: string) => new Date(value).toLocaleString(en ? "en-GB" : "th-TH", {
    timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short",
  });
  const checkStatus = (value: string) => ({
    OPEN: en ? "Open" : "เปิดอยู่", CLOSING: en ? "Settling" : "กำลังคิดเงิน",
    PAID: en ? "Paid" : "ชำระแล้ว", CANCELLED: en ? "Cancelled" : "ยกเลิกแล้ว",
  } as Record<string, string>)[value] ?? (en ? "Verify in POS" : "ตรวจใน POS");
  const orderStatus = (value: string) => ({
    PENDING: en ? "Pending" : "รอชำระ", COMPLETED: en ? "Completed" : "ขายสำเร็จ",
    RETURNED: en ? "Returned" : "คืนรายการแล้ว", CANCELLED: en ? "Cancelled" : "ยกเลิกแล้ว",
  } as Record<string, string>)[value] ?? (en ? "Verify in POS" : "ตรวจใน POS");
  const pickupStatus = (value: string) => ({
    PREPARING: en ? "Preparing" : "กำลังเตรียม", READY: en ? "Ready" : "พร้อมรับ",
    COLLECTED: en ? "Collected" : "รับแล้ว", CANCELLED: en ? "Cancelled" : "ยกเลิกแล้ว",
  } as Record<string, string>)[value] ?? (en ? "Verify in POS" : "ตรวจใน POS");
  const lineStatus = (value: Trace["lines"][number]["settlement"]) => ({
    UNPAID: en ? "Not paid" : "ยังไม่ชำระ", PAID: en ? "Paid" : "ชำระแล้ว",
    RETURNED: en ? "Returned" : "คืนแล้ว", PARTIAL_RETURN: en ? "Partly returned" : "คืนบางส่วน",
    CANCELLED: en ? "Cancelled" : "ยกเลิกแล้ว", REVIEW: en ? "Verify in POS" : "ตรวจใน POS",
  })[value];
  const kitchenStatus = (value: string) => ({
    NEW: en ? "New" : "รอครัว", PREPARING: en ? "Preparing" : "กำลังทำ",
    READY: en ? "Ready" : "พร้อมเสิร์ฟ", SERVED: en ? "Served" : "เสิร์ฟแล้ว",
    CANCELLED: en ? "Cancelled" : "ยกเลิก",
  } as Record<string, string>)[value] ?? (en ? "Verify in POS" : "ตรวจใน POS");
  return <Card title={en ? "Track kiosk requests" : "ติดตามคำขอจากจอ"}>
    <p>{en ? "Search by the code shown to the customer. A request is a proposal until staff accepts it; payment is recorded only at POS."
      : "ค้นด้วยรหัสที่ลูกค้าเห็น คำขอยังไม่ใช่ออเดอร์จนพนักงานรับ และการชำระเกิดที่ POS เท่านั้น"}</p>
    <Space.Compact style={{ width: "100%", maxWidth: 560 }}>
      <Input aria-label={en ? "Customer request code" : "รหัสคำขอของลูกค้า"}
        placeholder={en ? "Request code (8 characters or full ID)" : "รหัสคำขอ 8 ตัวหรือรหัสเต็ม"}
        value={draft} onChange={(event) => setDraft(event.target.value)}
        onPressEnter={() => setCode(draft.trim())} allowClear />
      <Button type="primary" onClick={() => setCode(draft.trim())}>{en ? "Search" : "ค้นหา"}</Button>
      <Button aria-label={en ? "Refresh request status" : "รีเฟรชสถานะคำขอ"}
        icon={<ReloadOutlined />} onClick={() => setRefreshKey((value) => value + 1)} />
    </Space.Compact>
    {error && <Alert style={{ marginTop: 16 }} type="warning" showIcon closable message={error} />}
    {!error && loading && rows.length === 0 && <p>{en ? "Loading requests…" : "กำลังโหลดคำขอ…"}</p>}
    {!error && !loading && rows.length === 0 && <Empty style={{ marginTop: 20 }}
      description={code ? (en ? "No request with this code in this branch" : "ไม่พบรหัสคำขอนี้ในสาขา")
        : (en ? "No requests in the last 24 hours" : "ไม่มีคำขอใน 24 ชั่วโมงล่าสุด")} />}
    {!error && rows.map((row) => <Card key={row.requestCode} size="small" style={{ marginTop: 16 }}
      title={<Space wrap><Typography.Text strong>{row.requestCode.slice(0, 8).toUpperCase()}</Typography.Text>
        <Tag>{row.serviceMode === "DINE_IN" ? (en ? "Dine in" : "กินในร้าน") : (en ? "Takeaway" : "รับกลับ")}</Tag></Space>}>
      <p><strong>{statusText(row)}</strong> · {date(row.submittedAt)}</p>
      <p>{en ? "Full request ID" : "รหัสคำขอเต็ม"}: <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{row.requestCode}</Typography.Text></p>
      {row.reviewedAt && <p>{en ? "Reviewed" : "ตรวจรับเมื่อ"}: {date(row.reviewedAt)}
        {row.reviewerName ? ` · ${row.reviewerName}` : ""}</p>}
      {row.tableCode && <p>{en ? "Table" : "โต๊ะ"}: {row.areaName ? `${row.areaName} · ` : ""}{row.tableCode} {row.tableName}
        {row.splitGroupNo != null ? ` · ${en ? "split" : "แยกบิล"} ${row.splitGroupNo}` : ""}</p>}
      {row.checkId && <p>{en ? "Check at acceptance" : "บิลตอนรับคำขอ"}: <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{row.checkId}</Typography.Text>
        {row.checkStatus ? ` · ${checkStatus(row.checkStatus)}` : ""}</p>}
      {row.acceptedOrderId && <p>{en ? "Order created at acceptance" : "ออเดอร์ตอนรับคำขอ"}: <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{row.acceptedOrderId}</Typography.Text></p>}
      {row.currentOrderId && <p>{en ? "Current check order" : "ออเดอร์ปัจจุบันของบิล"}: <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{row.currentOrderId}</Typography.Text>
        {row.orderStatus ? ` · ${orderStatus(row.orderStatus)}` : ""}</p>}
      {row.hasSplitDescendant && <Alert type="warning" showIcon closable style={{ marginBottom: 12 }}
        message={en ? "This bill was split. Item details show their current checks; verify each receipt in POS."
          : "บิลนี้ถูกแยก รายละเอียดแสดงบิลปัจจุบันของแต่ละรายการ ตรวจใบเสร็จแต่ละบิลใน POS"} />}
      {row.status === "ACCEPTED" && !row.lineTraceComplete && <Alert type="warning" showIcon closable
        style={{ marginBottom: 12 }} message={en
          ? "Line evidence is incomplete or predates tracking. Verify the check, items and payment in POS."
          : "หลักฐานรายบรรทัดไม่ครบหรือเป็นคำขอก่อนเริ่มติดตาม ตรวจบิล รายการ และการชำระใน POS"} />}
      {row.lines.length > 0 && <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", minHeight: 44, paddingBlock: 10 }}>
          {en ? `Trace ${row.lines.length} ordered items` : `ติดตามรายการอาหาร ${row.lines.length} รายการ`}
        </summary>
        <ol style={{ paddingInlineStart: 22 }}>
          {row.lines.map((line) => <li key={line.checkItemId} style={{ marginBlock: 12, overflowWrap: "anywhere" }}>
            <Typography.Text strong>{line.productName} × {line.quantity}</Typography.Text>
            {" · "}<Tag>{lineStatus(line.settlement)}</Tag>
            {line.returnedQuantity > 0 && <span>{en ? "Returned quantity" : "จำนวนที่คืน"}: {line.returnedQuantity} · </span>}
            <span>{en ? "Current check" : "บิลปัจจุบัน"}: <Typography.Text copyable>{line.currentCheckId}</Typography.Text></span>
            {line.currentOrderId && <span> · {en ? "Order" : "ออเดอร์"}: <Typography.Text copyable>{line.currentOrderId}</Typography.Text></span>}
            {line.kitchenStatus && <span> · {en ? "Kitchen" : "ครัว"}: {kitchenStatus(line.kitchenStatus)}</span>}
          </li>)}
        </ol>
      </details>}
      {row.paidAt && <p>{en ? "Paid" : "ชำระเมื่อ"}: {date(row.paidAt)}</p>}
      {row.paymentIds.length > 0 && <p>{en ? "Payment IDs on acceptance check" : "รหัสการชำระของบิลตอนรับคำขอ"}: {row.paymentIds.map((id) =>
        <Typography.Text key={id} copyable style={{ display: "block", overflowWrap: "anywhere" }}>{id}</Typography.Text>)}</p>}
      {row.receiptNo && <p>{en ? "Document on acceptance check" : "เอกสารของบิลตอนรับคำขอ"}: {row.receiptNo}
        {row.receiptId && <> · <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{row.receiptId}</Typography.Text></>}</p>}
      {row.pickupNumber && <p>{en ? "Pickup number" : "เลขรับอาหาร"}: {row.pickupNumber}
        {row.pickupStatus ? ` · ${pickupStatus(row.pickupStatus)}` : ""}</p>}
      {row.status === "ACCEPTED" && <Button href="/pos/restaurant?screen=kiosk">
        {en ? "Open kiosk inbox in POS and search this code" : "เปิดแผงจอสั่งใน POS แล้วค้นรหัสนี้"}</Button>}
    </Card>)}
    {rows.length >= (code ? 10 : 100) && <p style={{ marginTop: 12 }}>
      {en ? "Showing a limited list. Search by request code for older or specific requests."
        : "รายการถูกจำกัดจำนวน ค้นด้วยรหัสคำขอเพื่อดูรายการเฉพาะหรือรายการเก่า"}</p>}
  </Card>;
}
