"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Col, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tabs, Typography, message } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

type Location = { id: string; name: string };
type Purchase = { id: string; intake_id: string; location_id: string; supplier_name: string; vessel_registration: string | null;
  fish_name: string; sku: string; size: string; bill_grams: number; received_grams: number;
  unit_price_per_kg: string | null; purchase_amount: string; extra_amount: string; lot_no: string | null };
type Supplier = { supplier_name: string; sku: string; size: string; line_count: number; received_grams: string;
  bill_grams: string; purchase_amount: string; observed_baht_per_kg: string | null };
type StockLot = { lot_id: string; location_id: string; sku: string; name: string; size: string; lot_no: string;
  qty_grams: number; expiry_date: string | null; usable: boolean; count_id: string | null; version: number | null;
  ready_grams: number; cold_grams: number; other_grams: number; storageCurrent: boolean };
type Profit = { sku: string; size: string; customer_id: string | null; customer_name: string | null; lot_id: string;
  lot_no: string; grams: number; revenue: number; cost: number | null; profit: number | null };
type AllocatedProfitRow = { sku: string; size: string; lotId: string; lotNo: string; customerId: string | null;
  customerName: string | null; revenue: string; grossProfit: string; allocatedSharedCost: string; allocatedNetProfit: string };
type AllocatedProfit = { status: string; day: string; month: string; rows?: AllocatedProfitRow[];
  monthlyMerchandiseRevenue?: string; monthlySharedCost?: string; selectedDaySharedCost?: string };
type Plan = { id: string; location_id: string; customer_id: string; customer_name: string; due_on: string | null;
  note: string | null; arDue: number; pendingPayment: number; lines: Array<{ sku: string; size: string; agreedGrams: number; orderedGrams: number;
    shippedGrams: number; remainingGrams: number }>; orders: Array<{ orderId: string; status: string }> };
type DeliveryRow = Plan["lines"][number] & { id: string; customerName: string; dueOn: string | null; arDue: number; pendingPayment: number; plan: Plan };
type Snapshot = { day: string; locations: Location[];
  purchases: { totals: { lineCount: number; billGrams: number; receivedGrams: number; purchaseAmount: number; extraAmount: number };
    rows: Purchase[]; truncated: boolean; suppliers: Supplier[]; suppliersTruncated: boolean };
  stock: { totalGrams: number; usableGrams: number; lotCount: number; rows: StockLot[]; truncated: boolean };
  production: Array<{ location_id: string; sku: string; size: string; used_grams: string; batch_count: number }>;
  profit: { rows: Profit[]; truncated: boolean; missingLotCount: number; missingCostEvents: number };
  deliveries: { plans: Plan[]; truncated: boolean } };
type Options = { locations: Location[]; customers: Array<{ id: string; name: string }>;
  products: Array<{ sku: string; size: string; name: string }>;
  orders: Array<{ id: string; status: string; customer_id: string; customer_name: string; location_id: string }>;
  truncated: boolean };

const emptyOptions: Options = { locations: [], customers: [], products: [], orders: [], truncated: false };

async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

