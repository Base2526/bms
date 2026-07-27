# **Summary: การพิสูจน์ความถูกต้องของระบบ AI Chat**

## **หลักการ**

ไม่สามารถสรุปว่า AI ถูกต้องกี่เปอร์เซ็นต์จากการออกแบบหรือทดลองเพียงไม่กี่ครั้ง ต้องสร้างชุดข้อมูลที่รู้คำตอบจริง แล้ววัดแต่ละส่วนของระบบแยกกัน

เป้าหมายไม่ใช่ทำให้ AI ไม่ผิดเลย แต่ต้องทำให้:

AI ไม่แน่ใจ → ถามกลับ  
Tool ล้มเหลว → ไม่เดา  
ข้อมูลสำคัญ → ตรวจ backend  
Action สำคัญ → backend ป้องกัน

## **สิ่งที่ต้องวัด**

* Summary มีข้อมูลแต่งขึ้นหรือไม่  
* Summary เก็บข้อมูลสำคัญครบหรือไม่  
* Conversation state ถูกต้องหรือไม่  
* Retrieval เลือกสินค้าถูกหรือไม่  
* AI เรียก tool ถูกตัวหรือไม่  
* ราคาและ stock ตรงกับ backend หรือไม่  
* AI สร้างออเดอร์เฉพาะเมื่อได้รับการยืนยันหรือไม่  
* ข้อมูลข้าม tenant หรือลูกค้าหรือไม่  
* ลูกค้าทำงานสำเร็จตั้งแต่ต้นจนจบหรือไม่

## **การวัด Summary**

### **Faithfulness**

วัดว่า facts ใน Summary มีหลักฐานรองรับกี่เปอร์เซ็นต์

Faithfulness \=  
Facts ที่มีหลักฐาน  
÷ Facts ทั้งหมดใน Summary

### **Completeness**

วัดว่า Summary เก็บข้อมูลสำคัญจากต้นฉบับครบกี่เปอร์เซ็นต์

Completeness \=  
Required facts ที่เก็บไว้  
÷ Required facts ทั้งหมด

ข้อมูลสำคัญ เช่น SKU, จำนวน, สถานะการยืนยัน, การยกเลิก และการชำระเงิน ต้องถูกต้อง 100% ในชุดทดสอบ

## **Gold Test Dataset**

แต่ละกรณีทดสอบต้องกำหนดไว้ล่วงหน้า:

{  
  "conversation": \[  
    "ลูกค้าสนใจ Classic Tee สีดำ M จำนวน 2",  
    "ลูกค้าบอกว่ายังไม่ยืนยันซื้อ"  
  \],  
  "expectedState": {  
    "sku": "SHIRT-001",  
    "color": "black",  
    "size": "M",  
    "qty": 2,  
    "stage": "AWAITING\_CONFIRMATION"  
  },  
  "expectedTools": \[  
    "search\_products",  
    "check\_stock"  
  \],  
  "forbiddenTools": \[  
    "create\_order"  
  \]  
}

ไม่ต้องตรวจว่าคำตอบ AI ตรงกันทุกคำ แต่ต้องตรวจว่า:

* ใช้ tenant ถูกต้อง  
* State ถูกต้อง  
* เรียก tool ถูกต้อง  
* Fact ตรง backend  
* ไม่ทำ action ที่ไม่ได้รับอนุญาต

## **Decision-Equivalence Test**

ทดสอบระบบสองแบบ:

A: Full Transcript  
B: Rolling Summary \+ Delta \+ Structured State

แล้วเปรียบเทียบ:

* Intent  
* SKU  
* Missing fields  
* Tool calls  
* Tool arguments  
* การถามกลับ  
* การสร้างหรือไม่สร้างออเดอร์  
* Business facts ในคำตอบ

ทั้งสองแบบต้องให้ผลเหมือนกันและต้องตรงกับ Gold Standard

## **วิธีทดสอบก่อนเปิดจริง**

Synthetic Gold Tests  
→ Historical Chat Replay  
→ Adversarial Tests  
→ Shadow Mode  
→ Internal Tenant  
→ Canary 1%  
→ 5%  
→ 25%  
→ 100%

Shadow Mode คือให้ระบบใหม่ประมวลผลแชตจริง แต่ไม่ส่งคำตอบ ไม่สร้างออเดอร์ และไม่เปลี่ยนข้อมูลจริง

