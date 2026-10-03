import type { ReportDoc } from "./documentGenerator";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The print form consumes the very same statutory rows as XLSX, without recomputing tax. */
export function renderTaxReportPrint(doc: ReportDoc, nonce: string): string {
  const sheets = doc.sheets.filter(s => s.taxPrintIdentity);
  if (!sheets.length) throw new Error("ไม่มีสถานประกอบการที่ได้รับอนุญาตสำหรับพิมพ์รายงาน");
  const data = JSON.stringify(sheets).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>
<style nonce="${escapeHtml(nonce)}">
@page { size: A4 landscape; margin: 10mm; }
* { box-sizing: border-box; } body { margin: 0; background: #ddd; color: #000; font: 9pt/1.5 Tahoma, Thonburi, "Noto Sans Thai", sans-serif; }
.toolbar { padding: 12px; background: #fff; position: sticky; top: 0; z-index: 1; } button { padding: 6px 16px; margin-right: 12px; }
.page { width: 277mm; height: 188mm; margin: 12px auto; background: white; break-after: page; position: relative; }
.page:last-child { break-after: auto; } header { position: relative; margin-bottom: 3mm; } h1 { font-size: 12pt; margin: 0; font-weight: normal; }
.title { text-align: center; padding: 0 25mm; overflow-wrap: anywhere; } .page-number { position: absolute; right: 0; top: 0; }
.identity { display: flex; gap: 8mm; align-items: end; justify-content: space-between; margin-top: 5mm; }
.address { flex: 1; overflow-wrap: anywhere; } .seller-id { flex: 0 0 auto; } .digits { display: inline-flex; }
.digit { border: 1px solid; border-right: 0; width: 5mm; height: 5mm; text-align: center; } .digit:last-child { border-right: 1px solid; }
.box { display: inline-block; border: 1px solid; width: 4mm; height: 4mm; line-height: 3.5mm; text-align: center; margin: 1mm; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; } th, td { border-left: 1px solid; border-right: 1px solid; padding: 1px 4px; overflow-wrap: anywhere; vertical-align: top; }
col:nth-child(1) { width:4%; } col:nth-child(2) { width:8%; } col:nth-child(3) { width:10%; } col:nth-child(4) { width:25%; } col:nth-child(5) { width:12%; } col:nth-child(6) { width:10%; } col:nth-child(7), col:nth-child(8) { width:9%; } col:nth-child(9) { width:13%; }
thead th { font-weight: normal; vertical-align: middle; border-top: 1px solid; border-bottom: 1px solid; text-align: center; }
tbody td { border-top: 0; border-bottom: 0; } tbody tr { break-inside: avoid; } .center { text-align: center; } .money { text-align: right; white-space: nowrap; }
tfoot td { border-top: 1px solid; border-bottom: 1px solid; } .grand { border-bottom: 3px double; } .grand.pending { visibility: hidden; }
.error { color: #a00; } body.failed .page { outline: 2px solid #a00; }
@media print { body { background: white; } .toolbar { display: none; } .page { margin: 0; } body.failed .page { display: none; } body.failed .toolbar { display: block; } }
</style></head><body><div class="toolbar"><button id="print" disabled>พิมพ์</button><span id="status">กำลังจัดหน้า…</span></div><main id="pages"></main>
<script nonce="${escapeHtml(nonce)}">
const sheets = ${data};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => (n / 100).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
const digits = (value, length) => '<span class="digits">' + Array.from({length}, (_, i) => '<span class="digit">' + esc(String(value ?? '')[i] ?? '') + '</span>').join('') + '</span>';
const pages = document.getElementById('pages');
function makePage(sheet) {
  const i = sheet.taxPrintIdentity;
  const page = document.createElement('section'); page.className = 'page';
  page.innerHTML = '<header><div class="title"><h1>' + esc(i.title) + '</h1><div>' + esc(i.period) + '</div><div>ชื่อผู้ประกอบการ : ' + esc(i.name) + '</div></div><span class="page-number"></span>' +
    '<div class="identity"><div class="address">ที่อยู่สถานประกอบการ : ' + esc(i.address) + '</div><div class="seller-id">เลขประจำตัวผู้เสียภาษีอากร<br>' + digits(i.taxId,13) + '<br><span class="box">' + (i.isHeadOffice?'X':'') + '</span> สำนักงานใหญ่ <span class="box">' + (i.isHeadOffice?'':'X') + '</span> สาขา ' + digits(i.isHeadOffice?'':i.branchCode,5) + '</div></div></header>' +
    '<table><colgroup>' + '<col>'.repeat(9) + '</colgroup><thead><tr><th rowspan="2">ลำดับที่</th><th colspan="2">ใบกำกับภาษี</th>' + sheet.columns.slice(3).map(c => '<th rowspan="2">' + esc(c.label) + '</th>').join('') + '</tr><tr><th>วัน เดือน ปี</th><th>เลขที่</th></tr></thead><tbody></tbody><tfoot><tr><td colspan="6" class="money">รวม</td><td class="money page-base">0.00</td><td class="money page-vat">0.00</td><td></td></tr><tr class="grand pending"><td colspan="6" class="money">รวมทั้งสิ้น</td><td class="money grand-base">0.00</td><td class="money grand-vat">0.00</td><td></td></tr></tfoot></table>';
  pages.append(page); return page;
}
function rowElement(sheet, row) {
  const tr = document.createElement('tr');
  tr.innerHTML = sheet.columns.map((c,j) => '<td class="' + (j===6||j===7?'money':j===0||j===1||j===4||j===5?'center':'') + '">' + (j===6||j===7?money(Math.round(Number(row[c.key])*100)):esc(row[c.key])) + '</td>').join('');
  return tr;
}
function setTotals(page, base, vat) { page.querySelector('.page-base').textContent=money(base); page.querySelector('.page-vat').textContent=money(vat); }
async function paginate() {
  await document.fonts.ready;
  try {
    for (const sheet of sheets) {
      const branchPages=[]; let page=makePage(sheet); branchPages.push(page);
      let base=0, vat=0, grandBase=0, grandVat=0;
      const fits = () => page.querySelector('table').getBoundingClientRect().bottom <= page.getBoundingClientRect().bottom;
      if (!fits()) throw new Error('หัวรายงานยาวเกินพื้นที่หน้า');
      for (const row of sheet.rows) {
        const b=Math.round(Number(row[sheet.columns[6].key])*100), v=Math.round(Number(row[sheet.columns[7].key])*100);
        const tr=rowElement(sheet,row); page.querySelector('tbody').append(tr); setTotals(page,base+b,vat+v);
        if (!fits()) {
          tr.remove(); setTotals(page,base,vat);
          if (!page.querySelector('tbody').children.length) throw new Error('มีรายการยาวเกินหนึ่งหน้า กรุณาตรวจสอบชื่อหรือหมายเหตุ');
          page=makePage(sheet); branchPages.push(page); base=0; vat=0;
          page.querySelector('tbody').append(tr); setTotals(page,b,v);
          if (!fits()) throw new Error('มีรายการยาวเกินหนึ่งหน้า กรุณาตรวจสอบชื่อหรือหมายเหตุ');
        }
        base+=b; vat+=v; grandBase+=b; grandVat+=v;
      }
      page.querySelector('.grand').classList.remove('pending');
      page.querySelector('.grand-base').textContent=money(grandBase); page.querySelector('.grand-vat').textContent=money(grandVat);
      branchPages.forEach((p,index) => p.querySelector('.page-number').textContent='Page ' + (index+1) + ' of ' + branchPages.length);
    }
    document.getElementById('print').disabled=false;
    document.getElementById('status').textContent='A4 แนวนอน · สเกล 100% · ปิดหัว/ท้ายกระดาษของเบราว์เซอร์ · ให้นักบัญชีตรวจสอบก่อนยื่น';
    document.body.dataset.ready='true';
  } catch (e) { document.body.classList.add('failed'); document.getElementById('status').textContent=e.message; document.getElementById('status').className='error'; }
}
document.getElementById('print').addEventListener('click', () => window.print());
paginate();
</script></body></html>`;
}
