ได้ครับ รันจากโฟลเดอร์นี้ก่อน:

```bash
cd /Users/s0mkidd/Desktop/Projects/bms/apps/mobile
```

iPad:

```bash
npm run ios -- --simulator "iPad Air 13-inch (M3)" --port 8082
```

iPhone:

```bash
npm run ios -- --simulator "iPhone 17" --port 8082
```

ถ้า Metro ยังไม่รัน ให้เปิดอีก terminal แล้วรัน:

```bash
cd /Users/s0mkidd/Desktop/Projects/bms/apps/mobile
npm start -- --port 8082
```