# Go Sensei Lab

ต้นแบบเกมหมากล้อม 9x9 ที่เล่นกับ AI ได้ โดยใช้ local fallback ใน browser และสามารถต่อ KataGo ได้ถ้ามีการตั้งค่า engine ฝั่ง server

## โหมดที่รองรับ

- `Local fallback`
  - กระดานเล่นกับ AI heuristic ในหน้าเว็บ
  - ช่องแชทยังตอบได้จาก logic ภายในโปรเจกต์
- `KataGo board AI`
  - ฝั่ง server จะเรียก KataGo analysis engine เพื่อหาตาเดินบนกระดาน
  - ถ้า KataGo ยังไม่พร้อม ระบบจะถอยกลับไปใช้ local fallback อัตโนมัติ

## วิธีเริ่มใช้งาน

1. ติดตั้ง dependency

```bash
npm install
```

2. สร้างไฟล์ `.env` จาก `.env.example`

```bash
copy .env.example .env
```

3. ถ้าจะใช้ KataGo ให้ตั้งค่า path ที่เกี่ยวข้องใน `.env`

```env
BOARD_AI_PROVIDER=auto
BOARD_RULES=chinese
BOARD_KOMI=5.5
KATAGO_PATH=tools\katago\engine\katago.exe
KATAGO_MODEL=tools\katago\models\kata1-zhizi-b28c512nbt-muonfd2.bin.gz
KATAGO_CONFIG=tools\katago\config\analysis_example.cfg
PORT=3000
```

4. รันเซิร์ฟเวอร์

```bash
npm start
```

5. เปิดเบราว์เซอร์ที่

```text
http://localhost:3000
```

## ไฟล์สำคัญ

- `server.js` เสิร์ฟหน้าเว็บและประสานงานกับ KataGo เมื่อมีการตั้งค่าไว้
- `app.js` logic เกม, AI บนกระดาน, และ client chat
- `index.html` หน้า UI หลัก
- `styles.css` สไตล์หน้าเกมและ sidebar

## หมายเหตุ

- ถ้ายังไม่ตั้ง KataGo โปรเจกต์จะยังเปิดได้ และทั้งกระดานกับแชทจะ fallback เป็น logic ภายในหน้าเว็บ
- ถ้ามี KataGo และตั้งค่า path ครบ ระบบจะใช้ KataGo สำหรับ AI บนกระดาน

## KataGo Analysis Engine

The board AI can run through KataGo Analysis Engine when it is configured on the server.

Recommended setup:

1. Download a KataGo release binary from the official releases page:
   `https://github.com/lightvector/KataGo/releases`
2. Download a KataGo network model from:
   `https://katagotraining.org/`
3. Use an analysis config file from the KataGo package, or the example config from:
   `https://github.com/lightvector/KataGo/blob/master/cpp/configs/analysis_example.cfg`
4. Set these values in `.env`:

```env
BOARD_AI_PROVIDER=katago
BOARD_RULES=chinese
BOARD_KOMI=5.5
KATAGO_PATH=C:\tools\katago\katago.exe
KATAGO_MODEL=C:\tools\katago\model.bin.gz
KATAGO_CONFIG=C:\tools\katago\analysis_example.cfg
KATAGO_MAX_VISITS=300
KATAGO_TIMEOUT_MS=12000
```

Provider behavior:

- `BOARD_AI_PROVIDER=katago`
  - force board AI to use KataGo only
- `BOARD_AI_PROVIDER=auto`
  - prefer KataGo when available, otherwise fall back to the local browser engine

Notes:

- Chat and board AI are now independent. You can use KataGo for moves while keeping chat on local fallback.
- The client now sends full move history to the server, so KataGo can analyze from the actual game sequence instead of only the visible stones.
- If KataGo is configured but unavailable at runtime, the app will keep running and the board AI will fall back according to `BOARD_AI_PROVIDER`.
