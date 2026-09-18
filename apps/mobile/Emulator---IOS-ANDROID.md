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


ANDROID
จากภาพ `8081` และ `8082` มี process รันอยู่แล้ว จึงขึ้น `EADDRINUSE` ครับ

ใช้ 2 Terminal แบบนี้:

Terminal 1 — Metro

```bash
cd /Users/s0mkidd/Desktop/Projects/bms/apps/mobile

# ปิด Metro เก่าที่พอร์ต 8082
lsof -tiTCP:8082 -sTCP:LISTEN | xargs kill

# เปิด Metro ใหม่
npm start -- --port 8082
```

Terminal 2 — Build และเปิดแอป

```bash
cd /Users/s0mkidd/Desktop/Projects/bms/apps/mobile/android

# ให้ origin เดียวในแอปวิ่งผ่าน local Caddy: HTTP ไป web และ /graphql ไป WS
adb reverse tcp:3000 tcp:3001

./gradlew app:installDebug -PreactNativeDevServerPort=8082

adb shell am force-stop com.bms.pos
adb shell am start -n com.bms.pos/.MainActivity
```

ถ้ายังไม่ได้เปิด emulator:

```bash
ANDROID_SDK_ROOT=/Users/s0mkidd/Library/Android/sdk \
/Users/s0mkidd/Library/Android/sdk/emulator/emulator \
-avd Pixel_6a -no-snapshot-save
```

สำคัญ: อย่าใช้ Metro พอร์ต `8081` เพราะ Docker ของโปรเจกต์ใช้อยู่แล้ว ให้ใช้ `8082` และต้องใส่ `-PreactNativeDevServerPort=8082` ตอน build ด้วยครับ


ANDROID Emulator

ก่อนจับคู่ ต้องเปิด dev stack ที่มี Caddy และตั้ง tunnel นี้ก่อน:

```bash
cd /Users/s0mkidd/Desktop/Projects/bms
docker compose --env-file .env.dev -f docker-compose.yml -f docker-compose.dev.yml up -d caddy
adb reverse tcp:3000 tcp:3001
```

จากนั้นใช้:

```text
Server: http://localhost:3000
Token: วางเฉพาะค่า pos_...
```

ห้าม reverse `tcp:3000` ไปที่ host `tcp:3000` โดยตรง เพราะ Next.js รับ GraphQL HTTP ได้
แต่ไม่ส่ง WebSocket `/graphql` ไป `apps/ws` ทำให้แอปขึ้น “ข้อมูลสดขัดข้อง”
