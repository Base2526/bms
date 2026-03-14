// i18n/th.ts
const th = {
  header: {
    title: "จ่าเฉย (JACHOEI)",

    // 🔍 search-related
    searchPlaceholder: "ค้นหาโพสต์, ผู้ใช้, หมายเลขโทรศัพท์...",
    searchClearHistory: "ล้างประวัติการค้นหา",
    searchHintPrefix: "กด",
    searchHintSuffix: "เพื่อค้นหาอย่างรวดเร็ว",
    help: "ช่วยเหลือ",
    chat: "แชท",
    notifications: "การแจ้งเตือน",
    newPost: "โพสต์ใหม่",
  },
  footer: {
    support: "ติดต่อฝ่ายสนับสนุน"
  },
  notificationPage: {
    title: "การแจ้งเตือน",
    tabAll: "ทั้งหมด",
    tabUnread: "ยังไม่อ่าน",
    tabChat: "แชท",
    tabPosts: "โพสต์",
    searchPlaceholder: "ค้นหาการแจ้งเตือน...",
    markAllRead: "อ่านทั้งหมด",
    settings: "ตั้งค่า",
    empty: "ยังไม่มีการแจ้งเตือน",
  },

  searchPage: {
    title: "ค้นหา",
    inputPlaceholder: "พิมพ์คำค้นหาแล้วกด Enter...",
    noQuery: "กรุณาพิมพ์คำค้นหาที่กล่องด้านบน",
    loading: "กำลังค้นหา...",
    errorTitle: "เกิดข้อผิดพลาดระหว่างค้นหา",
    noResults: "ไม่พบผลลัพธ์ที่ตรงกับคำค้นหา",
    resultsFor: "ผลการค้นหาสำหรับ",
  },

  postPage:{
    save: "บันทึก",
    create: "สร้างใหม่"
  },

  roadmap: {
    pageTitle: "Roadmap การพัฒนาระบบ jachoei.com",
    subtitle: "แผนพัฒนาระบบเพื่อให้การรับเรื่องร้องเรียนมีความน่าเชื่อถือ ใช้งานง่าย และพร้อมใช้เป็นหลักฐาน",
    language: "ภาษา",
    overview: "ภาพรวม",
    done: "เสร็จแล้ว",
    inProgress: "กำลังทำ",
    planned: "วางแผน",
    keyObjectives: "เป้าหมายหลัก",
    objectivePoints: [
      "รวบรวมหลักฐานได้ครบถ้วน + เชื่อถือได้ (Evidence-ready)",
      "ลดเรื่องซ้ำ/สแปม และยกระดับคุณภาพข้อมูล",
      "ทำให้การแชร์/รายงาน/ส่งต่อหน่วยงานทำได้ง่าย",
      "รองรับการเติบโต: moderation, analytics, API",
    ],
    suggestedAdd: "ข้อเสนอแนะเพิ่มเติม (แนะนำ)",
    progressLabel: "ความคืบหน้าโดยประมาณ",
    roadmap: "แผนงานตามไตรมาส",
    notes: "หมายเหตุ",
    notesText:
      "Roadmap นี้ออกแบบให้เริ่มจากการทำ “เคสมีหลักฐานและตรวจสอบได้” ก่อน แล้วค่อยขยายไป social automation และ analytics เพื่อโตแบบมีคุณภาพ",
    recommendTag: "คำแนะนำ",
    tip1: "เริ่มจาก Export PDF + Zip หลักฐานก่อน แล้วค่อยต่อ Social Auto-post",
    tip2: "ลงทุนกับ Search + Duplicate detection จะลดภาระทีมและเพิ่มคุณภาพข้อมูล",
    status: "สถานะ",
    goals: "Goals",
    deliverables: "Deliverables",

    // ✅ บล็อก “สิ่งที่ทำแล้ว” ให้เป็น item ใน timeline (done)
    qBuilt: "Built (ปัจจุบัน)",
    builtTitleTh: "สิ่งที่พัฒนาไปแล้ว",
    builtTitleEn: "Already built",
    builtGoalsTh: ["มีระบบพื้นฐานครบ: สมาชิก/รับเรื่อง/แชท/อีเมล"],
    builtGoalsEn: ["Solid foundation: membership/intake/chat/email"],
    builtDeliverablesTh: ["ระบบสมาชิก", "ระบบรับเรื่องร้องทุกข์", "ระบบสนทนาแชท", "ระบบอีเมลแจ้งเตือน"],
    builtDeliverablesEn: ["Membership system", "Complaint intake", "Chat", "Email notifications"],

    // ✅ suggested bullets
    suggest1: "Evidence Vault (ไฟล์หลักฐาน + เวลา)",
    suggest2: "Case Timeline & Status",
    suggest3: "Duplicate / Similarity Detection",
    suggest4: "Moderation Queue + PII Redaction",
    suggest5: "Watchlist & Alerts",
    suggest6: "Public Safe Share Page",
    suggest7: "Analytics Dashboard",
    suggest8: "API / Webhook for partners",
  },
  breadcrumbs :{
    home: "หน้าหลัก"
  }
};

export default th;
