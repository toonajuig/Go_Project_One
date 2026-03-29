# Deploy Guide

โปรเจ็กต์นี้ต้อง deploy แบบ `มี backend` เพราะหน้าเว็บเรียก `./api/config`, `./api/chat`, และ `./api/move` จาก `server.js`

ถ้าเอาไปวางบน static hosting อย่างเดียว:

- หน้าเกมจะยังเปิดได้
- local fallback บางส่วนยังทำงานได้ใน browser
- แต่ KataGo ฝั่ง server จะไม่ทำงาน

## ทางที่แนะนำ

เริ่มจาก `Local fallback` ก่อน หรือถ้าจะใช้ KataGo ให้เตรียมไฟล์ engine/model/config ให้พร้อมบนเครื่อง deploy

ค่าขั้นต่ำที่ควรตั้งใน environment เมื่อต้องการ KataGo:

```env
BOARD_AI_PROVIDER=auto
BOARD_RULES=chinese
BOARD_KOMI=5.5
KATAGO_PATH=/app/tools/katago/engine/katago
KATAGO_MODEL=/app/tools/katago/models/model.bin.gz
KATAGO_CONFIG=/app/tools/katago/config/analysis_example.cfg
PORT=3000
```

## วิธีที่ 1: Deploy เป็น Node service

ใช้ได้กับ Railway, Render, Fly.io, VPS, หรือเครื่อง Linux ที่รัน Node ได้

### ตั้งค่า

1. ใช้ Node 20 ขึ้นไป
2. อัปโหลด source code ทั้งโปรเจ็กต์
3. ตั้ง install command เป็น:

```bash
npm ci
```

4. ตั้ง start command เป็น:

```bash
npm start
```

5. ตั้ง environment variables ตามตัวอย่างด้านบน

### ตรวจว่า deploy สำเร็จ

เปิด endpoint นี้หลัง deploy:

```text
/healthz
```

ควรได้ JSON กลับมาประมาณนี้:

```json
{
  "ok": true,
  "service": "go-sensei-lab"
}
```

และเปิด:

```text
/api/config
```

ถ้า `boardAiApiEnabled` เป็น `true` แปลว่า KataGo ฝั่ง server พร้อมแล้ว

## วิธีที่ 2: Deploy ด้วย Docker

มี `Dockerfile` ให้แล้วสำหรับ deploy แบบทั่วไป และสามารถใช้กับ KataGo ได้ถ้าไฟล์ที่เกี่ยวข้องถูกเตรียมไว้ครบ

### Build image

```bash
docker build -t go-sensei-lab .
```

### Run container

```bash
docker run --rm -p 3000:3000 --env-file .env go-sensei-lab
```

## ถ้าอยากใช้ KataGo บนเว็บด้วย

ทำได้ แต่ต้องเป็นโฮสต์ที่รัน native process ได้จริง เช่น VPS, Docker on VM, หรือ Node host ที่อนุญาตให้รัน binary ภายนอก

ข้อสำคัญ:

- binary `tools/katago/engine/katago.exe` ในโปรเจ็กต์นี้เป็นของ Windows
- ถ้า deploy ไป Linux ต้องเปลี่ยนเป็น KataGo binary ของ Linux
- model และ config ต้องอยู่บนเครื่อง deploy จริง และ path ต้องเป็น path ของเครื่องนั้น

ตัวอย่าง env สำหรับ Linux:

```env
BOARD_AI_PROVIDER=auto
BOARD_RULES=chinese
BOARD_KOMI=5.5
KATAGO_PATH=/app/tools/katago/engine/katago
KATAGO_MODEL=/app/tools/katago/models/model.bin.gz
KATAGO_CONFIG=/app/tools/katago/config/analysis_example.cfg
KATAGO_MAX_VISITS=300
KATAGO_TIMEOUT_MS=12000
PORT=3000
```

หมายเหตุ:

- `BOARD_AI_PROVIDER=katago` จะบังคับใช้ KataGo เท่านั้น
- `BOARD_AI_PROVIDER=auto` จะพยายามใช้ KataGo ก่อน แล้ว fallback ไป local engine ถ้า KataGo ใช้ไม่ได้
- Docker setup ที่เพิ่มให้ตอนนี้จะไม่ copy engine/model ของ KataGo เข้า image โดยอัตโนมัติ

ถ้าจะใช้ KataGo ใน Docker จริง:

1. เอา Linux KataGo binary และ model มาใส่ใน path ที่ถูกต้อง
2. ปรับ `.dockerignore` ให้ไม่ตัดไฟล์ KataGo ที่ต้องใช้
3. build image ใหม่

## โครงแบบ deploy ที่ควรใช้

โครงแบบที่แนะนำ:

- browser เปิดเว็บจาก service นี้โดยตรง
- service เดียวกันเสิร์ฟ `index.html`, `app.js`, `styles.css`
- service เดียวกันรับ `/api/chat` และ `/api/move`
- ถ้าจะใช้ KataGo ให้เก็บไฟล์และ path ของ KataGo ไว้ฝั่ง server เท่านั้น

ไม่แนะนำ:

- เอา frontend ไปไว้ static host แล้วแยก backend ทีหลังโดยยังไม่เพิ่ม CORS หรือ reverse proxy
- เอา binary/model ของ KataGo แบบ Windows ไปใช้บน Linux ตรง ๆ

## เช็กลิสต์ก่อนขึ้น production

- ถ้าจะใช้ KataGo บน Linux ได้เปลี่ยน path จาก Windows เป็น Linux แล้ว
- เปิด `/healthz` แล้วได้ `ok: true`
- เปิดหน้าเว็บจริงแล้วกดให้ AI เดินหมากได้