export default function FishOwnerPage() {
  const { lang } = useI18n();
  const L = (th: string, en: string) => lang === "en" ? en : th;
  const kg = (grams: number | string | null | undefined) => `${(Number(grams ?? 0) / 1000).toLocaleString(lang === "en" ? "en-GB" : "th-TH",{maximumFractionDigits:3})} ${L("กก.","kg")}`;
  const baht = (value: number | string | null | undefined) => `${Number(value ?? 0).toLocaleString(lang === "en" ? "en-GB" : "th-TH",{minimumFractionDigits:2,maximumFractionDigits:2})} ${L("บาท","THB")}`;
  const qtyToGrams = (value: unknown): number => {
    const s = String(value ?? "").trim();
    if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/.test(s)) throw new Error(L("กรอกน้ำหนักกิโลกรัมทศนิยมไม่เกิน 3 ตำแหน่ง","Enter kg with up to 3 decimal places"));
    const [whole, fraction = ""] = s.split(".");
    const result = Number(whole) * 1000 + Number(fraction.padEnd(3,"0"));
    if (!result || result > 2147483647) throw new Error(L("น้ำหนักต้องมากกว่า 0 และไม่เกินขนาดที่ระบบรับได้","Weight must be positive and within the supported range"));
    return result;
  };
  const zoneToGrams = (value: unknown): number => {
    const s = String(value ?? "").trim();
    if (/^0(?:\.0{1,3})?$/.test(s)) return 0;
    return qtyToGrams(s);
  };
  const { can, loading: permsLoading } = useBmsPermissions();
  const mayRead = ["report.view","purchase.view","product.view","shipping.view","ar.view"].every(perm => can(perm as Parameters<typeof can>[0]));
  const mayNet = mayRead && ["expense.view","delivery.settlement.view","tax.document.view"].every(perm => can(perm as Parameters<typeof can>[0]));
  const [day, setDay] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [net, setNet] = useState<AllocatedProfit | null>(null);
  const [netBusy, setNetBusy] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);
  const [selectedLot, setSelectedLot] = useState<StockLot | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planKey, setPlanKey] = useState(() => crypto.randomUUID());
  const [countForm] = Form.useForm();
  const [planForm] = Form.useForm();
  const [linkForm] = Form.useForm();

  const refresh = useCallback(async (chosenDay = day) => {
    setBusy(true);
    setNet(null); setNetError(null);
    try {
      const result = await json(await fetch(`/api/bms/fish-owner${chosenDay ? `?day=${encodeURIComponent(chosenDay)}` : ""}`, { credentials: "include" }));
      setSnapshot(result); setDay(result.day); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [day]);
  const loadOptions = useCallback(async (search = "") => {
    try {
      const result = await json(await fetch(`/api/bms/fish-owner/options?search=${encodeURIComponent(search)}`, { credentials: "include" }));
      setOptions(result);
    } catch (e) { message.error((e as Error).message); }
  }, []);
  useEffect(() => { if (mayRead) void refresh(""); }, [mayRead]);
  useEffect(() => { if (can("order.create") || can("shipping.update")) void loadOptions(); }, [can("order.create"),can("shipping.update")]);

  async function post(body: unknown) {
    setBusy(true);
    try {
      const result = await json(await fetch("/api/bms/fish-owner", { method: "POST", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      message.success(result.status === "REPLAYED" ? L("รายการนี้บันทึกไว้แล้ว","Already saved") : L("บันทึกแล้ว","Saved"));
      await refresh();
      return true;
    } catch (e) { message.error((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function loadNet() {
    if (!snapshot) return;
    setNetBusy(true); setNetError(null);
    try {
      const result = await json(await fetch(`/api/bms/fish-owner/net?day=${encodeURIComponent(snapshot.day)}`, { credentials:"include" }));
      setNet(result);
    } catch (e) { setNet(null); setNetError((e as Error).message); }
    finally { setNetBusy(false); }
  }
  function beginCount(lot: StockLot) {
    setSelectedLot(lot);
    countForm.setFieldsValue({ ready: lot.storageCurrent ? (lot.ready_grams / 1000).toFixed(3) : (lot.qty_grams / 1000).toFixed(3),
      cold: lot.storageCurrent ? (lot.cold_grams / 1000).toFixed(3) : "0", other: lot.storageCurrent ? (lot.other_grams / 1000).toFixed(3) : "0" });
  }
  async function confirmCount() {
    if (!selectedLot) return;
    try {
      const v = await countForm.validateFields();
      const zones = ([ ["READY",v.ready],["COLD_ROOM",v.cold],["OTHER",v.other] ] as const)
        .map(([zone,value]) => ({ zone, grams: zoneToGrams(value) }));
      if (zones.reduce((sum,row) => sum + row.grams,0) !== selectedLot.qty_grams) throw new Error(L("ผลรวมแต่ละตำแหน่งต้องตรงกับยอดล็อตปัจจุบัน","Zone totals must equal the lot's current weight"));
      Modal.confirm({ title: L("ยืนยันตำแหน่งปลาที่นับจริง","Confirm physical placement"),
        content: `${selectedLot.name} ${selectedLot.lot_no} · ${kg(selectedLot.qty_grams)} · ${zones.map(x => `${x.zone} ${kg(x.grams)}`).join(" / ")}`,
        okText: L("ยืนยัน","Confirm"), onOk: async () => {
          if (await post({ action:"storage-count", confirmed:true, input:{ lotId:selectedLot.lot_id,
            expectedLotGrams:selectedLot.qty_grams, expectedVersion:selectedLot.version ?? null,zones } })) setSelectedLot(null);
        } });
    } catch (e) { if (!(e as {errorFields?: unknown}).errorFields) message.error((e as Error).message); }
  }
  async function confirmPlan() {
    try {
      const v = await planForm.validateFields();
      const lines = (v.lines as Array<{ product: string; kg: string }>).map(row => {
        const product = JSON.parse(row.product) as [string,string];
        return { sku:product[0],size:product[1],agreedGrams:qtyToGrams(row.kg) };
      });
      Modal.confirm({ title:L("ยืนยันแผนส่งปลา","Confirm fish delivery plan"),
        content:`${lines.length} ${L("รายการ","lines")} · ${kg(lines.reduce((sum,row)=>sum+row.agreedGrams,0))}`,
        okText:L("ยืนยัน","Confirm"),onOk:async()=>{
          if (await post({ action:"delivery-plan",confirmed:true,input:{customerId:v.customerId,locationId:v.locationId,
            dueOn:v.dueOn || null,note:v.note || null,requestKey:planKey,lines} })) {
            setPlanOpen(false);planForm.resetFields();setPlanKey(crypto.randomUUID());
          }
        } });
    } catch (e) { if (!(e as {errorFields?: unknown}).errorFields) message.error((e as Error).message); }
  }
  async function confirmLink() {
    if (!selectedPlan) return;
    try {
      const v = await linkForm.validateFields();
      const order = options.orders.find(row=>row.id===v.orderId);
      Modal.confirm({title:L("ยืนยันผูกออร์เดอร์กับแผนส่งปลา","Confirm order link"),
        content:`${selectedPlan.customer_name} · ${order?.id ?? v.orderId} · ${order?.status ?? ""}`,
        okText:L("ยืนยัน","Confirm"),onOk:async()=>{
          if (await post({action:"delivery-link",confirmed:true,planId:selectedPlan.id,orderId:v.orderId})) {
            setSelectedPlan(null);linkForm.resetFields();
          }
        }});
    } catch { /* Form displays required field. */ }
  }
  const locationName = (id:string) => snapshot?.locations.find(x=>x.id===id)?.name ?? id;
  const profitGroups = useMemo(() => {
    const rows = snapshot?.profit.rows ?? [];
    const group = (key:(row:Profit)=>string,label:(row:Profit)=>string) => {
      const map = new Map<string,{key:string;label:string;grams:number;revenue:number;cost:number|null}>();
      for (const row of rows) {
        const id=key(row), old=map.get(id)??{key:id,label:label(row),grams:0,revenue:0,cost:0};
        old.grams+=row.grams;old.revenue+=row.revenue;old.cost=old.cost===null||row.cost===null?null:old.cost+row.cost;
        map.set(id,old);
      }
      return [...map.values()].sort((a,b)=>b.revenue-a.revenue);
    };
    return { fish:group(x=>`${x.sku}/${x.size}`,x=>`${x.sku} / ${x.size}`),
      lot:group(x=>x.lot_id,x=>`${x.sku} / ${x.size} · ${x.lot_no}`),
      customer:group(x=>x.customer_id??"UNKNOWN",x=>x.customer_name??L("ไม่ระบุลูกค้า","Unidentified")) };
  },[snapshot,lang]);
  const netGroups = useMemo(() => {
    const rows = net?.status === "READY" ? net.rows ?? [] : [];
    const group = (key:(row:AllocatedProfitRow)=>string,label:(row:AllocatedProfitRow)=>string) => {
      const map = new Map<string,{key:string;label:string;revenue:number;grossProfit:number;allocatedSharedCost:number;allocatedNetProfit:number}>();
      for (const row of rows) {
        const id=key(row), old=map.get(id)??{key:id,label:label(row),revenue:0,grossProfit:0,allocatedSharedCost:0,allocatedNetProfit:0};
        old.revenue+=Number(row.revenue);old.grossProfit+=Number(row.grossProfit);
        old.allocatedSharedCost+=Number(row.allocatedSharedCost);old.allocatedNetProfit+=Number(row.allocatedNetProfit);
        map.set(id,old);
      }
      return [...map.values()].sort((a,b)=>b.revenue-a.revenue);
    };
    return { fish:group(x=>`${x.sku}/${x.size}`,x=>`${x.sku} / ${x.size}`),
      lot:group(x=>x.lotId,x=>`${x.sku} / ${x.size} · ${x.lotNo}`),
      customer:group(x=>x.customerId??"UNKNOWN",x=>x.customerName??L("ไม่ระบุลูกค้า","Unidentified")) };
  },[net,lang]);
  if (!permsLoading && !mayRead) return <Alert closable type="error" showIcon message={L("ต้องมีสิทธิ์รายงาน จัดซื้อ สินค้า จัดส่ง และลูกหนี้","Requires report, purchase, product, shipping and AR read permissions")}/>;
  const t = snapshot?.purchases.totals;
  const profitCols = [
    {title:L("รายการ","Item"),dataIndex:"label"},
    {title:L("น้ำหนักสุทธิ","Net weight"),dataIndex:"grams",render:(v:number)=>kg(v)},
    {title:L("ยอดขาย","Revenue"),dataIndex:"revenue",render:(v:number)=>baht(v)},
    {title:L("ต้นทุน","Cost"),dataIndex:"cost",render:(v:number|null)=>v===null?L("ไม่ทราบ","Unknown"):baht(v)},
    {title:L("ส่วนต่างสินค้า-ต้นทุน (ประมาณ)","Estimated line margin"),render:(_:unknown,r:{revenue:number;cost:number|null})=>r.cost===null?L("ไม่ทราบ","Unknown"):baht(r.revenue-r.cost)},
  ];
  return <Space direction="vertical" size="large" style={{width:"100%"}}>
    <AdminPageHeader title={L("ภาพรวมเจ้าของล้งปลา","Fish dock owner view")}/>
    <Alert closable type="info" showIcon message={L("ข้อมูลจริงจากใบรับปลา สต็อก ออร์เดอร์ งานผลิต และลูกหนี้","Verified records from receipts, stock, orders, production and AR")}
      description={L("ตำแหน่งห้องเย็นเป็นผลตรวจนับล่าสุด หากล็อตเปลี่ยนต้องนับใหม่ ส่วนต่างตามล็อตจัดสรรต้นทุนสต็อกที่ตัดจริงตามกรัม รายได้ใช้ยอดสินค้าในบิลก่อนส่วนลดรวมและ VAT จึงเป็นประมาณการ ไม่ใช่กำไรสุทธิตามบัญชี","Cold-room placement is a physical count that becomes stale after a lot change. Lot margin apportions actual inventory COGS by grams against recorded line revenue before order-wide discounts and VAT, so it is an estimate, not statutory net profit.")}/>
    <Space wrap><Input type="date" value={day} onChange={e=>setDay(e.target.value)}/>
      <Button icon={<ReloadOutlined/>} loading={busy} onClick={()=>void refresh()}>{L("ดูข้อมูลวันที่เลือก","Load day")}</Button>
      <Link href="/admin/fish-intake"><Button>{L("รับปลา / นำเข้าประวัติ","Fish receipts / history")}</Button></Link>
      <Link href="/admin/reports"><Button>{L("รายงานการเงิน","Financial reports")}</Button></Link></Space>
    {error&&<Alert closable type="error" showIcon message={error}/>}
    <Row gutter={[12,12]}>
      <Col xs={12} lg={6}><Card loading={busy&&!snapshot}><Statistic title={L("ยอดซื้อวันที่เลือก","Fish purchased on selected day")} value={t?.purchaseAmount??0} suffix="฿" precision={2}/></Card></Col>
      <Col xs={12} lg={6}><Card loading={busy&&!snapshot}><Statistic title={L("น้ำหนักตามบิล","Billed weight")} value={(t?.billGrams??0)/1000} suffix={L("กก.","kg")} precision={3}/></Card></Col>
      <Col xs={12} lg={6}><Card loading={busy&&!snapshot}><Statistic title={L("รับจริง","Actual received")} value={(t?.receivedGrams??0)/1000} suffix={L("กก.","kg")} precision={3}/></Card></Col>
      <Col xs={12} lg={6}><Card loading={busy&&!snapshot}><Statistic title={L("ส่วนต่าง","Variance")} value={((t?.receivedGrams??0)-(t?.billGrams??0))/1000} suffix={L("กก.","kg")} precision={3}/></Card></Col>
    </Row>
    <Card title={L("ซื้อจากแพไหน ราคาเท่าไร","Supplier and fish purchase comparison")}>
      {snapshot?.purchases.suppliersTruncated&&<Alert closable type="warning" message={L("รายการเกิน 500 แถว ให้เลือกวันที่แคบลง","Over 500 rows; narrow the date")}/>}
      <Table rowKey={r=>`${r.supplier_name}/${r.sku}/${r.size}`} size="small" scroll={{x:850}} pagination={{pageSize:10}}
        dataSource={snapshot?.purchases.suppliers??[]} columns={[
          {title:L("แพ/ผู้ขาย","Supplier"),dataIndex:"supplier_name"},{title:L("ปลา","Fish"),dataIndex:"sku"},
          {title:L("ไซซ์","Size"),dataIndex:"size"},{title:L("รับจริง","Received"),dataIndex:"received_grams",render:(v:string)=>kg(v)},
          {title:L("ยอดค่าปลา","Goods amount"),dataIndex:"purchase_amount",render:(v:string)=>baht(v)},
          {title:L("ราคาเฉลี่ยจากยอดจริง/กก.","Observed THB/kg"),dataIndex:"observed_baht_per_kg",render:(v:string|null)=>v==null?"—":baht(v)},
        ]}/>
    </Card>
    <Card title={L("น้ำหนักตามบิลเทียบกับรับจริง","Billed versus actual weight")}>
      {snapshot?.purchases.truncated&&<Alert closable type="warning" message={L("แสดง 500 รายการแรก แต่ยอดรวมด้านบนครบ","Showing first 500 rows; totals above are complete")}/>}
      <Table rowKey="id" size="small" scroll={{x:1000}} pagination={{pageSize:10}} dataSource={snapshot?.purchases.rows??[]}
        columns={[{title:L("แพ","Supplier"),dataIndex:"supplier_name"},{title:L("เรือ/รถ","Vessel/vehicle"),dataIndex:"vessel_registration"},
          {title:L("ปลา/ไซซ์","Fish/size"),render:(_:unknown,r:Purchase)=>`${r.fish_name} / ${r.size}`},
          {title:L("ตามบิล","Billed"),dataIndex:"bill_grams",render:(v:number)=>kg(v)},
          {title:L("รับจริง","Actual"),dataIndex:"received_grams",render:(v:number)=>kg(v)},
          {title:L("ผลต่าง","Variance"),render:(_:unknown,r:Purchase)=>kg(r.received_grams-r.bill_grams)},
          {title:L("ยอดซื้อ","Amount"),dataIndex:"purchase_amount",render:(v:string)=>baht(v)}]}/>
    </Card>
    <Card title={L("ปลาอยู่สาขาไหน ห้องเย็นเท่าไร","Stock by branch, lot and cold room")}
      extra={can("inventory.count.apply")?L("กดนับตำแหน่งเพื่อยืนยันยอดจริง","Count placement to verify physical positions"):null}>
      <Space wrap><Typography.Text>{L("สต็อกจริง","Physical")}: <b>{kg(snapshot?.stock.totalGrams)}</b></Typography.Text>
        <Typography.Text>{L("ล็อตที่ใช้ได้ก่อนหักยอดจอง","Usable lots before reservations")}: <b>{kg(snapshot?.stock.usableGrams)}</b></Typography.Text></Space>
      {snapshot?.stock.truncated&&<Alert closable type="warning" message={L("แสดง 500 ล็อตแรก ไม่ใช่ล็อตทั้งหมด","Showing first 500 lots")}/>}
      <Table rowKey="lot_id" size="small" scroll={{x:1100}} pagination={{pageSize:10}} dataSource={snapshot?.stock.rows??[]}
        columns={[{title:L("สาขา","Branch"),dataIndex:"location_id",render:(v:string)=>locationName(v)},
          {title:L("ปลา/ไซซ์","Fish/size"),render:(_:unknown,r:StockLot)=>`${r.name} / ${r.size}`},
          {title:L("ล็อต","Lot"),dataIndex:"lot_no"},{title:L("คงเหลือ","On hand"),dataIndex:"qty_grams",render:(v:number)=>kg(v)},
          {title:L("พร้อมขาย","Ready"),render:(_:unknown,r:StockLot)=>r.storageCurrent?kg(r.ready_grams):"—"},
          {title:L("ห้องเย็น","Cold room"),render:(_:unknown,r:StockLot)=>r.storageCurrent?kg(r.cold_grams):"—"},
          {title:L("สถานะข้อมูล","Evidence"),render:(_:unknown,r:StockLot)=>!r.usable?L("ล็อตใช้ขายไม่ได้","Unavailable"):r.storageCurrent?L("ตรวจนับแล้ว","Count current"):L("ต้องนับตำแหน่งใหม่","Recount placement")},
          {title:"",render:(_:unknown,r:StockLot)=>can("inventory.count.apply")?<Button size="small" onClick={()=>beginCount(r)}>{L("นับตำแหน่ง","Count zones")}</Button>:null},
        ]}/>
    </Card>
    <Card title={L("ปลาที่ใช้ผลิตในวันที่เลือก","Fish posted to production")}
      extra={<Link href="/admin/operations">{L("ดูงานผลิต","Production")}</Link>}>
      <Table rowKey={r=>`${r.location_id}/${r.sku}/${r.size}`} size="small" pagination={{pageSize:10}} dataSource={snapshot?.production??[]}
        columns={[{title:L("สาขา","Branch"),dataIndex:"location_id",render:(v:string)=>locationName(v)},
          {title:L("ปลา","Fish"),dataIndex:"sku"},{title:L("ไซซ์","Size"),dataIndex:"size"},
          {title:L("ใช้ผลิต","Used"),dataIndex:"used_grams",render:(v:string)=>kg(v)},
          {title:L("ครั้ง","Batches"),dataIndex:"batch_count"}]}/>
    </Card>
    <Card title={L("ขายแล้วคุ้มหรือไม่","Sales and gross profit")}>
      <Alert closable type="info" showIcon message={L("ส่วนต่างสินค้า-ต้นทุนเป็นประมาณการจากยอดบิลขายก่อนส่วนลดรวมและ VAT กับต้นทุนสต็อกที่ตัดจริง","Estimated line margin uses recorded sale-line revenue before order-wide discounts and VAT with actual inventory COGS")}/>
      {(snapshot?.profit.truncated||snapshot?.profit.missingLotCount||snapshot?.profit.missingCostEvents)?<Alert closable style={{marginTop:8}} type="warning" message={L("ข้อมูลล็อต/ต้นทุนบางส่วนไม่ครบหรือเกิน 500 แถว ห้ามใช้ยอดนี้เป็นกำไรทั้งร้าน","Some lot/cost evidence is missing or over 500 rows; do not treat this as whole-shop profit")}/>:null}
      <Tabs items={[
        {key:"fish",label:L("ตามปลา","By fish"),children:<Table rowKey="key" size="small" scroll={{x:750}} pagination={{pageSize:10}} dataSource={profitGroups.fish} columns={profitCols}/>},
        {key:"lot",label:L("ตามล็อต","By lot"),children:<Table rowKey="key" size="small" scroll={{x:750}} pagination={{pageSize:10}} dataSource={profitGroups.lot} columns={profitCols}/>},
        {key:"customer",label:L("ตามลูกค้า","By customer"),children:<Table rowKey="key" size="small" scroll={{x:750}} pagination={{pageSize:10}} dataSource={profitGroups.customer} columns={profitCols}/>},
      ]}/>
      <Space direction="vertical" style={{width:"100%"}}>
        {mayNet?<Button loading={netBusy} onClick={()=>void loadNet()}>{L("คำนวณกำไรหลังจัดสรรค่าใช้จ่าย","Calculate profit after shared-cost allocation")}</Button>
          :<Typography.Text type="secondary">{L("กำไรหลังจัดสรรค่าใช้จ่ายต้องมีสิทธิ์รายจ่าย รายรับจากแพลตฟอร์ม และเอกสารภาษีเพิ่ม","Shared-cost allocation also requires expense, delivery-settlement and tax-document permissions")}</Typography.Text>}
        {netError&&<Alert closable type="error" message={netError}/>}
        {net&&net.status!=="READY"&&<Alert closable type="warning" message={L("ยังคำนวณกำไรหลังจัดสรรค่าใช้จ่ายไม่ได้","Shared-cost allocation is unavailable")}
          description={L("ต้องมีหลักฐานยอดขาย ต้นทุน ล็อต และการจัดประเภทค่าใช้จ่ายครบตลอดเดือน รวมถึงยอดขายเดือนที่เป็นบวก","The month needs complete sales, cost, lot and reviewed-expense evidence, plus positive merchandise revenue")}/>}
        {net?.status==="READY"&&<>
          <Alert closable type="info" message={L("ประมาณการตามสัดส่วนยอดขาย ไม่ใช่กำไรสุทธิตามบัญชีรายล็อต","Revenue-share management estimate, not statutory net profit by lot")}
            description={L(`เดือน ${net.month}: ค่าใช้จ่ายร่วมและผลต่างสต็อก ${baht(net.monthlySharedCost)} จัดสรรให้ยอดขายวันที่เลือก ${baht(net.selectedDaySharedCost)} ตามยอดสินค้าในบิลก่อนคืน ส่วนลดรวมและ VAT; รายการคืนแสดงยอดติดลบแต่ไม่รับค่าใช้จ่ายร่วมซ้ำ`,
              `Month ${net.month}: ${baht(net.monthlySharedCost)} of shared costs and stock adjustments; ${baht(net.selectedDaySharedCost)} allocated to the selected day using gross merchandise line revenue before returns, order-wide discounts and VAT. Return rows retain negative revenue without a second shared-cost allocation.`)}/>
          <Tabs items={([ ["fish",L("ตามปลา","By fish"),netGroups.fish], ["lot",L("ตามล็อต","By lot"),netGroups.lot], ["customer",L("ตามลูกค้า","By customer"),netGroups.customer] ] as const)
            .map(([key,label,data])=>({key,label,children:<Table rowKey="key" size="small" scroll={{x:800}} pagination={{pageSize:10}} dataSource={data} columns={[
              {title:L("รายการ","Item"),dataIndex:"label"},
              {title:L("ยอดสินค้า","Merchandise revenue"),dataIndex:"revenue",render:(v:number)=>baht(v)},
              {title:L("ส่วนต่างสินค้า-ต้นทุน (ประมาณ)","Estimated line margin"),dataIndex:"grossProfit",render:(v:number)=>baht(v)},
              {title:L("ค่าใช้จ่ายจัดสรร","Allocated shared cost"),dataIndex:"allocatedSharedCost",render:(v:number)=>baht(v)},
              {title:L("กำไรหลังจัดสรร","Profit after allocation"),dataIndex:"allocatedNetProfit",render:(v:number)=>baht(v)},
            ]}/>}))}/>
        </>}
      </Space>
    </Card>
    <Card title={L("ส่งครบหรือยัง ใครยังค้างเงิน","Delivery completion and outstanding AR")}
      extra={can("order.create")?<Button type="primary" icon={<PlusOutlined/>} onClick={()=>{setPlanOpen(true);void loadOptions();}}>{L("สร้างแผนส่งปลา","New delivery plan")}</Button>:null}>
      <Alert closable type="info" showIcon message={L("หนึ่งแผนผูกออร์เดอร์ได้หลายเที่ยว แต่แต่ละเที่ยวต้องสร้างบิลจริงใน Orders ก่อน","One plan can link multiple ordinary orders; create each real order in Orders first")}
        description={L("ยอดรอชำระมาจากบิลที่ยัง PENDING; ลูกหนี้ค้างมาจากบิลขายเชื่อที่ผูกกับแผน ทั้งสองยอดไม่รวมรายการที่ยังไม่ลงระบบ","Pending payment comes from linked PENDING orders; AR due comes from linked credit sales. Unrecorded transactions are excluded.")}/>
      {snapshot?.deliveries.truncated&&<Alert closable type="warning" message={L("แสดง 100 แผนล่าสุด","Showing latest 100 plans")}/>}
      <Table<DeliveryRow> rowKey={r=>`${r.id}/${r.sku}/${r.size}`} size="small" scroll={{x:1050}} pagination={{pageSize:10}}
        dataSource={(snapshot?.deliveries.plans??[]).flatMap(plan=>plan.lines.map(line=>({...line, id:plan.id,
          customerName:plan.customer_name, dueOn:plan.due_on, arDue:plan.arDue, pendingPayment:plan.pendingPayment, plan}))) }
        columns={[{title:L("ลูกค้า","Customer"),dataIndex:"customerName"},{title:L("ปลา/ไซซ์","Fish/size"),render:(_:unknown,r:{sku:string;size:string})=>`${r.sku} / ${r.size}`},
          {title:L("นัดส่ง","Due"),dataIndex:"dueOn"},{title:L("ตกลง","Agreed"),dataIndex:"agreedGrams",render:(v:number)=>kg(v)},
          {title:L("ส่งแล้ว","Shipped"),dataIndex:"shippedGrams",render:(v:number)=>kg(v)},
          {title:L("ค้างส่ง","Still to ship"),dataIndex:"remainingGrams",render:(v:number)=>kg(v)},
          {title:L("รอชำระ","Pending payment"),dataIndex:"pendingPayment",render:(v:number)=>baht(v)},
          {title:L("ลูกหนี้ค้าง","AR due"),dataIndex:"arDue",render:(v:number)=>baht(v)},
          {title:"",render:(_:unknown,r:{plan:Plan})=>can("shipping.update")?<Button size="small" onClick={()=>{setSelectedPlan(r.plan);void loadOptions();}}>{L("ผูกออร์เดอร์","Link order")}</Button>:null}]}/>
    </Card>
    <Modal open={!!selectedLot} title={L("ตรวจนับตำแหน่งปลา","Count fish placement")} onCancel={()=>setSelectedLot(null)} onOk={()=>void confirmCount()} okText={L("ตรวจและยืนยัน","Review and confirm")} confirmLoading={busy}>
      <Typography.Paragraph>{selectedLot?.name} / {selectedLot?.size} · {selectedLot?.lot_no} · {kg(selectedLot?.qty_grams)}</Typography.Paragraph>
      <Form form={countForm} layout="vertical"><Form.Item label={L("พร้อมขาย (กก.)","Ready (kg)")} name="ready" rules={[{required:true}]}><Input inputMode="decimal"/></Form.Item>
        <Form.Item label={L("ห้องเย็น (กก.)","Cold room (kg)")} name="cold" rules={[{required:true}]}><Input inputMode="decimal"/></Form.Item>
        <Form.Item label={L("ตำแหน่งอื่น (กก.)","Other (kg)")} name="other" rules={[{required:true}]}><Input inputMode="decimal"/></Form.Item></Form>
    </Modal>
    <Modal open={planOpen} title={L("สร้างแผนส่งปลา","Create fish delivery plan")} width={760} onCancel={()=>setPlanOpen(false)} onOk={()=>void confirmPlan()} okText={L("ตรวจและยืนยัน","Review and confirm")} confirmLoading={busy}>
      <Form form={planForm} layout="vertical" initialValues={{lines:[{}]}}>
        <Form.Item label={L("ลูกค้า","Customer")} name="customerId" rules={[{required:true}]}><Select showSearch filterOption={false} onSearch={s=>void loadOptions(s)}
          options={options.customers.map(x=>({value:x.id,label:x.name}))}/></Form.Item>
        <Form.Item label={L("สาขาที่ขาย","Branch")} name="locationId" rules={[{required:true}]}><Select options={options.locations.map(x=>({value:x.id,label:x.name}))}/></Form.Item>
        <Form.Item label={L("กำหนดส่ง","Due date")} name="dueOn"><Input type="date"/></Form.Item>
        <Form.List name="lines">{(fields,{add,remove})=><Space direction="vertical" style={{width:"100%"}}>{fields.map(({key,name,...rest})=><Space key={key} wrap align="start">
          <Form.Item {...rest} label={L("ปลา/ไซซ์","Fish/size")} name={[name,"product"]} rules={[{required:true}]}><Select showSearch filterOption={false} style={{minWidth:250}} onSearch={s=>void loadOptions(s)}
            options={options.products.map(x=>({value:JSON.stringify([x.sku,x.size]),label:`${x.name} / ${x.size} (${x.sku})`}))}/></Form.Item>
          <Form.Item {...rest} label={L("น้ำหนักที่ตกลง (กก.)","Agreed kg")} name={[name,"kg"]} rules={[{required:true}]}><Input inputMode="decimal"/></Form.Item>
          {fields.length>1&&<Button danger onClick={()=>remove(name)}>{L("ลบ","Remove")}</Button>}
        </Space>)}<Button onClick={()=>add()}>{L("เพิ่มปลา","Add fish")}</Button></Space>}</Form.List>
        <Form.Item label={L("หมายเหตุ","Note")} name="note"><Input.TextArea rows={2}/></Form.Item>
      </Form>
    </Modal>
    <Modal open={!!selectedPlan} title={L("ผูกออร์เดอร์กับแผนส่งปลา","Link order to delivery plan")} onCancel={()=>setSelectedPlan(null)} onOk={()=>void confirmLink()} okText={L("ตรวจและยืนยัน","Review and confirm")}>
      <Typography.Paragraph>{selectedPlan?.customer_name} · {selectedPlan?.lines.map(x=>`${x.sku}/${x.size} ${kg(x.remainingGrams)}`).join(", ")}</Typography.Paragraph>
      <Form form={linkForm} layout="vertical"><Form.Item label={L("ออร์เดอร์","Order")} name="orderId" rules={[{required:true}]}><Select showSearch filterOption={false} onSearch={s=>void loadOptions(s)}
        options={options.orders.filter(x=>x.customer_id===selectedPlan?.customer_id&&x.location_id===selectedPlan?.location_id)
          .map(x=>({value:x.id,label:`${x.id.slice(0,8)} · ${x.status} · ${x.customer_name}`}))}/></Form.Item></Form>
      <Link href="/admin/orders">{L("เปิดหน้าออร์เดอร์","Open Orders")}</Link>
    </Modal>
  </Space>;
}
