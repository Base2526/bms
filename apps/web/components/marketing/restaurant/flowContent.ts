import type { Bilingual } from "@/lib/static-page-i18n";

export type RestaurantFlowCopy = { title: string; description: string; note: string; source: string };
export type RestaurantFlow = Bilingual<RestaurantFlowCopy> & { id: number; group: number };

// Public explanatory content, not a command catalog. Review alongside the domain docs.
export const restaurantFlows: RestaurantFlow[] = [
  {
    "id": 1,
    "group": 0,
    "th": {
      "title": "วางสูตร ต้นทุน และราคา",
      "description": "เปลี่ยนสูตรของร้านให้เป็นข้อมูลที่ใช้คำนวณและตัดสินใจได้",
      "note": "การจำลองราคาไม่เปลี่ยนราคาขาย จนกว่าผู้มีสิทธิ์จะตรวจและยืนยัน",
      "source": "sequenceDiagram\nautonumber\nactor Owner as เจ้าของ / ผู้จัดการ\nactor Chef as ผู้ดูแลสูตร\nparticipant Catalog as เมนูและสูตร BMS\nparticipant Plan as วิเคราะห์ต้นทุนและราคา\nparticipant Sales as ช่องทางขาย\nOwner->>Catalog: ตั้งสาขา เมนู วัตถุดิบ และหน่วยนับ\nChef->>Catalog: บันทึกสูตรต่อเสิร์ฟ สูตรย่อย และ SOP\nCatalog-->>Chef: เก็บเวอร์ชันสูตร\nOwner->>Plan: เลือกสูตรและฐานต้นทุน\nPlan->>Catalog: อ่านส่วนประกอบและหลักฐานต้นทุน\nOwner->>Plan: ระบุสมมติฐานแรงงาน พลังงาน ค่าใช้จ่าย และยอดขาย\nalt ข้อมูลเพียงพอ\nPlan-->>Owner: ต้นทุนประมาณการ ราคา และเป้าคุ้มทุน\nOwner->>Plan: เลือกราคา แพ็ก หรือโปรโมชั่นและดูตัวอย่าง\nPlan-->>Owner: แสดงสาขา ช่องทาง ช่วงเวลา และผลกระทบ\nOwner->>Plan: ยืนยันเผยแพร่\nPlan->>Sales: บันทึกราคาหรือโปรโมชั่น\nelse ข้อมูลไม่ครบ\nPlan-->>Owner: ระบุข้อมูลที่ไม่ทราบและหลักฐานที่ขาด\nend\nNote over Chef,Sales: SOP เป็นข้อมูลอ้างอิง ทีมร้านยังต้องฝึกและตรวจการปฏิบัติจริง"
    },
    "en": {
      "title": "Plan recipes, costs and prices",
      "description": "Turn the store's recipes into evidence for pricing decisions.",
      "note": "Simulating a price does not change the selling price until an authorized person reviews and confirms it.",
      "source": "sequenceDiagram\nautonumber\nactor Owner as Owner / manager\nactor Chef as Recipe lead\nparticipant Catalog as BMS menu and recipes\nparticipant Plan as Cost and price planning\nparticipant Sales as Sales channels\nOwner->>Catalog: Set branches, dishes, ingredients and units\nChef->>Catalog: Save portions, subrecipes and SOP\nCatalog-->>Chef: Keep the recipe version\nOwner->>Plan: Select recipe and cost basis\nPlan->>Catalog: Read ingredients and cost evidence\nOwner->>Plan: Enter labour, energy, expense and sales assumptions\nalt Enough evidence\nPlan-->>Owner: Estimated costs, prices and break-even targets\nOwner->>Plan: Select a price, pack or promotion to preview\nPlan-->>Owner: Show branches, channels, dates and impact\nOwner->>Plan: Confirm publication\nPlan->>Sales: Save the price or promotion\nelse Incomplete evidence\nPlan-->>Owner: Identify unknown costs and missing evidence\nend\nNote over Chef,Sales: SOP is reference material; staff still need training and operational checks"
    }
  },
  {
    "id": 2,
    "group": 0,
    "th": {
      "title": "เติมสินค้าและโอนสาขา",
      "description": "เห็นตั้งแต่สาขาขอของ จนปลายทางตรวจรับจริง",
      "note": "อนุมัติคำขอยังไม่ตัดของ และใบโอนใช้ได้เฉพาะสินค้าที่รองรับ",
      "source": "sequenceDiagram\nautonumber\nactor Branch as พนักงานสาขา\nactor Manager as ผู้จัดการ\nparticipant Req as คำขอเติมสินค้า\nparticipant Stock as สต็อก BMS\nparticipant PO as ใบสั่งซื้อ\nparticipant Transfer as ใบโอน\nBranch->>Req: ขอสินค้า จำนวน และวันที่ต้องการ\nReq-->>Manager: แจ้งคำขอรอตรวจ\nManager->>Stock: ตรวจของในสาขาที่มีสิทธิ์\nStock-->>Manager: จำนวนพร้อมใช้\nalt ไม่อนุมัติ\nManager->>Req: ปฏิเสธพร้อมเหตุผล\nelse อนุมัติทั้งหมดหรือบางส่วน\nManager->>Req: ยืนยันจำนวนอนุมัติ\nopt ของส่วนกลางไม่พอ\nManager->>PO: ตรวจและสร้าง PO\nNote over Manager,PO: จัดซื้อส่งคำสั่งซื้อและ Supplier ส่งของ\nManager->>PO: ตรวจรับจำนวนและต้นทุนจริง\nPO->>Stock: เพิ่มสต็อกและมูลค่ารับเข้า\nend\nManager->>Req: ยืนยันสร้างใบโอนที่ผูกคำขอ\nReq->>Transfer: สร้าง DRAFT\nManager->>Transfer: ยืนยันส่งของ\nTransfer->>Stock: ตรวจของพร้อมใช้ ตัดต้นทาง และบันทึก Movement\nTransfer-->>Branch: IN_TRANSIT\nBranch->>Transfer: ตรวจรับดี เสียหาย และขาด พร้อมเหตุผล\nTransfer->>Stock: เพิ่มของดี แยกกักของเสีย และบันทึกของขาด\nTransfer-->>Req: อัปเดตจำนวนได้รับจริง\nopt ยังรับไม่ครบ\nManager->>Req: จัดส่งเพิ่มหรือพิจารณาปิดส่วนที่ขาด\nend\nManager->>Req: ตรวจเอกสารค้างและยืนยัน CLOSED\nend\nNote over Req,Transfer: อนุมัติคำขอไม่ตัดของ รับ PO ไม่ใช่หลักฐานว่าสาขาปลายทางได้รับแล้ว"
    },
    "en": {
      "title": "Replenish and transfer stock",
      "description": "Follow a branch request through dispatch and actual receipt.",
      "note": "Approval does not deduct stock. Transfers support only eligible product types.",
      "source": "sequenceDiagram\nautonumber\nactor Branch as Branch staff\nactor Manager as Manager\nparticipant Req as Requisitions\nparticipant Stock as BMS inventory\nparticipant PO as Purchase orders\nparticipant Transfer as Transfers\nBranch->>Req: Request items, quantities and required date\nReq-->>Manager: Present request for review\nManager->>Stock: Check stock at accessible branches\nStock-->>Manager: Available quantities\nalt Rejected\nManager->>Req: Reject with a reason\nelse Approved in full or part\nManager->>Req: Confirm approved quantities\nopt Central stock is insufficient\nManager->>PO: Review and create PO\nNote over Manager,PO: Purchasing sends the order; the supplier delivers\nManager->>PO: Verify received quantities and costs\nPO->>Stock: Add stock and receipt value\nend\nManager->>Req: Confirm transfer linked to request\nReq->>Transfer: Create DRAFT\nManager->>Transfer: Confirm dispatch\nTransfer->>Stock: Check availability, deduct source and record movement\nTransfer-->>Branch: IN_TRANSIT\nBranch->>Transfer: Record good, damaged and missing units with reasons\nTransfer->>Stock: Add good stock, quarantine damage and record loss\nTransfer-->>Req: Update quantities actually received\nopt Still short\nManager->>Req: Arrange replacement or review the unfilled balance\nend\nManager->>Req: Check open documents and confirm CLOSED\nend\nNote over Req,Transfer: Approval moves no stock; a PO receipt does not prove delivery to the requesting branch"
    }
  },
  {
    "id": 3,
    "group": 1,
    "th": {
      "title": "รับรายการ → ครัว → รับเงิน",
      "description": "หน้าร้านกับครัวเห็นรายการเดียวกัน ตั้งแต่สั่งอาหารจนออกใบเสร็จ",
      "note": "คำขอจาก QR ต้องให้พนักงานตรวจรับก่อนส่งครัว",
      "source": "sequenceDiagram\nautonumber\nactor Customer as ลูกค้า\nactor Staff as พนักงาน / แคชเชียร์\nparticipant POS as โต๊ะและบิล BMS\nparticipant Stock as สต็อกและต้นทุน\nparticipant Kitchen as จอครัว KDS\nparticipant Money as การชำระและกะขาย\nStaff->>POS: ยืนยันพนักงาน เปิดกะ และเปิดโต๊ะ\nalt พนักงานรับรายการ\nCustomer->>Staff: สั่งอาหารและตัวเลือก\nStaff->>POS: เพิ่มเมนูและตัวเลือก\nelse ลูกค้าสั่งผ่าน QR โต๊ะ\nCustomer->>POS: ส่งรายการที่ต้องการ\nPOS-->>Staff: แสดงคำขอให้ตรวจ\nStaff->>POS: รับรายการเข้าบิล\nend\nPOS->>POS: ตรวจเมนู ตัวเลือก ราคา และโปรโมชั่น\nStaff->>POS: ยืนยันส่งรอบเข้าครัว\nPOS->>Stock: จองสต็อกตามรายการและสูตร\nStock-->>POS: ผลการจอง\nalt ของไม่พอหรือขายไม่ได้\nPOS-->>Staff: แจ้งรายการที่ต้องแก้\nStaff-->>Customer: ตกลงเปลี่ยนรายการ\nelse ส่งรอบสำเร็จ\nPOS->>Kitchen: สร้างงานตาม Station\nKitchen->>Kitchen: ทีมครัวรับงานและทำอาหาร\nKitchen-->>Staff: อัปเดตสถานะอาหาร\nStaff-->>Customer: เสิร์ฟอาหาร\nend\nopt ลูกค้าสั่งเพิ่ม\nCustomer->>Staff: เพิ่มรายการ\nStaff->>POS: เพิ่มและส่งรอบใหม่\nPOS->>Kitchen: สร้างงานรอบใหม่เมื่อผ่านการตรวจ\nend\nCustomer->>Staff: ขอชำระเงิน\nStaff->>POS: ตรวจรายการ ส่วนลด สมาชิก และยอดสุทธิ\nCustomer->>Staff: ชำระตามช่องทางที่ร้านเปิดใช้\nStaff->>Money: ยืนยันรับชำระด้วย รหัสคำขอ ของรายการ\nMoney->>Stock: ชำระและตัดสต็อกพร้อมต้นทุนในธุรกรรมเดียวกัน\nMoney-->>POS: บิลสำเร็จและข้อมูลใบเสร็จ\nPOS-->>Customer: ใบเสร็จ\nNote over POS,Money: กดซ้ำต้องได้ผลเดิม ไม่ขายหรือตัดสต็อกซ้ำ"
    },
    "en": {
      "title": "Order, prepare and take payment",
      "description": "Keep service and kitchen teams aligned from order to receipt.",
      "note": "Staff must review table QR requests before sending them to the kitchen.",
      "source": "sequenceDiagram\nautonumber\nactor Customer as Customer\nactor Staff as Staff / cashier\nparticipant POS as BMS tables and checks\nparticipant Stock as Inventory and costs\nparticipant Kitchen as Kitchen display\nparticipant Money as Payments and shifts\nStaff->>POS: Verify staff, open shift and table\nalt Staff take the order\nCustomer->>Staff: Order dishes and options\nStaff->>POS: Add dishes and options\nelse Customer uses table QR\nCustomer->>POS: Submit requested items\nPOS-->>Staff: Present proposal for review\nStaff->>POS: Accept items into check\nend\nPOS->>POS: Validate menu, options, price and promotions\nStaff->>POS: Confirm kitchen round\nPOS->>Stock: Reserve items and recipe ingredients\nStock-->>POS: Reservation result\nalt Unavailable or insufficient stock\nPOS-->>Staff: Identify items to correct\nStaff-->>Customer: Agree replacement items\nelse Round sent successfully\nPOS->>Kitchen: Create work by station\nKitchen->>Kitchen: Kitchen accepts and prepares food\nKitchen-->>Staff: Update food status\nStaff-->>Customer: Serve food\nend\nopt Customer orders more\nCustomer->>Staff: Request more items\nStaff->>POS: Add and send another round\nPOS->>Kitchen: Create next round after validation\nend\nCustomer->>Staff: Request the bill\nStaff->>POS: Review items, discounts, membership and total\nCustomer->>Staff: Pay using a configured method\nStaff->>Money: Confirm payment with the request reference\nMoney->>Stock: Settle, deduct stock and record cost atomically\nMoney-->>POS: Completed bill and receipt data\nPOS-->>Customer: Receipt\nNote over POS,Money: A retry returns the original result; it must not repeat the sale or stock deduction"
    }
  },
  {
    "id": 4,
    "group": 2,
    "th": {
      "title": "ดูต้นทุนและปรับเมนู",
      "description": "ใช้ยอดขาย ต้นทุน และของเสียที่บันทึกจริงประกอบการตัดสินใจ",
      "note": "ส่วนต่างหลังต้นทุนวัตถุดิบไม่ใช่กำไรสุทธิทั้งร้าน ข้อมูลที่ขาดแสดงว่าไม่ทราบ",
      "source": "sequenceDiagram\nautonumber\nactor Staff as พนักงาน\nactor Manager as ผู้จัดการ / เจ้าของ\nparticipant Money as เงินและค่าใช้จ่าย\nparticipant Stock as สต็อก BMS\nparticipant Report as รายงานและวิเคราะห์เมนู\nparticipant Plan as ราคาและโปรโมชั่น\nStaff->>Money: ตรวจรับเงินและนับเงินปิดกะ\nMoney-->>Manager: ยอดระบบ เงินจริง และส่วนต่าง\nManager->>Money: ตรวจรายการค้างและบันทึกค่าใช้จ่ายพร้อมหลักฐาน\nStaff->>Stock: บันทึกของเสียและตรวจนับ\nStock-->>Manager: แสดงส่วนต่างและเหตุผล\nManager->>Stock: ผู้มีสิทธิ์ยืนยันปรับยอด\nStock->>Stock: บันทึก Movement และผู้ดำเนินการ\nManager->>Report: เลือกช่วงเวลาและสาขา\nReport->>Money: อ่านยอดขาย คืนเงิน และค่าใช้จ่าย\nReport->>Stock: อ่านต้นทุนจากการเคลื่อนไหวจริง\nalt หลักฐานครบ\nReport-->>Manager: ยอดขาย ต้นทุน ของเสีย และวิเคราะห์เมนู\nelse หลักฐานไม่ครบ\nReport-->>Manager: แสดงข้อมูลที่ไม่ทราบและรายการต้องตรวจ\nend\nManager->>Plan: จำลองราคา แพ็ก หรือโปรโมชั่น\nPlan-->>Manager: แสดงผลกระทบที่คาดไว้\nopt ตัดสินใจปรับ\nManager->>Plan: ตรวจตัวอย่างและยืนยันเผยแพร่\nPlan-->>Manager: บันทึกผู้อนุมัติ ขอบเขต และเวลา\nend\nNote over Report,Plan: ส่วนต่างหลังต้นทุนวัตถุดิบไม่ใช่กำไรสุทธิทั้งร้าน"
    },
    "en": {
      "title": "Review costs and improve menus",
      "description": "Use recorded sales, costs and wastage to guide decisions.",
      "note": "Ingredient contribution is not net profit. Missing cost evidence remains unknown.",
      "source": "sequenceDiagram\nautonumber\nactor Staff as Staff\nactor Manager as Manager / owner\nparticipant Money as Money and expenses\nparticipant Stock as BMS inventory\nparticipant Report as Reports and menu analysis\nparticipant Plan as Prices and promotions\nStaff->>Money: Review receipts and count closing cash\nMoney-->>Manager: System balance, counted cash and variance\nManager->>Money: Review outstanding items and evidence-backed expenses\nStaff->>Stock: Record wastage and physical counts\nStock-->>Manager: Show differences and reasons\nManager->>Stock: Authorized staff confirm adjustments\nStock->>Stock: Record movement and operator\nManager->>Report: Choose period and branch\nReport->>Money: Read sales, refunds and expenses\nReport->>Stock: Read costs from actual movements\nalt Complete evidence\nReport-->>Manager: Sales, costs, wastage and menu analysis\nelse Incomplete evidence\nReport-->>Manager: Show unknown values and reconciliation gaps\nend\nManager->>Plan: Simulate price, pack or promotion\nPlan-->>Manager: Show estimated impact\nopt Decision to change\nManager->>Plan: Review preview and confirm publication\nPlan-->>Manager: Record approver, scope and time\nend\nNote over Report,Plan: Ingredient contribution is not whole-business net profit"
    }
  },
  {
    "id": 5,
    "group": 2,
    "th": {
      "title": "ยกเลิกรายการและคืนเงิน",
      "description": "แยกการยกเลิกอาหารออกจากการคืนเงินจริง พร้อมติดตามรายการค้าง",
      "note": "การคืนแบบไม่ใช่เงินสดต้องมีหลักฐานจริง ไม่ถือว่าสำเร็จทันทีที่ยกเลิก",
      "source": "sequenceDiagram\nautonumber\nactor Staff as พนักงาน\nactor Approver as ผู้อนุมัติ\nparticipant BMS as บิลและออร์เดอร์\nparticipant Kitchen as งานครัว\nparticipant Stock as สต็อก\nparticipant Refund as คืนเงิน\nStaff->>BMS: เลือกบิลหรือรายการ พร้อมเหตุผล\nBMS->>BMS: ตรวจสิทธิ์ สาขา สถานะ และหลักฐานเดิม\nalt ยังไม่ส่งครัวและไม่จองของ\nStaff->>BMS: ยืนยันยกเลิกบิล\nBMS->>BMS: ปิดบิลและบันทึกผู้ดำเนินการ\nelse ยกเลิกทั้งบิลหลังส่งครัวหรือจองของ\nBMS-->>Staff: ต้องใช้ผู้อนุมัติอีกคน\nApprover->>BMS: ยืนยัน PIN และสิทธิ์\nBMS->>Stock: คืนยอดจอง\nBMS->>Kitchen: หยุดงานครัวที่ยังเปิด\nBMS->>BMS: บันทึกเหตุผลและผู้อนุมัติ\nelse ยกเลิกรายการออนไลน์หรือคืนหลังชำระ\nBMS->>BMS: ตรวจเงื่อนไขคืนและเอกสารภาษี\nalt เงื่อนไขไม่ผ่าน\nBMS-->>Staff: ปฏิเสธพร้อมเหตุผล\nelse ผ่านและผู้มีสิทธิ์ยืนยัน\nBMS->>BMS: คำนวณยอดและสิทธิ์จากหลักฐานเดิม\nBMS->>Stock: คืนยอดจองหรือบันทึกคืนตามสถานะ\nBMS->>Kitchen: ปิดงานที่ตรงกับรายการยกเลิก\nBMS->>Refund: แยกยอดคืนตามช่องทาง\nalt ส่วนเงินสด\nRefund->>Refund: บันทึกเงินออกจากกะที่รับผิดชอบ\nelse ส่วนที่ไม่ใช่เงินสด\nRefund-->>Staff: แสดงเงินคืนค้าง\nStaff->>Staff: ดำเนินการคืนเงินจริง\nStaff->>Refund: ผู้มีสิทธิ์ยืนยันเลขอ้างอิง\nRefund->>Refund: ปิดรายการคืนค้าง\nend\nend\nend\nNote over Staff,Stock: ของที่ปรุงหรือเสียจริงต้องบันทึกตามข้อเท็จจริง ไม่ตัดซ้ำ"
    },
    "en": {
      "title": "Cancel items and refund",
      "description": "Separate food cancellation from the movement of refund money.",
      "note": "Non-cash refunds need actual evidence; cancellation alone does not complete a refund.",
      "source": "sequenceDiagram\nautonumber\nactor Staff as Staff\nactor Approver as Approver\nparticipant BMS as Checks and orders\nparticipant Kitchen as Kitchen work\nparticipant Stock as Inventory\nparticipant Refund as Refunds\nStaff->>BMS: Select check or items and provide reason\nBMS->>BMS: Check permissions, branch, status and original evidence\nalt Not sent or reserved\nStaff->>BMS: Confirm check cancellation\nBMS->>BMS: Close check and record operator\nelse Cancel whole check after sending or reserving\nBMS-->>Staff: Require a second approver\nApprover->>BMS: Verify PIN and permission\nBMS->>Stock: Release reservation\nBMS->>Kitchen: Stop open kitchen work\nBMS->>BMS: Record reason and approver\nelse Cancel online items or return after payment\nBMS->>BMS: Check return rules and tax documents\nalt Not eligible\nBMS-->>Staff: Reject with reason\nelse Eligible and authorized confirmation\nBMS->>BMS: Recalculate totals and benefits from original evidence\nBMS->>Stock: Release reservation or record return as applicable\nBMS->>Kitchen: Close corresponding kitchen work\nBMS->>Refund: Allocate refund by payment method\nalt Cash portion\nRefund->>Refund: Record cash out on responsible shift\nelse Non-cash portion\nRefund-->>Staff: Show pending refund\nStaff->>Staff: Make the actual refund\nStaff->>Refund: Authorized staff confirm transfer reference\nRefund->>Refund: Resolve pending refund\nend\nend\nend\nNote over Staff,Stock: Record ingredients actually consumed or wasted; do not deduct them twice"
    }
  },
  {
    "id": 6,
    "group": 1,
    "th": {
      "title": "ย้ายโต๊ะ แยกและรวมบิล",
      "description": "จัดบิลตามที่ลูกค้าต้องการ โดยงานครัวเดิมตามรายการไป",
      "note": "แยกหรือรวมบิลใช้กับ Dine-in และไม่สร้างงานปรุงอาหารซ้ำ",
      "source": "sequenceDiagram\nautonumber\nactor Customer as ลูกค้า\nactor Staff as พนักงาน\nparticipant Check as โต๊ะและบิล\nparticipant Stock as ยอดจอง\nparticipant Kitchen as งานครัว\nparticipant Payment as รับชำระ\nCustomer->>Staff: ขอเปลี่ยนโต๊ะหรือจัดบิล\nStaff->>Check: เลือกการดำเนินการ\nCheck->>Check: ตรวจสิทธิ์ สาขา และสถานะ Dine-in\nalt ย้ายโต๊ะ\nStaff->>Check: เลือกปลายทางและยืนยัน\nCheck->>Check: ตรวจโต๊ะและย้ายบิล\nCheck-->>Kitchen: แสดงโต๊ะปัจจุบันของบิลเดิม\nelse แยกบิล\nStaff->>Check: เลือกรายการไปบิลใหม่บนโต๊ะเดิม\nCheck->>Check: ตรวจว่าบิลเดิมยังเหลือรายการ\nCheck->>Stock: คืนยอดจองเดิมก่อนจองแต่ละบิล\nCheck->>Check: คำนวณยอดใหม่ผ่านกติกากลาง\nCheck->>Kitchen: ย้ายความสัมพันธ์ตามรายการ\nCheck-->>Staff: แสดงบิลเดิมและใหม่\nelse รวมบิล\nStaff->>Check: เลือกบิลต้นทางและปลายทาง\nCheck->>Stock: คืนยอดจองเดิมก่อนจองรายการรวม\nCheck->>Check: ย้ายทุกรายการและคำนวณใหม่\nCheck->>Kitchen: ย้ายงานเดิมไปปลายทาง\nCheck->>Check: ปิดต้นทางเป็น MERGED\nCheck-->>Staff: แสดงบิลรวม\nend\nStaff->>Payment: รับชำระแต่ละบิลที่ยังเปิด\nPayment-->>Check: อัปเดตเฉพาะบิลที่สำเร็จ\nNote over Check,Kitchen: ย้ายงานครัวเดิม ไม่สร้างรายการอาหารซ้ำ"
    },
    "en": {
      "title": "Move tables, split and merge bills",
      "description": "Reorganize checks while keeping existing kitchen work linked.",
      "note": "Split and merge apply to dine-in checks and do not create duplicate kitchen work.",
      "source": "sequenceDiagram\nautonumber\nactor Customer as Customer\nactor Staff as Staff\nparticipant Check as Tables and checks\nparticipant Stock as Reservations\nparticipant Kitchen as Kitchen work\nparticipant Payment as Payments\nCustomer->>Staff: Request a table move or bill change\nStaff->>Check: Select operation\nCheck->>Check: Check permission, branch and dine-in status\nalt Move table\nStaff->>Check: Select destination and confirm\nCheck->>Check: Validate destination and move check\nCheck-->>Kitchen: Show current table for original check\nelse Split bill\nStaff->>Check: Select lines for a new check on the same table\nCheck->>Check: Ensure the original check retains an item\nCheck->>Stock: Release old reservations before reserving each check\nCheck->>Check: Recalculate using shared pricing rules\nCheck->>Kitchen: Move kitchen links with the items\nCheck-->>Staff: Show original and new checks\nelse Merge bills\nStaff->>Check: Select source and destination checks\nCheck->>Stock: Release old reservations before reserving combined lines\nCheck->>Check: Move all lines and recalculate\nCheck->>Kitchen: Move existing kitchen work to destination\nCheck->>Check: Close source as MERGED\nCheck-->>Staff: Show merged check\nend\nStaff->>Payment: Settle each open check\nPayment-->>Check: Update only the successfully paid check\nNote over Check,Kitchen: Move existing kitchen work without creating duplicate food orders"
    }
  },
  {
    "id": 7,
    "group": 1,
    "th": {
      "title": "ออนไลน์ รับเอง และจัดส่ง",
      "description": "ร้านตรวจคำขอ ยืนยันบิล และรับเข้าครัวก่อนส่งมอบ",
      "note": "ชำระเงินแล้วไม่แปลว่าอาหารพร้อม และไม่ส่งเข้าครัวโดยอัตโนมัติ",
      "source": "sequenceDiagram\nautonumber\nactor Customer as ลูกค้า\nparticipant Request as คำขอออนไลน์\nactor Staff as พนักงานร้าน\nparticipant Order as ออร์เดอร์และชำระ\nparticipant Kitchen as ครัว\nactor Handover as ผู้ส่งมอบ / ไรเดอร์\nCustomer->>Request: เลือกสาขา เมนู และรับเองหรือจัดส่ง\nRequest-->>Customer: สรุปให้ยืนยัน\nCustomer->>Request: ยืนยันคำขอ\nRequest-->>Staff: คำขอรอตรวจ\nNote over Request,Order: ยังไม่จองของและยังไม่เรียกชำระ\nalt ร้านรับไม่ได้หรือข้อมูลไม่ครบ\nStaff->>Request: ปฏิเสธหรือสอบถามเพื่อแก้รายการ\nStaff-->>Customer: แจ้งผลและตกลงรายการใหม่\nelse ร้านรับได้\nStaff->>Request: ยืนยันรายการที่ตกลง\nRequest->>Order: สร้างออร์เดอร์ จองของ และลิงก์ชำระ\nOrder-->>Customer: ส่งสรุปและช่องทางที่ร้านตั้งค่า\nCustomer->>Order: แจ้งชำระพร้อมหลักฐาน\nStaff->>Order: ตรวจและยืนยันชำระ\nalt ทำบางรายการไม่ได้\nStaff->>Order: ยกเลิกรายการพร้อมสาเหตุ\nOrder-->>Staff: ยอดใหม่และเงินคืนตาม Flow 5\nelse พร้อมทำ\nStaff->>Order: ยืนยันรับเข้าครัว\nOrder->>Kitchen: สร้างงานครัว\nKitchen-->>Staff: อัปเดตอาหาร\nend\nalt รับเอง\nCustomer->>Staff: มารับอาหาร\nStaff->>Staff: ตรวจผู้รับและรายการ\nStaff->>Order: ยืนยันส่งมอบจริง\nOrder->>Order: ตัดสต็อกและบันทึกส่งมอบ\nelse จัดส่ง\nStaff->>Handover: ส่งอาหารให้ผู้จัดส่ง\nStaff->>Order: บันทึกและยืนยันส่งตามขั้นตอน\nOrder->>Order: ตัดสต็อกและบันทึกการส่ง\nHandover-->>Customer: ส่งอาหาร\nend\nopt ส่งมอบไม่สำเร็จ\nStaff->>Order: ตรวจสถานะและหลักฐานล่าสุด\nStaff-->>Customer: ติดต่อเพื่อตกลงแนวทาง\nNote over Staff,Order: ไม่ถือว่ารับสำเร็จหรือคืนเงินอัตโนมัติ\nend\nend"
    },
    "en": {
      "title": "Online orders, pickup and delivery",
      "description": "Review requests, confirm orders and accept kitchen work before handover.",
      "note": "Payment does not mean food is ready and does not automatically create kitchen work.",
      "source": "sequenceDiagram\nautonumber\nactor Customer as Customer\nparticipant Request as Online requests\nactor Staff as Store staff\nparticipant Order as Orders and payment\nparticipant Kitchen as Kitchen\nactor Handover as Handover / rider\nCustomer->>Request: Select branch, menu and pickup or delivery\nRequest-->>Customer: Present summary for confirmation\nCustomer->>Request: Confirm request\nRequest-->>Staff: Request awaiting review\nNote over Request,Order: No stock reservation or payment request yet\nalt Cannot accept or information missing\nStaff->>Request: Reject or ask to amend items\nStaff-->>Customer: Explain outcome and agree changes\nelse Store can accept\nStaff->>Request: Confirm agreed items\nRequest->>Order: Create order, reserve stock and checkout link\nOrder-->>Customer: Send summary and configured payment options\nCustomer->>Order: Submit payment evidence\nStaff->>Order: Review and confirm payment\nalt Some items cannot be prepared\nStaff->>Order: Cancel items with reason\nOrder-->>Staff: Revised totals and refunds via Flow 5\nelse Ready to prepare\nStaff->>Order: Accept into kitchen\nOrder->>Kitchen: Create kitchen work\nKitchen-->>Staff: Update food status\nend\nalt Pickup\nCustomer->>Staff: Arrive to collect food\nStaff->>Staff: Check recipient and items\nStaff->>Order: Confirm actual handover\nOrder->>Order: Deduct stock and record handover\nelse Delivery\nStaff->>Handover: Hand food to delivery staff\nStaff->>Order: Record and confirm dispatch\nOrder->>Order: Deduct stock and record dispatch\nHandover-->>Customer: Deliver food\nend\nopt Handover fails\nStaff->>Order: Review latest status and evidence\nStaff-->>Customer: Contact customer to agree next steps\nNote over Staff,Order: Do not assume successful receipt or an automatic refund\nend\nend"
    }
  },
  {
    "id": 8,
    "group": 0,
    "th": {
      "title": "ซื้อเข้าและรับของบางส่วน",
      "description": "รับเข้าเฉพาะของที่ตรวจรับจริง และติดตามยอดค้างใน PO",
      "note": "รับของไม่เท่ากับจ่ายเงิน Supplier และยกเลิก PO ไม่ย้อนของที่รับไปแล้ว",
      "source": "sequenceDiagram\nautonumber\nactor Buyer as ผู้จัดซื้อ\nparticipant PO as ใบสั่งซื้อ BMS\nactor Supplier as Supplier\nactor Receiver as ผู้ตรวจรับ\nparticipant Stock as สต็อกและมูลค่า\nBuyer->>PO: สร้าง PO ระบุสินค้า จำนวน และต้นทุน\nPO-->>Buyer: OPEN\nBuyer->>Supplier: ส่งคำสั่งซื้อผ่านช่องทางที่ใช้งาน\nloop แต่ละรอบที่ส่งของ\nSupplier->>Receiver: ส่งสินค้าและเอกสาร\nReceiver->>Receiver: ตรวจของและจำนวนที่รับได้\nReceiver->>PO: ยืนยันเฉพาะจำนวนรับจริง\nPO->>PO: ตรวจสิทธิ์และยอดค้างรับ\nPO->>Stock: เพิ่มจำนวน มูลค่า และ Movement\nalt ยังไม่ครบ\nPO-->>Buyer: PARTIAL พร้อมยอดค้างรับ\nBuyer->>Supplier: ติดตามส่วนที่ขาด\nelse ครบแล้ว\nPO-->>Buyer: RECEIVED\nend\nend\nopt ตกลงไม่รับส่วนที่เหลือ\nBuyer->>PO: ผู้มีสิทธิ์ยกเลิก PO ที่ยังเปิดหรือรับบางส่วน\nPO-->>Buyer: CANCELLED โดยคงหลักฐานที่รับแล้ว\nend\nNote over PO,Stock: ยกเลิก PO ไม่ย้อนสต็อกที่รับเข้าแล้ว\nNote over Buyer,PO: รับของไม่เท่ากับจ่ายเงิน Supplier"
    },
    "en": {
      "title": "Purchase and receive in parts",
      "description": "Receive only verified quantities and follow up outstanding PO items.",
      "note": "Receipt is not supplier payment. Cancelling a PO does not reverse earlier receipts.",
      "source": "sequenceDiagram\nautonumber\nactor Buyer as Purchaser\nparticipant PO as BMS purchase orders\nactor Supplier as Supplier\nactor Receiver as Receiving staff\nparticipant Stock as Inventory and value\nBuyer->>PO: Create PO with items, quantities and cost\nPO-->>Buyer: OPEN\nBuyer->>Supplier: Send PO through the channel in use\nloop Each delivery\nSupplier->>Receiver: Deliver goods and documents\nReceiver->>Receiver: Check goods and acceptable quantities\nReceiver->>PO: Confirm only quantities actually received\nPO->>PO: Validate permission and outstanding balance\nPO->>Stock: Add quantity, value and movement\nalt Still outstanding\nPO-->>Buyer: PARTIAL with remaining quantities\nBuyer->>Supplier: Follow up missing goods\nelse Complete\nPO-->>Buyer: RECEIVED\nend\nend\nopt Agree not to receive remaining quantities\nBuyer->>PO: Authorized staff cancel open or partly received PO\nPO-->>Buyer: CANCELLED; retain previous receipts\nend\nNote over PO,Stock: Cancelling a PO does not reverse goods already received\nNote over Buyer,PO: Receiving goods does not confirm supplier payment"
    }
  },
  {
    "id": 9,
    "group": 1,
    "th": {
      "title": "สมาชิก แต้ม และโปรโมชั่น",
      "description": "ตรวจสิทธิ์และราคาตามกติกากลาง ก่อนยืนยันยอดขาย",
      "note": "คืนสินค้าหลังขายไม่คืนโควตาคูปองทุกกรณี ต้องอิงนโยบายของรายการ",
      "source": "sequenceDiagram\nautonumber\nactor Customer as ลูกค้า\nactor Staff as พนักงาน\nparticipant POS as บิล BMS\nparticipant CRM as สมาชิกและสิทธิ์\nparticipant Pricing as ราคากลาง\nparticipant Payment as ชำระเงิน\nCustomer->>Staff: ระบุสมาชิกและสิทธิ์ที่ต้องการ\nStaff->>POS: ผูกสมาชิก เลือกคูปองหรือแต้ม\nPOS->>CRM: ตรวจสิทธิ์คงเหลือและเงื่อนไข\nPOS->>Pricing: ตรวจราคา สาขา ช่องทาง เวลา และจำนวน\nPricing-->>POS: ยอดตามกติกาที่เข้าเงื่อนไข\nPOS-->>Staff: แสดงยอดและสิทธิ์\nStaff-->>Customer: ยืนยันยอดก่อนชำระ\nopt ส่วนลดกำหนดเอง\nStaff->>POS: ขออนุมัติจากอีกคนด้วย PIN และสิทธิ์ตรงงาน\nend\nStaff->>Payment: ยืนยันรับชำระ\nPayment->>CRM: บันทึกใช้และสะสมสิทธิ์\nPayment-->>POS: บิลสำเร็จและผลสมาชิก\nalt ยกเลิกก่อนขายสำเร็จ\nPOS->>CRM: คืนสิทธิ์ที่จองไว้ตามนโยบาย\nelse คืนหรือยกเลิกรายการหลังขาย\nPOS->>CRM: คำนวณย้อนสิทธิ์จากหลักฐานเดิม\nNote over POS,CRM: ไม่คืนโควตาคูปองทุกกรณีโดยอัตโนมัติ\nend\nNote over Pricing,Payment: Backend ตรวจราคาและสิทธิ์ตอนบันทึกจริง"
    },
    "en": {
      "title": "Members, points and promotions",
      "description": "Validate eligibility and shared pricing before completing a sale.",
      "note": "Post-sale returns do not automatically restore every coupon; the original policy applies.",
      "source": "sequenceDiagram\nautonumber\nactor Customer as Customer\nactor Staff as Staff\nparticipant POS as BMS check\nparticipant CRM as Membership and benefits\nparticipant Pricing as Shared pricing\nparticipant Payment as Payment\nCustomer->>Staff: Identify membership and requested benefits\nStaff->>POS: Link member; select coupon or points\nPOS->>CRM: Check balances and eligibility\nPOS->>Pricing: Check price, branch, channel, dates and quantity\nPricing-->>POS: Total under applicable rules\nPOS-->>Staff: Show total and benefits\nStaff-->>Customer: Confirm total before payment\nopt Manual discount\nStaff->>POS: Obtain a second person's PIN with the correct permission\nend\nStaff->>Payment: Confirm payment\nPayment->>CRM: Record benefit redemption and accrual\nPayment-->>POS: Completed bill and membership result\nalt Cancel before sale completion\nPOS->>CRM: Release reserved benefits under policy\nelse Return or cancel items after sale\nPOS->>CRM: Reverse benefits from original evidence\nNote over POS,CRM: Coupon quota is not automatically restored in every case\nend\nNote over Pricing,Payment: Server rechecks price and eligibility when committing"
    }
  },
  {
    "id": 10,
    "group": 2,
    "th": {
      "title": "ปิดกะและเอกสารภาษี",
      "description": "เห็นยอดระบบ เงินที่นับจริง และเอกสารที่ต้องตรวจ",
      "note": "ปิดกะไม่ใช่การกระทบยอดธนาคารอัตโนมัติ และสำเนา PDF ไม่ใช่ e-Tax",
      "source": "sequenceDiagram\nautonumber\nactor Cashier as แคชเชียร์\nparticipant Shift as กะและลิ้นชัก\nactor Manager as ผู้จัดการ / บัญชี\nparticipant Reports as รายงาน\nparticipant Tax as เอกสารภาษี\nactor Customer as ลูกค้า\nCashier->>Shift: ขอปิดกะของเครื่องที่รับผิดชอบ\nShift->>Shift: ตรวจรายการที่ต้องสะสาง\nalt มีรายการห้ามปิด เช่น เงินคืนค้างของกะ\nShift-->>Cashier: แสดงรายการต้องดำเนินการ\nCashier->>Manager: ส่งให้ผู้มีสิทธิ์สะสาง\nelse พร้อมปิด\nCashier->>Shift: กรอกเงินนับจริงและหมายเหตุ\nShift->>Shift: คำนวณยอดคาดหมายและส่วนต่าง\nShift->>Shift: บันทึกปิดกะ\nShift-->>Reports: ข้อมูลรายงานปิดกะ\nManager->>Reports: ตรวจยอดขาย ช่องทาง เงินออก และเงินคืน\nManager->>Manager: เทียบเงินฝากและหลักฐานธนาคาร\nend\nopt ขอใบกำกับภาษีเต็มรูป\nCustomer->>Tax: ส่งคำขอจาก QR ใบเสร็จ\nTax-->>Manager: ข้อมูลผู้ซื้อและคำขอ\nManager->>Tax: ตรวจข้อมูลและยืนยัน\nTax->>Tax: ตรวจสิทธิ์ สาขา และเงื่อนไขบิล\nalt บิลเข้าเงื่อนไข\nTax-->>Customer: ออกเอกสารตามขั้นตอน\nopt เลือกส่งอีเมล\nTax->>Tax: เข้าคิวส่ง PDF และติดตามผล\nend\nelse ไม่เข้าเงื่อนไข\nTax-->>Manager: แจ้งเหตุผลที่ออกไม่ได้\nend\nend\nNote over Shift,Reports: ปิดกะไม่ยืนยันว่าเงินเข้าธนาคารครบ\nNote over Tax,Customer: ส่งอีเมลล้มเหลวไม่ย้อนเอกสาร PDF ไม่ใช่ e-Tax"
    },
    "en": {
      "title": "Close shifts and issue documents",
      "description": "Review system totals, counted cash and document requests.",
      "note": "Shift closure is not automatic bank reconciliation. PDF copies are not e-Tax.",
      "source": "sequenceDiagram\nautonumber\nactor Cashier as Cashier\nparticipant Shift as Shift and drawer\nactor Manager as Manager / accounting\nparticipant Reports as Reports\nparticipant Tax as Tax documents\nactor Customer as Customer\nCashier->>Shift: Request closure of the responsible register shift\nShift->>Shift: Check unresolved items\nalt Blocking items such as pending shift refunds\nShift-->>Cashier: Show items requiring action\nCashier->>Manager: Ask authorized staff to resolve them\nelse Ready to close\nCashier->>Shift: Enter counted cash and note\nShift->>Shift: Calculate expected cash and variance\nShift->>Shift: Save shift closure\nShift-->>Reports: Closing report data\nManager->>Reports: Review sales, tender methods, cash out and refunds\nManager->>Manager: Compare bank deposits and evidence\nend\nopt Full tax invoice requested\nCustomer->>Tax: Submit via receipt QR\nTax-->>Manager: Buyer details and request\nManager->>Tax: Review details and confirm\nTax->>Tax: Check permission, branch and bill eligibility\nalt Eligible bill\nTax-->>Customer: Issue document through the supported process\nopt Email requested\nTax->>Tax: Queue PDF delivery and track outcome\nend\nelse Not eligible\nTax-->>Manager: Explain why issuance is refused\nend\nend\nNote over Shift,Reports: Closing a shift does not confirm all funds reached the bank\nNote over Tax,Customer: Email failure does not undo issuance; a PDF copy is not e-Tax"
    }
  },
  {
    "id": 11,
    "group": 3,
    "th": {
      "title": "สิทธิ์และป้องกันรายการซ้ำ",
      "description": "ตัวอย่างใบโอนสต็อกที่ตรวจสาขาและตรวจผลคำขอเดิมหลังเน็ตหลุด",
      "note": "การกดตรวจผลเดิมต้องผ่านการตรวจสิทธิ์อีกครั้ง ใช้ข้อมูลและรหัสคำขอเดิม",
      "source": "sequenceDiagram\nautonumber\nactor User as ผู้ใช้งาน\nparticipant UI as หน้าจอใบโอน\nparticipant API as BMS API\nparticipant Service as บริการโอนสต็อก\nparticipant DB as ข้อมูลและ Audit\nUser->>UI: ตรวจและยืนยันคำสั่ง\nUI->>UI: เก็บข้อมูลคำขอและ รหัสคำขอ ก่อนส่ง\nUI->>API: ส่งคำสั่งพร้อม รหัสคำขอ ของรายการ\nAPI->>API: ตรวจผู้ใช้ ร้าน และสิทธิ์\nAPI->>Service: ส่งตัวตนที่ยืนยันแล้ว\nService->>DB: เปิดธุรกรรมและตรวจสาขา\nNote over Service,DB: สร้างใช้ทั้งสองสาขา ส่งและยกเลิกใช้ต้นทาง รับใช้ปลายทาง\nalt ไม่มีสิทธิ์\nService-->>UI: ปฏิเสธโดยไม่ทำรายการ\nelse มีสิทธิ์\nService->>DB: ตรวจ รหัสคำขอ และข้อมูล\nalt สำเร็จแล้วและข้อมูลตรงกัน\nDB-->>UI: คืนผลเดิม ไม่ขยับของซ้ำ\nelse รหัสคำขอ เดิมแต่ข้อมูลหรือผู้ทำเปลี่ยน\nDB-->>UI: ปฏิเสธคำขอขัดแย้ง\nelse คำขอใหม่\nService->>DB: ตรวจสถานะและทำรายการ\nService->>DB: บันทึกผล Audit และ รหัสคำขอ ในธุรกรรมเดียวกัน\nDB-->>API: Commit สำเร็จ\nalt หน้าจอได้รับคำตอบ\nAPI-->>UI: แสดงผลสำเร็จ\nUI->>UI: ล้างคำขอค้างและโหลดข้อมูลล่าสุด\nelse เครือข่ายขาดจนไม่ทราบผล\nUI-->>User: ให้ตรวจผลคำขอเดิม\nUser->>UI: กดตรวจผล แม้รีโหลดแล้ว\nUI->>API: ส่งข้อมูลและ รหัสคำขอ เดิม\nAPI->>Service: ตรวจตัวตนและสิทธิ์ใหม่\nService->>DB: ตรวจสาขาก่อนอ่านผลเดิม\nDB-->>UI: คืนผลเดิมเมื่อยังมีสิทธิ์\nend\nend\nend\nNote over UI,DB: อย่าสร้าง รหัสคำขอ ใหม่เพื่อทดลองซ้ำเมื่อยังไม่ทราบผลเดิม"
    },
    "en": {
      "title": "Permissions and safe retries",
      "description": "See how staff transfers check branch access and recover after a lost response.",
      "note": "Checking a previous result rechecks permissions and uses the same payload and reference.",
      "source": "sequenceDiagram\nautonumber\nactor User as User\nparticipant UI as Transfer screen\nparticipant API as BMS API\nparticipant Service as Transfer service\nparticipant DB as Data and audit\nUser->>UI: Review and confirm command\nUI->>UI: Save payload and request reference before sending\nUI->>API: Send with the original request reference\nAPI->>API: Verify user, tenant and permission\nAPI->>Service: Pass verified identity\nService->>DB: Open transaction and check branch access\nNote over Service,DB: Create needs both branches; send/cancel need source; receive needs destination\nalt No permission\nService-->>UI: Reject without executing\nelse Authorized\nService->>DB: Check reference and payload\nalt Already succeeded with matching data\nDB-->>UI: Return original result; do not move stock again\nelse Same reference with different data or actor\nDB-->>UI: Reject conflicting request\nelse New request\nService->>DB: Validate state and execute\nService->>DB: Save outcome, audit and request reference atomically\nDB-->>API: Commit succeeds\nalt Screen receives response\nAPI-->>UI: Show success\nUI->>UI: Clear pending command and refresh\nelse Connection lost; outcome unknown\nUI-->>User: Offer to check original request\nUser->>UI: Check outcome even after page reload\nUI->>API: Send original payload and reference\nAPI->>Service: Recheck identity and permission\nService->>DB: Recheck branch access before replay\nDB-->>UI: Return original result only if still authorized\nend\nend\nend\nNote over UI,DB: Do not create a new request reference while the previous outcome is unknown"
    }
  }
];