## **ชุดทดสอบที่ต้องมี**

* คำปกติและภาษาพูด  
* คำสะกดผิด  
* ชื่อสินค้ากำกวม  
* ลูกค้าเปลี่ยนใจ  
* “เอา M 2 แต่ยังไม่สั่ง”  
* “ยกเลิกอันเมื่อกี้”  
* ข้อความมาผิดลำดับ  
* Webhook ส่งซ้ำ  
* Tool timeout  
* Stock เปลี่ยนระหว่างสนทนา  
* Prompt injection  
* การป้องกันข้อมูลข้าม tenant  
* Summary เก่า \+ ข้อความใหม่  
* Summary job ล้มเหลว

## **Runtime Validation**

ทุก fact สำคัญควรมีแหล่งที่มา:

{  
  "value": 390,  
  "source": "get\_product\_price",  
  "authoritative": true,  
  "verifiedAt": "..."  
}

ก่อนส่งคำตอบ Backend ต้องตรวจว่า:

* ราคาตรงกับ tool  
* Stock ตรงกับ tool  
* SKU อยู่ในผลค้นหา  
* Order tool สำเร็จก่อนแจ้งว่าสร้างแล้ว  
* Payment ต้องไม่ถูกแจ้งว่าสำเร็จหากยัง `PENDING`  
* ไม่มีข้อมูลจาก tenant อื่น

หากตรวจไม่ผ่าน ให้ใช้ fallback หรือส่งต่อพนักงาน

## **จำนวน Test Cases**

หากไม่พบข้อผิดพลาดเลย สามารถประมาณขอบเขต error ที่ความเชื่อมั่นประมาณ 95% ได้ด้วย:

Error upper bound ≈ 3 ÷ จำนวนการทดสอบ

| ทดสอบโดยไม่พบข้อผิดพลาด | Accuracy lower bound โดยประมาณ |
| ----- | ----- |
| 100 | 97% |
| 1,000 | 99.7% |
| 10,000 | 99.97% |
| 30,000 | 99.99% |

ดังนั้นผ่าน 100 test cases ไม่ได้แปลว่าแม่น 100%

## **Release Requirements**

### **ผิดไม่ได้**

Cross-tenant leakage                \= 0  
Duplicate order                     \= 0  
Order โดยไม่มี confirmation         \= 0  
ราคา/stock ที่ไม่มี tool รองรับ       \= 0  
Payment success ที่ยังไม่ยืนยัน       \= 0  
Wrong sensitive action              \= 0  
Critical state accuracy             \= 100%

### **เป้าหมายคุณภาพเริ่มต้น**

Summary faithfulness        ≥ 99.5%  
Summary completeness        ≥ 98%  
Critical fact recall        \= 100%  
Intent accuracy             ≥ 98%  
Retrieval Top-1             ≥ 95%  
Retrieval Top-3             ≥ 99%  
Clarification correctness   ≥ 95%  
End-to-end task success     ≥ 97%

## **หลังเปิดใช้งาน**

* ตรวจ business facts และ actions อัตโนมัติ 100%  
* สุ่มแชตให้คนตรวจ 1–5%  
* ตรวจแชตที่มี order/payment 100% ในช่วงเริ่มต้น  
* ตรวจ fallback และ handoff ทุกกรณี  
* ทำ regression test ทุกครั้งที่เปลี่ยน prompt, model, tool หรือ summary schema  
* เก็บ prompt version, model version, summary version และ tool trace เพื่อ replay ได้

## **ข้อสรุป**

การยืนยันว่าระบบแม่นต้องใช้:

Gold Standard  
\+ Automated Assertions  
\+ Summary Faithfulness/Completeness  
\+ Decision-Equivalence Tests  
\+ Historical Replay  
\+ Shadow Mode  
\+ Canary Rollout  
\+ Runtime Fact Validation  
\+ Human Review

ระบบที่ปลอดภัยไม่ใช่ระบบที่เชื่อว่า AI จะไม่ผิด แต่เป็นระบบที่ตรวจพบความไม่แน่ใจ ป้องกันข้อมูลผิด และไม่อนุญาตให้ AI ทำรายการผิดไปถึงลูกค้า

