'use client';
import { useEffect, useState } from 'react';
import { agreedRestaurantQuantities, type RestaurantRequestLine } from '@/lib/bms/restaurantRequestPolicy';
// One message set for every screen that shows why createOrderInTx refused. Writing a
// second copy here would leave staff reading a raw enum ("INSUFFICIENT", "SOLD_OUT_TODAY")
// the day the shared one is improved — and a reason nobody can act on is the failure this
// queue is meant to remove.
import { describePosFailure } from '@/lib/pos/failureMessage';

type Request = {
  id:string; locationId:string; locationName:string; status:string; items:RestaurantRequestLine[];
  customerName:string|null; phone:string|null; fulfillmentType:string; requestedAt:string|null;
  note:string; reviewNote:string|null; version:number;
  agreedItems?:RestaurantRequestLine[]|null; orderId?:string|null; checkoutUrl?:string;
};
type Props = { english?:boolean; canReview?:boolean; pos?:{token:string;cashierUserId:string;cashierPin:string} };
export default function RestaurantRequestQueue({english=false,canReview=true,pos}:Props) {
  const [rows,setRows]=useState<Request[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Request|null>(null);
  const [quantities,setQuantities]=useState<number[]>([]);
  const [note,setNote]=useState('');
  const [kitchenNote,setKitchenNote]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  // Which request the link belongs to, not just the link: an unlabelled one left over from the
  // previous confirmation is a payment link for the wrong customer.
  const [checkout,setCheckout]=useState<{url:string;ref:string}|null>(null);
  const [enabled,setEnabled]=useState<boolean|null>(pos ? true : null);
  async function call(body?:Record<string,unknown>) {
    const response=await fetch(pos ? '/api/pos/restaurant/requests' : '/api/bms/restaurant-requests',{
      method:pos || body ? 'POST':'GET',
      headers:{'content-type':'application/json',...(pos ? {'x-pos-device-token':pos.token}:{})},
      ...(pos || body ? {body:JSON.stringify({...body,...(pos ? {
        action:body?.action ?? 'list',cashierUserId:pos.cashierUserId,cashierPin:pos.cashierPin,
      }:{})})}:{}),cache:'no-store',
    });
    const data=await response.json();
    if (!response.ok) {
      const detail=data.error ?? (data.reason ? describePosFailure(data.reason) : null)
        ?? data.status ?? `HTTP ${response.status}`;
      throw new Error(english ? `Cannot confirm yet — ${detail}` : detail);
    }
    return data;
  }
  async function refresh() {
    setBusy(true);setError('');
    try { const data=await call();setRows(data.requests ?? []);setEnabled(data.enabled !== false); } catch(e) {setError(e instanceof Error ? e.message : String(e));}
    finally {setBusy(false);}
  }
  useEffect(()=>{if (!pos) void refresh();},[]);
  async function review(action:'confirm'|'contact'|'cancel') {
    if (!selected) return;
    setBusy(true);setError('');setCheckout(null);
    try {
      const data=await call({id:selected.id,locationId:selected.locationId,version:selected.version,
        action,quantities,note,kitchenNote,confirmed});
      setCheckout(data.checkoutUrl ? {url:data.checkoutUrl,ref:selected.id.slice(0,8)} : null);setSelected(null);
      setRows((await call()).requests ?? []);
    } catch(e) {setError(e instanceof Error ? e.message : String(e));}
    finally {setBusy(false);}
  }
  // The screen must not offer a confirmation the server already knows it will reject, and must
  // not invent a second rule to decide that — this is the exact function reviewRestaurantRequest
  // runs, so "ใส่ 0 ทุกบรรทัด" and "เกินจำนวนที่ขอ" are refused with the same sentence.
  const agreementError=(()=>{
    if (!selected) return null;
    try { agreedRestaurantQuantities(selected.items,quantities); return null; }
    catch (e) { return e instanceof Error ? e.message : String(e); }
  })();
  const buttonStyle={padding:'8px 12px',cursor:'pointer',margin:'4px'};
  if (enabled === false || (enabled === null && !error)) return null;
  return <section style={{border:'1px solid #b8c8cc',borderRadius:12,padding:16,marginBottom:20,overflowWrap:'anywhere'}}>
    <h3>{english ? 'Restaurant requests — awaiting shop review':'คำขอร้านอาหาร — รอร้านตรวจ'}</h3>
    <p>{english ? 'Requested quantities are retained without stock reservation or payment. Call the customer if changes are needed; confirm only the quantities agreed.'
      :'เก็บจำนวนที่ลูกค้าขอครบ ยังไม่จองสต็อกและไม่เรียกชำระเงิน หากต้องปรับรายการให้โทรคุยก่อน แล้วบันทึกจำนวนที่ตกลง'}</p>
    <button type="button" style={buttonStyle} disabled={busy} onClick={()=>void refresh()}>{english ? 'Refresh requests':'โหลดคำขอ'}</button>
    {error && <p role="alert" style={{color:'#bb2525'}}>{error}</p>}
    {checkout && <p>{english ? `Order created for request #${checkout.ref}. Review it and share the checkout link with that customer:`:`สร้างบิลของคำขอ #${checkout.ref} แล้ว ตรวจสอบและส่งลิงก์ชำระเงินให้ลูกค้ารายนั้น:`} <a href={checkout.url} target="_blank" rel="noreferrer">{english ? 'Open checkout':'เปิดลิงก์ชำระเงิน'}</a></p>}
    {!rows.length && <p>{english ? 'No requests loaded.':'ยังไม่มีคำขอที่โหลดมา'}</p>}
    {rows.map(row=><article key={row.id} style={{borderTop:'1px solid #ddd',padding:'12px 0'}}>
      <strong>#{row.id.slice(0,8)} · {row.locationName} · {row.status === 'CONTACTING' ? (english?'Contacting':'กำลังติดต่อ')
        : row.status === 'CONFIRMED' ? (english?'Confirmed':'ยืนยันแล้ว') : row.status === 'CANCELLED' ? (english?'Cancelled':'ยกเลิกแล้ว') : (english?'Awaiting review':'รอตรวจ')}</strong>
      <p>{row.customerName ?? '—'} · {row.phone ? <a href={`tel:${row.phone}`}>{row.phone}</a>:(english?'No phone yet — open Inbox':'ยังไม่มีเบอร์ — ติดต่อผ่าน Inbox')}
        {' · '}{row.fulfillmentType === 'PICKUP' ? (english?'Pickup':'รับเอง'):(english?'Delivery':'จัดส่ง')}
        {row.requestedAt ? ` · ${new Date(row.requestedAt).toLocaleString(english?'en-GB':'th-TH')}`:''}</p>
      <ul>{row.items.map((line,i)=><li key={i}>{line.name} / {line.size} × {line.qty} {line.unitName} {line.modifierNames.join(', ')}</li>)}</ul>
      {row.note && <p>{english?'Instructions awaiting review: ':'ข้อกำชับรอร้านตรวจ: '}{row.note}</p>}
      {row.reviewNote && <p>{english?'Previous review: ':'ผลตรวจ/ติดต่อล่าสุด: '}{row.reviewNote}</p>}
      {row.agreedItems && <p>{english?'Agreed: ':'ตกลงแล้ว: '}{row.agreedItems.map(line=>`${line.name} / ${line.size} × ${line.qty} ${line.unitName ?? ''}`).join(', ')}</p>}
      {row.orderId && <p>{english?'Order: ':'บิล: '}{row.orderId} {row.checkoutUrl && <a href={row.checkoutUrl} target="_blank" rel="noreferrer">{english?'Open checkout':'เปิดลิงก์ชำระเงิน'}</a>}</p>}
      {canReview && ['REQUESTED','CONTACTING'].includes(row.status) && <button type="button" style={buttonStyle} disabled={busy} onClick={()=>{
        setSelected(row);setQuantities(row.items.map(line=>line.qty));setNote('');setKitchenNote(row.note);setConfirmed(false);
      }}>{english?'Review / record call':'ตรวจรายการ / บันทึกผลโทร'}</button>}
    </article>)}
    {selected && <div role="region" aria-label={english?'Review request':'ตรวจคำขอ'} style={{border:'2px solid #467c75',padding:16,borderRadius:8}}>
      <h4>#{selected.id.slice(0,8)} — {english?'Agreed quantities':'จำนวนที่ตกลง'}</h4>
      {selected.items.map((line,i)=><label key={i} style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:10}}>
        <span>{line.name} / {line.size} ({line.modifierNames.join(', ')}) — {english?'requested':'ขอเดิม'} {line.qty}</span>
        <input aria-label={`${english?'Agreed quantity for':'จำนวนที่ตกลงของ'} ${line.name} / ${line.size}${line.modifierNames.length?` (${line.modifierNames.join(', ')})`:''}`} type="number" min={0} max={line.qty} value={quantities[i]}
          onChange={e=>{setQuantities(old=>old.map((q,j)=>j===i?Number(e.target.value):q));setConfirmed(false);}} style={{width:100}}/>
      </label>)}
      <p>{english?'Use 0 to remove a line after agreement. A replacement product needs a new confirmed request.':'ใส่ 0 เพื่อตัดรายการหลังตกลงกับลูกค้า หากเปลี่ยนสินค้าให้รับและยืนยันคำขอใหม่'}</p>
      <label>{english?'Instructions for kitchen (review against the agreed items; do not include contact details)':'ข้อความส่งครัว (ตรวจให้ตรงรายการที่ตกลง ไม่ใส่ข้อมูลติดต่อ)'}
        <textarea value={kitchenNote} maxLength={1000} onChange={e=>{setKitchenNote(e.target.value);setConfirmed(false);}}
          style={{display:'block',width:'100%',minHeight:80,boxSizing:'border-box'}}/>
      </label>
      <label>{english?'Review / call outcome':'ผลการตรวจ / การโทรตกลง'}
        <textarea value={note} maxLength={1000} onChange={e=>{setNote(e.target.value);setConfirmed(false);}}
          style={{display:'block',width:'100%',minHeight:80,boxSizing:'border-box'}}/>
      </label>
      <label style={{display:'block',margin:'12px 0'}}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
        {english?' I reviewed these quantities and instructions; any changes were agreed with the customer. Confirming creates a payable order and reserves stock.':' ตรวจจำนวนและข้อกำชับแล้ว หากมีการเปลี่ยนแปลงได้ตกลงกับลูกค้าแล้ว การยืนยันจะสร้างบิลและจองสต็อก'}</label>
      {agreementError && <p role="alert" style={{color:'#bb2525'}}>{agreementError}</p>}
      <button type="button" style={buttonStyle} disabled={busy||!confirmed||!note.trim()||agreementError!==null} onClick={()=>void review('confirm')}>{english?'Confirm and create order':'ยืนยันจำนวนนี้และสร้างบิล'}</button>
      <button type="button" style={buttonStyle} disabled={busy||!confirmed||!note.trim()} onClick={()=>void review('contact')}>{english?'Save contact outcome':'บันทึกผลติดต่อ ยังไม่สร้างบิล'}</button>
      <button type="button" style={buttonStyle} disabled={busy||!confirmed||!note.trim()} onClick={()=>void review('cancel')}>{english?'Cancel request':'ยกเลิกคำขอ'}</button>
      <button type="button" style={buttonStyle} disabled={busy} onClick={()=>setSelected(null)}>{english?'Close':'ปิด'}</button>
    </div>}
  </section>;
}
