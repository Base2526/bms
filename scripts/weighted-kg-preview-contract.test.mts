import assert from "node:assert/strict";
import test from "node:test";
import {cartProductPricing} from "../packages/pos-client-core/src/cartPricing.ts";
import {cartLineCharge} from "../apps/web/lib/pos/cartCharge.ts";
import {receiptPayloadFromPosSale} from "../apps/web/lib/pos/posSaleReceipt.ts";

test("desktop and native cart preview retains per-label satang on repeated weighed labels",()=>{
  const lines=[
    {sku:"SAND",size:"STD",packCode:"BASE",qty:1,baseQty:750,basePrice:0.01,
      packBasePrice:17.59,scaleBarcode:"FAKE-750",priceTiers:[],promotion:null},
    {sku:"SAND",size:"STD",packCode:"BASE",qty:1,baseQty:500,basePrice:0.01,
      packBasePrice:11.73,scaleBarcode:"FAKE-500",priceTiers:[],promotion:null},
  ];
  const priced=cartProductPricing(lines);
  assert.equal(priced.subtotal,29.32);
  assert.deepEqual(priced.lines.map(line=>line.amount),[17.59,11.73]);
  const repeated=cartProductPricing([{...lines[1],qty:2}]);
  assert.equal(repeated.subtotal,23.46,"two labels round separately");
  assert.equal(cartLineCharge({packQty:2,baseQty:500,packPrice:11.73,basePrice:0.01,
    scaleBarcode:"FAKE-500"},undefined).amount,23.46);
});

test("receipt amount uses frozen line total for measured sales",()=>{
  const row:any={soldAt:new Date().toISOString(),payments:[{method:"CASH",amount:29.32,ref:null,
    cashTendered:30,cashChange:0.68}],lines:[{receiptName:"Sand",size:"STD",packQty:1250,
    packPrice:0.02,lineTotal:29.32}],total:29.32,discountLines:[],extraLines:[],vat:null};
  const store:any={languageMode:"en",fallbackStoreName:"FAKE",fallbackBranchCode:"MAIN",
    fallbackPosNo:"1",address:null,phone:null,logoUrl:null};
  const receipt=receiptPayloadFromPosSale(row,store);
  assert.equal(receipt.lines[0].amount,29.32);
});
