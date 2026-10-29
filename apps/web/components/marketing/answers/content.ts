import type { PublicSeoLocale } from "@/lib/publicSeo";

export type PublicAnswerContent = {
  title: string;
  summary: string;
  faq: Array<{ question: string; answer: string }>;
  links: Array<{ path: string; label: string }>;
};
export const ANSWERS_REVIEWED_AT = "2026-10-29";
export const publicAnswers: Record<"restaurant" | "cost-pricing", Record<PublicSeoLocale, PublicAnswerContent>> = {
  restaurant: {
    th: {
      title: "เลือกระบบร้านอาหารจากขั้นตอนที่ร้านใช้จริง",
      summary: "เริ่มจากรูปแบบบริการของร้าน: ขายหน้าเคาน์เตอร์ รับประทานที่โต๊ะ หรือรับกลับบ้าน แล้วตรวจว่าออร์เดอร์ไปถึงครัว การรับเงิน และสต็อกอย่างไร BMS มีคู่มือแยกแต่ละงาน พร้อมขอบเขตที่ควรตรวจสอบก่อนเริ่มใช้",
      faq: [
        { question: "ร้านอาหารควรเตรียมอะไร ก่อนเริ่มใช้ BMS?", answer: "เตรียมเมนู ราคา สูตรและหน่วยวัตถุดิบ สถานีครัว ผังโต๊ะถ้ามี และสิทธิ์ของพนักงาน จากนั้นซ้อมเปิดบิล ส่งครัว รับชำระ และตรวจรายงานก่อนเปิดใช้กับลูกค้าจริง" },
        { question: "คาเฟ่ขายหน้าเคาน์เตอร์ต้องใช้ระบบโต๊ะและครัวทุกส่วนไหม?", answer: "ไม่จำเป็น ร้านที่รับเงินและส่งสินค้าทันทีเริ่มจากคู่มือ Retail POS สำหรับคาเฟ่หน้าเคาน์เตอร์ได้ ส่วนร้านที่ต้องส่งงานไปครัวหรือเปิดบิลค้างที่โต๊ะควรดูคู่มือร้านอาหาร เลือกตามงานจริงของร้าน" },
        { question: "รับชำระเงินแล้ว ออร์เดอร์จะถูกส่งเข้าครัวเองหรือไม่?", answer: "การชำระเงินกับการส่งงานเข้าครัวเป็นคนละขั้นตอนใน BMS ต้องตรวจออร์เดอร์และทำขั้นตอนส่งครัวตาม workflow ของร้าน การรับเงินอย่างเดียวไม่สร้างงานครัว" },
        { question: "เชื่อม GrabFood และ LINE MAN ได้แล้วหรือยัง?", answer: "ยังไม่ควรถือว่าพร้อมเชื่อมใช้งานจริง การเชื่อม GrabFood และ LINE MAN ยังติดเงื่อนไขสัญญาและสิทธิ์จากผู้ให้บริการ กรุณาตรวจสอบความพร้อมกับทีม BMS ก่อนวางแผนใช้ ส่วน foodpanda อยู่ในขอบเขต sandbox/shadow" },
      ],
      links: [
        { path: "/learn/guides/restaurant-menu", label: "จัดเมนู สูตร และสถานีครัว" },
        { path: "/learn/guides/restaurant-service", label: "เปิดบิล ส่งครัว และคิดเงิน" },
        { path: "/learn/guides/retail-food-counter", label: "คาเฟ่หน้าเคาน์เตอร์แบบ Retail POS" },
        { path: "/learn/guides/restaurant-rehearsal", label: "ซ้อมก่อนเปิดร้านจริง" },
      ],
    },
    en: {
      title: "Choose restaurant software around the work your shop does",
      summary: "Start with counter service, table service or pickup, then trace how orders reach the kitchen, payment and inventory. BMS provides guides for each workflow, including boundaries to check before going live.",
      faq: [
        { question: "What should a restaurant prepare before using BMS?", answer: "Prepare menus, prices, recipes and ingredient units, kitchen stations, a floor plan where needed, and staff permissions. Rehearse opening a check, sending kitchen work, taking payment and checking reports before serving real customers." },
        { question: "Does a counter-service cafe need every table and kitchen feature?", answer: "No. A shop that takes payment and hands over products immediately can start with the Retail POS food-counter guide. Shops that send work to a kitchen or keep table checks open should follow the restaurant guide. Choose the workflow that matches the shop." },
        { question: "Does taking payment automatically send an order to the kitchen?", answer: "Payment and kitchen dispatch are separate BMS steps. Review the order and submit kitchen work through the restaurant workflow. Taking payment alone does not create kitchen work." },
        { question: "Are GrabFood and LINE MAN integrations ready to use?", answer: "Do not assume live availability. GrabFood and LINE MAN connections remain blocked by provider contracts and access requirements. Check readiness with the BMS team before planning a rollout. The foodpanda adapter is limited to sandbox/shadow use." },
      ],
      links: [
        { path: "/learn/guides/restaurant-menu", label: "Menus, recipes and kitchen stations" },
        { path: "/learn/guides/restaurant-service", label: "Checks, kitchen work and checkout" },
        { path: "/learn/guides/retail-food-counter", label: "Retail POS for counter-service cafes" },
        { path: "/learn/guides/restaurant-rehearsal", label: "Rehearse before opening" },
      ],
    },
  },
  "cost-pricing": {
    th: {
      title: "คำนวณต้นทุนต่อแก้ว และแยกส่วนเหลือออกจากกำไรสุทธิ",
      summary: "ในตัวอย่าง 100 แก้ว: (วัตถุดิบ 2,000 + ขนส่ง 200) ÷ 100 = 22 บาทต่อแก้ว บวกบรรจุภัณฑ์ แรงงานและพลังงานที่สมมติไว้ 8 บาท ได้ต้นทุนประมาณการ 30 บาท ขาย 65 บาท เหลือ 35 บาทก่อนหักค่าใช้จ่ายคงที่ ภาษีและค่าธรรมเนียมช่องทาง",
      faq: [
        { question: "ต้นทุนต่อแก้ว 30 บาท คิดจากอะไร?", answer: "ตัวอย่างนี้สมมติว่าผลิตได้ครบ 100 แก้ว ใช้วัตถุดิบ 2,000 บาทและขนส่ง 200 บาท จึงได้ต้นทุนถึงร้าน 22 บาทต่อแก้ว แล้วบวกบรรจุภัณฑ์ แรงงานและพลังงานอีก 8 บาท ตัวเลขเป็นข้อมูลตัวอย่าง ไม่ใช่ต้นทุนจริงของร้านคุณ" },
        { question: "ขาย 65 บาท ต้นทุน 30 บาท เท่ากับกำไรสุทธิ 35 บาทหรือไม่?", answer: "ยังไม่ใช่ 35 บาทเป็นส่วนเหลือต่อแก้วในแบบจำลองก่อนหักค่าใช้จ่ายคงที่ ภาษีและค่าธรรมเนียมช่องทาง ต้องตรวจรายจ่ายและยอดขายจริงก่อนสรุปกำไรสุทธิ และระวังไม่บันทึกต้นทุนรายการเดียวกันซ้ำทั้งต้นทุนต่อแก้วและค่าใช้จ่ายคงที่" },
        { question: "ตัวอย่างนี้ต้องขายเท่าไรจึงครอบคลุมค่าใช้จ่ายคงที่?", answer: "ถ้าค่าใช้จ่ายคงที่ 21,000 บาทต่อเดือน และเหลือแก้วละ 35 บาท ต้องขาย 21,000 ÷ 35 = 600 แก้วต่อเดือน หรือเฉลี่ย 20 แก้วต่อวันเมื่อเปิด 30 วัน เป็นตัวอย่างที่ยังไม่รวมภาษี ค่าธรรมเนียม ของเสีย หรือการเปลี่ยนแปลงของยอดขาย" },
        { question: "เครื่องคำนวณนี้เปลี่ยนราคาขายในร้านจริงหรือไม่?", answer: "ไม่เปลี่ยน เครื่องมือนี้ใช้ลองสมมติฐานบนหน้าสาธารณะเท่านั้น ไม่บันทึกราคาสินค้า ไม่แก้สต็อก และไม่ส่งตัวเลขที่กรอกไปยัง analytics การตั้งราคาจริงต้องทำในระบบด้วยสิทธิ์และขั้นตอนที่เกี่ยวข้อง" },
      ],
      links: [
        { path: "/learn/guides/restaurant-costs-quality", label: "วัตถุดิบ ของเสีย และต้นทุน" },
        { path: "/learn/guides/inventory-purchase-receiving", label: "จัดซื้อ รับเข้า และต้นทุนถึงร้าน" },
        { path: "/learn/guides/reports-ai", label: "ตรวจรายงานและถามผู้ช่วย AI" },
        { path: "/restaurant", label: "ดูงานร้านอาหารทั้งกระบวนการ" },
      ],
    },
    en: {
      title: "Calculate cost per cup and distinguish contribution from net profit",
      summary: "For the example batch of 100 cups: (2,000 ingredients + 200 freight) ÷ 100 = 22 baht per cup. Add the assumed 8 baht for packaging, labor and energy to get an estimated cost of 30 baht. A price of 65 leaves 35 baht before fixed costs, tax and channel fees.",
      faq: [
        { question: "How is the estimated cost of 30 baht per cup calculated?", answer: "The example assumes a yield of 100 cups from 2,000 baht of ingredients and 200 baht of freight: 22 baht landed cost per cup, plus 8 baht for packaging, labor and energy. These are illustrative inputs, not your shop's actual costs." },
        { question: "Does selling at 65 with a cost of 30 mean 35 baht of net profit?", answer: "No. The 35 baht is contribution per cup in this model before fixed costs, tax and channel fees. Review recorded sales and expenses before calculating net profit, and avoid counting the same cost both per cup and as a fixed expense." },
        { question: "How much must the example sell to cover fixed costs?", answer: "At 21,000 baht of monthly fixed costs and 35 baht contribution per cup, 21,000 ÷ 35 = 600 cups per month, or an average of 20 cups per day over 30 open days. This example excludes tax, channel fees, wastage and changes in sales mix." },
        { question: "Does this calculator update the shop's real selling prices?", answer: "No. It is a public illustration for trying assumptions. It does not save product prices, change stock or send entered numbers to analytics. Actual price changes belong in the system's authorized workflow." },
      ],
      links: [
        { path: "/learn/guides/restaurant-costs-quality", label: "Ingredients, wastage and costs" },
        { path: "/learn/guides/inventory-purchase-receiving", label: "Purchasing, receiving and landed cost" },
        { path: "/learn/guides/reports-ai", label: "Reports and the AI assistant" },
        { path: "/restaurant", label: "The restaurant operating workflow" },
      ],
    },
  },
};
