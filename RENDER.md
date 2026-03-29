# Render Quickstart

ไฟล์ `render.yaml` ถูกเพิ่มไว้แล้วเพื่อให้ Render สร้าง Web Service จาก repo นี้ได้ตรงๆ

## แบบเร็วที่สุด

1. push โปรเจ็กต์นี้ขึ้น GitHub
2. ไปที่ Render Dashboard
3. กด `New +`
4. เลือก `Blueprint`
5. เลือก repo นี้
6. ตอน Render อ่าน `render.yaml` แล้ว ให้กรอก `OPENAI_API_KEY`
7. กดสร้าง service

## ถ้ายังไม่มี GitHub repo

ตอนนี้โฟลเดอร์นี้ถูก `git init` ให้แล้ว และ `.env` ยังถูก ignore อยู่

คำสั่งพื้นฐานที่ต้องใช้ต่อมีประมาณนี้:

```bash
git add .
git commit -m "Prepare Render deployment"
git remote add origin <your-github-repo-url>
git push -u origin main
```

ถ้าจะสร้าง repo ใหม่บน GitHub ผ่านหน้าเว็บ:

1. สร้าง empty repository
2. คัดลอก URL ของ repo
3. เอา URL นั้นมาแทน `<your-github-repo-url>`

ค่าที่ตั้งไว้ใน `render.yaml` แล้ว:

- runtime: Node
- plan: Free
- build command: `npm ci`
- start command: `npm start`
- health check: `/healthz`
- board AI provider: `openai`
- preview environments: ปิดไว้

## หลัง deploy แล้วให้เช็ก

เปิด:

```text
https://<your-service>.onrender.com/healthz
```

ควรได้ JSON ที่มี `ok: true`

แล้วเปิด:

```text
https://<your-service>.onrender.com/api/config
```

ถ้า `chatApiEnabled: true` และ `boardAiApiEnabled: true` แปลว่าฝั่ง OpenAI พร้อมแล้ว

## ค่าที่ควรใช้บน Render

อย่างต่ำต้องมี secret นี้:

```text
OPENAI_API_KEY
```

ค่าที่เหลือถูกใส่ไว้ใน `render.yaml` แล้ว:

```text
BOARD_AI_PROVIDER=openai
OPENAI_MODEL=gpt-5.4-mini
OPENAI_MOVE_MODEL=gpt-5.4-mini
NODE_VERSION=22.22.0
```

## ทำไมยังไม่ตั้ง KataGo บน Render

ตอนนี้ในโปรเจ็กต์มี KataGo binary แบบ Windows เป็นหลัก และ Render Free เหมาะกับ OpenAI-only มากกว่า

ถ้าจะใช้ KataGo จริงบน Render ภายหลัง ต้องเตรียมใหม่ทั้งหมด:

- ใช้ Linux KataGo binary
- อัปโหลด model และ config ให้พร้อมบนเครื่องรันจริง
- เปลี่ยน path ของ `KATAGO_PATH`, `KATAGO_MODEL`, `KATAGO_CONFIG`

## ข้อจำกัดที่ควรรู้

- Render Free จะ sleep เมื่อไม่มี traffic ช่วงหนึ่ง แล้วรอ spin up ตอนมีคนเข้าใหม่
- ดังนั้นรอบแรกที่เปิดเว็บหลัง idle อาจช้ากว่าปกติ

ถ้าคุณอยาก ผมทำต่อได้อีกขั้นเป็น checklist ตามหน้า Render จริงทีละขั้น หรือช่วยเตรียมข้อความสำหรับใส่ใน repo ก่อน push ขึ้น GitHub ให้ครับ
