(function () {
  // Local shell copy only. The hosted register uses apps/web/i18n/pos-client.json.
  const english = {
    "เกี่ยวกับ BMS POS": "About BMS POS",
    "บริการ": "Services",
    "ซ่อน BMS POS": "Hide BMS POS",
    "ซ่อนแอปอื่น": "Hide Others",
    "แสดงทั้งหมด": "Show All",
    "ออกจากแอป": "Quit",
    "ไฟล์": "File",
    "แก้ไข": "Edit",
    "มุมมอง": "View",
    "หน้าต่าง": "Window",
    "เลิกทำ": "Undo",
    "ทำซ้ำ": "Redo",
    "ตัด": "Cut",
    "คัดลอก": "Copy",
    "วาง": "Paste",
    "วางและใช้รูปแบบปัจจุบัน": "Paste and Match Style",
    "ลบ": "Delete",
    "เลือกทั้งหมด": "Select All",
    "ปิดหน้าต่าง": "Close Window",
    "ย่อหน้าต่าง": "Minimize",
    "ขยายหน้าต่าง": "Zoom",
    "นำหน้าต่างทั้งหมดมาด้านหน้า": "Bring All to Front",
    "สลับเต็มหน้าจอ": "Toggle Full Screen",
    "เครื่องมือสำหรับนักพัฒนา": "Developer Tools",
    "การพูด": "Speech",
    "เริ่มอ่านออกเสียง": "Start Speaking",
    "หยุดอ่านออกเสียง": "Stop Speaking",
    "แสดงแถบแท็บ": "Show Tab Bar",
    "แท็บถัดไป": "Next Tab",
    "แท็บก่อนหน้า": "Previous Tab",
    "แสดงแท็บทั้งหมด": "Show All Tabs",
    "รวมหน้าต่างทั้งหมด": "Merge All Windows",
    "ย้ายแท็บไปหน้าต่างใหม่": "Move Tab to New Window",
    "ตรวจการสะกด": "Check Spelling",
    "การแทนที่ข้อความ": "Substitutions",
    "อัญประกาศอัจฉริยะ": "Smart Quotes",
    "ขีดอัจฉริยะ": "Smart Dashes",
    "แทนที่ข้อความ": "Text Replacement",

    "ไม่พบใบเสร็จสำหรับพิมพ์": "No receipt available to print",
    "โหลดรูปบนใบเสร็จไม่สำเร็จ กรุณาตรวจโลโก้ร้านแล้วลองใหม่":
      "Could not load receipt images. Check the shop logo and try again.",
    ข้อมูลใบงานครัวไม่ครบ: "Incomplete kitchen ticket data",
    ไม่ระบุสถานี: "No station",
    "<p>รอบ {v0}</p>": "<p>Round {v0}</p>",
    กำลังส่งใบงานไปเครื่องพิมพ์: "Sending kitchen ticket to printer",
    "ยังไม่ได้ตั้งค่าเครื่องพิมพ์สถานี {v0}":
      "No printer configured for station {v0}",
    "ผลการพิมพ์ครั้งก่อนไม่แน่ชัด กรุณาตรวจถาดก่อนกดพิมพ์ซ้ำ":
      "Previous print result is uncertain. Check the tray before reprinting.",
    "หน้าขายเปลี่ยนแล้ว กรุณาลองใหม่": "Register screen changed. Try again.",
    ส่งใบงานไม่สำเร็จ: "Could not send kitchen ticket",
    เครื่องพิมพ์ไม่ตอบกลับ: "Printer did not respond",
    พิมพ์ใบงานไม่สำเร็จ: "Could not print kitchen ticket",
    " · กรุณาตรวจถาดก่อนพิมพ์ซ้ำ": " · Check the tray before reprinting",
    "ยังติดต่อ Retail Local Server บนเครื่องนี้ไม่ได้ กรุณาเปิดตัวติดตั้ง Server + POS เพื่อตรวจสอบหรือซ่อมแซม หากติดตั้งเฉพาะ POS ให้ใช้ Server URL และลิงก์จับคู่จากผู้ดูแลร้าน":
      "Cannot reach Retail Local Server on this computer. Open the Server + POS installer to inspect or repair it. For POS-only installs, use the server URL and pairing link from your administrator.",
    "ไม่พบ Retail Local Server ที่ติดตั้งเสร็จแล้ว กรุณาติดตั้ง Server หรือเปลี่ยนไปใช้เซิร์ฟเวอร์อื่น":
      "No completed Retail Local Server installation found. Install the server or select another server.",
    "ไฟล์ควบคุม Retail Local Server ไม่ปลอดภัย กรุณาติดตั้ง Server ใหม่หรือติดต่อผู้ดูแลระบบ":
      "Retail Local Server control file is unsafe. Reinstall the server or contact an administrator.",
    "ข้อมูลการติดตั้ง Retail Local Server ไม่ถูกต้อง กรุณาติดตั้ง Server ใหม่หรือติดต่อผู้ดูแลระบบ":
      "Invalid Retail Local Server installation data. Reinstall the server or contact an administrator.",
    "พบ Retail Local Server แต่เริ่มบริการไม่สำเร็จ กรุณาลองใหม่ หากยังไม่สำเร็จให้เปิด BMS Retail Local เพื่อตรวจสอบระบบ":
      "Retail Local Server found, but startup failed. Retry, or open BMS Retail Local to inspect the system.",
    "ตรวจสอบเครื่องพิมพ์ไม่สำเร็จ กรุณาตรวจระบบพิมพ์แล้วลองใหม่":
      "Could not check printer. Check the printing system and retry.",
    "กำลังเปลี่ยนข้อมูลจับคู่ กรุณารอสักครู่แล้วลองใหม่":
      "Pairing is changing. Wait and retry.",
    "ลบข้อมูลจับคู่ไม่สำเร็จ ข้อมูลเดิมยังอยู่ กรุณาตรวจสิทธิ์เข้าถึงไฟล์ของบัญชีระบบปฏิบัติการแล้วลองใหม่":
      "Could not remove pairing. Existing data remains. Check file permissions for your OS account and retry.",
    "ย้ายแอปไปไว้ในโฟลเดอร์ Applications ก่อน":
      "Move the app into Applications first",
    "แอปกำลังเปิดจากไฟล์ติดตั้ง (DMG) ซึ่งจะหายไปหลังรีสตาร์ท ลาก BMS POS ไปไว้ใน Applications แล้วเปิดจากที่นั่น จากนั้นค่อยติ๊กตัวเลือกนี้":
      "The app is running from an installer DMG that disappears after restart. Drag BMS POS into Applications, open it there, then enable this option.",
    ตั้งให้เปิดอัตโนมัติไม่สำเร็จ: "Could not enable launch at login",
    ยกเลิกการเปิดอัตโนมัติไม่สำเร็จ: "Could not disable launch at login",
    "macOS อาจต้องให้อนุญาตเองที่ System Settings > General > Login Items":
      "macOS may require permission in System Settings > General > Login Items",
    "ระบบปฏิบัติการไม่ยอมบันทึกการตั้งค่านี้ กรุณาลองใหม่หรือตั้งค่าจากระบบปฏิบัติการโดยตรง":
      "The operating system could not save this setting. Retry or configure it directly in system settings.",
    "จอ {v0}": "Display {v0}",
    "BMS POS — ทดสอบจอลูกค้า": "BMS POS — Customer display preview",
    "BMS POS — จอลูกค้า": "BMS POS — Customer display",
    "BMS POS — ทดสอบจอเรียกคิว": "BMS POS — Queue display preview",
    "BMS POS — จอเรียกคิว": "BMS POS — Queue display",
    จอลูกค้า: "Customer display",
    "พบจอเพิ่มเติม ใช้เป็นจอลูกค้าหรือไม่?":
      "An additional display was found. Use it as a customer display?",
    "เมื่อเปิดใช้งาน ระบบจะเปิดจอลูกค้าให้อัตโนมัติทุกครั้งที่เปิด POS เปลี่ยนจอได้ในตั้งค่า":
      "The customer display will open automatically with POS. Change the display in settings.",
    เปิดจอลูกค้า: "Open customer display",
    ยังไม่ใช้: "Not now",
    จอแคชเชียร์: "Cashier display",
    จอที่เลือกได้: "Available display",
    "หน้าจอหยุดทำงาน กรุณาลองเปิดใหม่":
      "The screen stopped working. Try reopening it.",
    "พบ Retail Local Server ในเครื่องนี้ กำลังเริ่มบริการและตรวจสอบฐานข้อมูล กรุณารอสักครู่":
      "Retail Local Server found on this computer. Starting services and checking the database. Please wait.",
    "เชื่อมต่อหน้าขายไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตหรือเซิร์ฟเวอร์แล้วลองใหม่":
      "Cannot open the register. Check internet or server and retry.",
    "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจ URL อินเทอร์เน็ต และใบรับรอง HTTPS":
      "Cannot connect to server. Check URL, internet and HTTPS certificate.",
    ไม่มีสิทธิ์ตั้งค่าเครื่องพิมพ์: "Not authorized to configure printers",
    "กำลังใช้เครื่องพิมพ์ กรุณารอสักครู่": "Printer is busy. Please wait.",
    ขนาดกระดาษไม่ถูกต้อง: "Invalid paper size",
    ไม่พบเครื่องพิมพ์ที่เลือก: "Selected printer not found",
    บันทึกเครื่องพิมพ์ไม่สำเร็จ: "Could not save printer",
    "ตรวจสอบเครื่องพิมพ์ไม่สำเร็จ กรุณาตรวจสอบและพิมพ์ทดสอบอีกครั้ง":
      "Could not check printer. Check it and print another test.",
    ไม่มีสิทธิ์พิมพ์ใบเสร็จ: "Not authorized to print receipts",
    ไม่มีสิทธิ์พิมพ์ทดสอบ: "Not authorized to print tests",
    กรุณาพิมพ์ทดสอบก่อนยืนยัน: "Print a test before confirming",
    "กระดาษทดสอบไม่ออกหรือไม่ถูกต้อง ตรวจเครื่องและคิวพิมพ์ แล้วทดสอบใหม่":
      "Test page missing or incorrect. Check printer and print queue, then test again.",
    บันทึกผลทดสอบไม่สำเร็จ: "Could not save test result",
    ไม่มีสิทธิ์ตั้งค่าเครื่องพิมพ์ครัว:
      "Not authorized to configure kitchen printers",
    "กำลังบันทึกเครื่องพิมพ์ครัว กรุณารอสักครู่":
      "Saving kitchen printers. Please wait.",
    สถานีครัวซ้ำกัน: "Duplicate kitchen stations",
    บันทึกเครื่องพิมพ์ครัวไม่สำเร็จ: "Could not save kitchen printers",
    ไม่พบสถานีที่ตั้งค่าไว้: "Configured station not found",
    สถานีทดสอบ: "Test station",
    "ทดสอบภาษาไทย / Print test": "ทดสอบภาษาไทย / Print test",
    ไม่ใช่ออเดอร์จริง: "Not a real order",
    ไม่มีสิทธิ์พิมพ์ใบงานครัว: "Not authorized to print kitchen tickets",
    มีงานออร์เดอร์รอดำเนินการ: "Orders are awaiting action",
    หน้าต่างนี้ไม่มีสิทธิ์จับคู่เครื่อง:
      "This window is not authorized to pair a device",
    "กำลังตรวจการจับคู่ กรุณารอสักครู่": "Verifying pairing. Please wait.",
    "หน้าจอจับคู่เปลี่ยนแล้ว กรุณาลองใหม่":
      "Pairing screen changed. Try again.",
    บันทึกการจับคู่แบบเข้ารหัสไม่สำเร็จ: "Could not save encrypted pairing",
    หน้าต่างนี้ไม่มีสิทธิ์เปิดระบบหลังบ้าน:
      "This window is not authorized to open the back office",
    "เปิดระบบหลังบ้านบนเครื่องนี้ไม่สำเร็จ กรุณาตรวจสอบการติดตั้ง Retail Local Server":
      "Cannot open the local back office. Check the Retail Local Server installation.",
    หน้าต่างนี้ไม่มีสิทธิ์ตั้งค่าจอลูกค้า:
      "This window is not authorized to configure the customer display",
    "กำลังบันทึกการตั้งค่าจอ กรุณารอสักครู่":
      "Saving display settings. Please wait.",
    รูปแบบการตั้งค่าจอลูกค้าไม่ถูกต้อง: "Invalid customer display mode",
    "จอนี้กำลังใช้เป็นจอเรียกคิว กรุณาเลือกคนละจอ":
      "This display is used for queues. Select another display.",
    "ไม่พบจอที่เลือก กรุณาตรวจสายจอแล้วลองใหม่":
      "Selected display not found. Check the cable and retry.",
    "จอหลักกำลังใช้เป็นจอแคชเชียร์ กรุณาเลือกจออื่น":
      "The main display is used by the cashier. Select another display.",
    บันทึกการตั้งค่าจอลูกค้าไม่สำเร็จ:
      "Could not save customer display settings",
    หน้าต่างนี้ไม่มีสิทธิ์เปิดตัวอย่างจอลูกค้า:
      "This window is not authorized to preview the customer display",
    "จอลูกค้าจริงกำลังเปิดอยู่แล้ว กรุณาใช้จอนั้นหรือปิดการตั้งค่าจอก่อน":
      "The real customer display is already open. Use it or disable it first.",
    เปิดหน้าต่างทดสอบจอลูกค้าไม่สำเร็จ:
      "Could not open customer display preview",
    หน้าต่างนี้ไม่มีสิทธิ์ปิดตัวอย่างจอลูกค้า:
      "This window is not authorized to close the customer display preview",
    หน้าต่างนี้ไม่มีสิทธิ์ตั้งค่าจอภายนอก:
      "This window is not authorized to configure external displays",
    ประเภทจอภายนอกไม่ถูกต้อง: "Invalid external display role",
    รูปแบบการตั้งค่าจอภายนอกไม่ถูกต้อง: "Invalid external display mode",
    บันทึกการตั้งค่าจอภายนอกไม่สำเร็จ:
      "Could not save external display settings",
    หน้าต่างนี้ไม่มีสิทธิ์ตั้งค่าจอเรียกคิว:
      "This window is not authorized to configure the queue display",
    รูปแบบการตั้งค่าจอเรียกคิวไม่ถูกต้อง: "Invalid queue display mode",
    จอแคชเชียร์ใช้เป็นจอเรียกคิวไม่ได้:
      "Cashier display cannot be used for queues",
    "จอนี้กำลังใช้เป็นจอลูกค้า กรุณาเลือกคนละจอ":
      "This display is used by customers. Select another display.",
    บันทึกการตั้งค่าจอเรียกคิวไม่สำเร็จ:
      "Could not save queue display settings",
    หน้าต่างนี้ไม่มีสิทธิ์เปิดตัวอย่างจอเรียกคิว:
      "This window is not authorized to preview the queue display",
    "จอเรียกคิวจริงกำลังเปิดอยู่แล้ว กรุณาใช้จอนั้นหรือปิดการตั้งค่าจอก่อน":
      "The real queue display is already open. Use it or disable it first.",
    เปิดหน้าต่างทดสอบจอเรียกคิวไม่สำเร็จ:
      "Could not open queue display preview",
    หน้าต่างนี้ไม่มีสิทธิ์ปิดตัวอย่างจอเรียกคิว:
      "This window is not authorized to close the queue display preview",
    "Server ไม่รับ Device Token (HTTP 401) กรุณาให้ผู้ดูแลตรวจ URL สถานะเครื่อง และการออก token ใหม่ให้เครื่องเดิมก่อนจับคู่เครื่องใหม่":
      "Server rejected device token (HTTP 401). Ask an administrator to check the URL, device status and token reissue for this device before pairing another device.",
    "เครื่องนี้ไม่มีสิทธิ์เข้าใช้งาน Server (HTTP 403) กรุณาติดต่อผู้ดูแลร้านเพื่อตรวจสิทธิ์":
      "This device cannot access the server (HTTP 403). Ask your administrator to check permissions.",
    "Server ยังไม่พร้อมใช้งาน (HTTP {v0}) กรุณาลองใหม่หรือตรวจสอบสถานะ Server":
      "Server unavailable (HTTP {v0}). Retry or check server status.",
    "ส่งคำขอถี่เกินไป (HTTP 429) รอสักครู่แล้วลองตรวจการเชื่อมต่อใหม่ ไม่ต้องเปลี่ยน Server หรือออก token ใหม่":
      "Too many requests (HTTP 429). Wait and retry the connection check. Do not change server or reissue a token.",
    "การตรวจเครื่องหมดเวลารอ (HTTP 408) ตรวจเครือข่ายและสถานะ Server แล้วลองใหม่ ข้อมูลจับคู่เดิมยังอยู่":
      "Device verification timed out (HTTP 408). Check network and server, then retry. Existing pairing remains.",
    "Server ไม่รองรับการเชื่อมต่อ BMS POS (HTTP {v0}) กรุณาตรวจสอบ URL หรือเปลี่ยน Server":
      "Server does not support BMS POS (HTTP {v0}). Check the URL or change server.",
    "Server ตอบกลับไม่ถูกต้อง กรุณาตรวจสอบ URL หรือเปลี่ยน Server":
      "Invalid server response. Check the URL or change server.",
    "เซิร์ฟเวอร์ไม่ตอบภายในเวลาที่กำหนด กรุณาตรวจเครือข่ายหรือเซิร์ฟเวอร์แล้วลองใหม่":
      "Server response timed out. Check network or server and retry.",
    "เซิร์ฟเวอร์ตอบข้อมูลที่ไม่ใช่ BMS POS กรุณาตรวจ URL และการเชื่อมต่อ":
      "Server returned non-BMS POS data. Check URL and connection.",
    "เซิร์ฟเวอร์ไม่ส่งข้อมูลเครื่อง BMS POS กรุณาตรวจ URL แล้วลองใหม่":
      "Server returned no BMS POS device data. Check URL and retry.",
    "พบข้อมูลจับคู่เดิม แต่ยังอ่านหรือถอดรหัสไม่ได้ ไม่ได้แปลว่า token หมดอายุ กรุณาปลดล็อกที่เก็บข้อมูลของระบบและใช้บัญชีระบบปฏิบัติการเดิม แล้วกดลองใหม่ ข้อมูลจับคู่เดิมยังไม่ถูกลบ":
      "Existing pairing could not be read or decrypted. This does not mean the token expired. Unlock secure storage using the original OS account, then retry. Existing pairing has not been deleted.",
    "กรุณาวางลิงก์จับคู่หรือ token ของเครื่องขาย":
      "Paste a pairing link or POS device token",
    ลิงก์จับคู่ไม่ถูกต้อง: "Invalid pairing link",
    "ลิงก์นี้ไม่มี token กรุณาคัดลอกลิงก์จับคู่จากหน้าจัดการเครื่อง POS":
      "This link has no token. Copy the pairing link from POS device management.",
    "ลิงก์ bmspos ไม่ถูกต้อง": "Invalid bmspos link",
    "token ไม่ถูกต้อง ต้องขึ้นต้นด้วย pos_ และคัดลอกมาให้ครบ":
      "Invalid token. It must start with pos_ and be copied in full.",
    "Server URL ไม่ถูกต้อง ระบบจริงต้องใช้ HTTPS":
      "Invalid server URL. Production requires HTTPS.",
    "ไม่พบเครื่องพิมพ์ที่บันทึกไว้ ตรวจสายและเปิดเครื่องพิมพ์":
      "Saved printer not found. Check cable and power.",
    "ระบบไม่รายงานสถานะเครื่องพิมพ์ กรุณาพิมพ์ทดสอบ":
      "System does not report printer status. Print a test.",
    "เครื่องพิมพ์ออฟไลน์ ตรวจสายหรือเครือข่ายและเปิดเครื่องพิมพ์":
      "Printer offline. Check cable or network and turn it on.",
    "กระดาษหมด กรุณาเติมกระดาษ": "Out of paper. Refill paper.",
    "กระดาษติด กรุณานำกระดาษที่ติดออก": "Paper jam. Remove jammed paper.",
    "ฝาเครื่องพิมพ์เปิดอยู่ กรุณาปิดฝา": "Printer cover open. Close the cover.",
    "คิวพิมพ์ถูกพัก กรุณาเปิดคิวพิมพ์ในระบบปฏิบัติการ":
      "Print queue paused. Resume it in the operating system.",
    "เครื่องพิมพ์รายงานปัญหา กรุณาตรวจเครื่องและคิวพิมพ์":
      "Printer reports a problem. Check printer and print queue.",
    ระบบไม่พบปัญหาเครื่องพิมพ์: "No printer problems reported",
    "เครื่องพิมพ์ไม่รับงาน กรุณาตรวจคิวพิมพ์":
      "Printer is not accepting jobs. Check the print queue.",
    "เครื่องพิมพ์หยุดทำงานหรือมีข้อผิดพลาด กรุณาตรวจเครื่องและคิวพิมพ์":
      "Printer stopped or has an error. Check printer and print queue.",
    ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จ: "Receipt printer not configured",
    "ส่งหน้าทดสอบเข้าคิวแล้ว กรุณายืนยันผลจากกระดาษ":
      "Test page queued. Confirm the printed result.",
    "ยืนยันผลทดสอบแล้ว (ไดรเวอร์ไม่รายงานสถานะสด)":
      "Test confirmed (driver provides no live status)",
    "กรุณาเลือกเครื่องพิมพ์ที่ ตั้งค่า > เครื่องพิมพ์ใบเสร็จ":
      "Select a printer in Settings > Receipt printer",
    "ไม่พบเครื่องพิมพ์ที่บันทึกไว้ กรุณาตรวจการเชื่อมต่อหรือตั้งค่าเครื่องพิมพ์ใหม่":
      "Saved printer not found. Check connection or configure another printer.",
    ไม่สามารถจัดหน้าใบเสร็จได้: "Cannot lay out receipt",
    "กำลังส่งใบเสร็จไปเครื่องพิมพ์ กรุณารอสักครู่":
      "Sending receipt to printer. Please wait.",
    "หน้าขายเปลี่ยนแล้ว กรุณาเปิดใบเสร็จและลองใหม่":
      "Register changed. Open the receipt and retry.",
    ใบเสร็จมีขนาดใหญ่เกินไป: "Receipt is too large",
    "ส่งใบเสร็จไม่สำเร็จ กรุณาตรวจเครื่องพิมพ์และคิวพิมพ์":
      "Could not send receipt. Check printer and print queue.",
    "เครื่องพิมพ์ไม่ตอบกลับ กรุณาตรวจคิวพิมพ์ก่อนพิมพ์ซ้ำ":
      "Printer did not respond. Check the print queue before reprinting.",
    พิมพ์ใบเสร็จไม่สำเร็จ: "Could not print receipt",
    "macOS Keychain ไม่พร้อมเข้ารหัสข้อมูลเครื่อง POS กรุณาปลดล็อก Keychain แล้วลองใหม่":
      "macOS Keychain cannot encrypt POS data. Unlock Keychain and retry.",
    "Linux Keyring ไม่พร้อมเข้ารหัสข้อมูลเครื่อง POS กรุณาติดตั้งและปลดล็อก Secret Service หรือ KWallet แล้วลองใหม่":
      "Linux Keyring cannot encrypt POS data. Install and unlock Secret Service or KWallet, then retry.",
    "Windows ไม่พร้อมเข้ารหัสข้อมูลเครื่อง POS กรุณาล็อกอิน Windows แล้วลองใหม่":
      "Windows cannot encrypt POS data. Sign in to Windows and retry.",
    "ระบบปฏิบัติการไม่พร้อมเข้ารหัสข้อมูลเครื่อง POS":
      "Operating system cannot encrypt POS data",
    "Linux เครื่องนี้ไม่มี Keyring ที่ปลอดภัยสำหรับ Device Token กรุณาเปิด GNOME Keyring/Secret Service หรือ KWallet แล้วเปิดแอปใหม่":
      "This Linux device has no secure keyring for the device token. Enable GNOME Keyring/Secret Service or KWallet and reopen the app.",
    "token ถูกเข้ารหัสด้วย macOS Keychain ของเครื่องนี้":
      "Token encrypted using this Mac's Keychain",
    "token ถูกเข้ารหัสด้วย Linux Keyring ของบัญชีนี้":
      "Token encrypted using this account's Linux Keyring",
    "token ถูกเข้ารหัสด้วยบัญชี Windows ของเครื่องนี้":
      "Token encrypted using this Windows account",
    เปิดระบบหลังบ้าน: "Open back office",
    เปิดแอปอัตโนมัติเมื่อเปิดเครื่อง: "Launch app at login",
    รีเฟรชข้อมูลหน้าปัจจุบัน: "Refresh current screen data",
    "โหลดแอปใหม่ทั้งหมด (เมื่อหน้าค้าง)": "Reload entire app (if frozen)",
    เชื่อมต่อไม่สำเร็จ: "Connection failed",
    "แอปไม่สามารถตรวจสอบการจับคู่ได้ กรุณาปิดแล้วเปิดใหม่":
      "App could not verify pairing. Close and reopen it.",
    สร้างจากระบบหลังบ้านบนเครื่องนี้: "Create from local back office",
    "สร้างจากระบบหลังบ้าน BMS": "Create from BMS back office",
    เปิดระบบหลังบ้านไม่สำเร็จ: "Could not open back office",
    "แอปไม่สามารถเปิดระบบหลังบ้านได้ กรุณาปิดแล้วเปิดใหม่":
      "App could not open back office. Close and reopen it.",
    "ระบบปฏิบัติการไม่มีที่เก็บ Device Token ที่ปลอดภัย":
      "Operating system has no secure device token storage",
    "อ่านข้อมูลแอปไม่สำเร็จ กรุณาปิดแล้วเปิด BMS POS ใหม่":
      "Could not read app information. Close and reopen BMS POS.",
    "กำลังเริ่ม Retail Local Server": "Starting Retail Local Server",
    "พบ Server ในเครื่องนี้ กำลังเริ่มบริการ กรุณารอสักครู่":
      "Server found on this computer. Starting services. Please wait.",
    ยังอ่านข้อมูลจับคู่เดิมไม่ได้: "Cannot read existing pairing yet",
    กรุณาตรวจอินเทอร์เน็ตหรือเซิร์ฟเวอร์แล้วลองใหม่:
      "Check internet or server and retry",
    "กำลังลองใหม่…": "Retrying…",
    "ลองเชื่อมต่อใหม่ไม่สำเร็จ กรุณาลองอีกครั้ง":
      "Reconnect failed. Try again.",
    ลองใหม่: "Retry",
    "เปลี่ยนเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่":
      "Could not change server. Try again.",
    "ตั้งค่า BMS POS": "Set up BMS POS",
    ตั้งค่าครั้งแรก: "First-time setup",
    เครื่องขายที่ปลอดภัย: "Secure point of sale",
    บนทุกระบบปฏิบัติการ: "On every operating system",
    "เชื่อมต่อกับระบบร้านเดิม โดยราคา สต็อก สิทธิ์ และการชำระเงินยังตรวจจากเซิร์ฟเวอร์ทุกครั้ง":
      "Connect to your shop. Prices, stock, permissions and payments are verified by the server every time.",
    เลือกเซิร์ฟเวอร์: "Select server",
    จับคู่เครื่องกับร้าน: "Pair device with shop",
    "ใส่ PIN": "Enter PIN",
    ยืนยันตัวพนักงาน: "Verify operator",
    เริ่มขาย: "Start selling",
    เปิดกะและรับชำระ: "Open shift and accept payment",
    "ขั้นตอนที่ 1 จาก 3": "Step 1 of 3",
    เชื่อมต่อเครื่องแคชเชียร์: "Connect your register",
    "คัดลอกลิงก์จับคู่จากหน้า “เครื่อง POS” ในระบบหลังบ้าน แล้ววางด้านล่าง":
      "Copy the pairing link from POS devices in the back office and paste it below.",
    เว้นว่างได้เมื่อวางลิงก์จับคู่แบบเต็ม:
      "Optional when pasting a complete pairing link",
    "ลิงก์จับคู่ หรือ Device Token": "Pairing link or device token",
    "ยังไม่มีลิงก์?": "Need a link?",
    สร้างจากระบบหลังบ้าน: "Create in back office",
    "กำลังเปิด...": "Opening…",
    ปิดการแจ้งเตือน: "Dismiss notification",
    ปิด: "Close",
    ตรวจสอบและเชื่อมต่อ: "Verify and connect",
    "กำลังตรวจสอบ...": "Verifying…",
    "token ถูกเข้ารหัสด้วยที่เก็บข้อมูลปลอดภัยของระบบปฏิบัติการ":
      "Token encrypted with operating system secure storage",
    "กำลังเปิด BMS POS": "Opening BMS POS",
    กำลังเชื่อมต่อเครื่องขาย: "Connecting register",
    "กำลังตรวจสอบเซิร์ฟเวอร์และเตรียมหน้าขาย กรุณารอสักครู่":
      "Checking server and preparing the register. Please wait.",
    เปิดหน้าขายไม่สำเร็จ: "Could not open register",
    ยังเชื่อมต่อเซิร์ฟเวอร์ไม่ได้: "Cannot connect to server yet",
    เปลี่ยนเซิร์ฟเวอร์: "Change server",
    "ยังไม่มีการขาย การชำระเงิน หรือการเปลี่ยนสต็อกในขั้นตอนนี้":
      "No sales, payments or stock changes occur at this step.",
  };
  let language = "th";
  const getAppLanguage = () => language;
  function applyAppLanguage(value) {
    language = value === "en" ? "en" : "th";
  }
  function posText(source, values) {
    const text =
      language === "en" && Object.prototype.hasOwnProperty.call(english, source)
        ? english[source]
        : source;
    return values
      ? text.replace(/\{(\w+)\}/g, (match, key) =>
          Object.prototype.hasOwnProperty.call(values, key)
            ? String(values[key])
            : match
        )
      : text;
  }

  // Startup receives already-rendered shell errors. Resolve only exact local catalog messages;
  // unknown diagnostics remain verbatim, and this is never used for server or customer data.
  function shellMessage(message) {
    const source = Object.hasOwn(english, message)
      ? message
      : Object.keys(english).find((key) => english[key] === message);
    return source ? posText(source) : message;
  }

  const api = { english, getAppLanguage, applyAppLanguage, posText, shellMessage };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.bmsPosLocale = api;
})();
