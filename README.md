# Go Sensei Lab

ต้นแบบเกมหมากล้อม 9x9 ที่เล่นกับ AI บนกระดานได้ และมี sidebar chat ที่ต่อ OpenAI API จริงได้เมื่อมี `OPENAI_API_KEY`

## Deploy on Render

ถ้าจะเอาขึ้นเว็บแบบง่ายสุด ให้ใช้ Render แบบ `OpenAI-only` ก่อน

- มีไฟล์ [render.yaml](./render.yaml) ให้ Render อ่านค่าได้ตรงๆ
- มีคู่มือสั้นที่ [RENDER.md](./RENDER.md)
- มีคู่มือรวมการ deploy ที่ [DEPLOY.md](./DEPLOY.md)

ค่าที่ต้องกรอกบน Render เพิ่มเองมีหลักๆ แค่ `OPENAI_API_KEY`

## โหมดที่รองรับ

- `Local fallback`
  - กระดานเล่นกับ AI heuristic ในหน้าเว็บ
  - ช่องแชทยังตอบได้จาก logic ภายในโปรเจกต์
- `Live API chat`
  - ช่องแชทจะวิ่งผ่าน backend ไปหา OpenAI Responses API
  - API key ถูกเก็บไว้ฝั่ง server ไม่ถูกฝังใน browser

## วิธีเริ่มใช้งาน

1. ติดตั้ง dependency

```bash
npm install
```

2. สร้างไฟล์ `.env` จาก `.env.example`

```bash
copy .env.example .env
```

3. ใส่ค่า `OPENAI_API_KEY` ของคุณใน `.env`

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.4-mini
OPENAI_MOVE_MODEL=gpt-5.4-mini
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

- `server.js` เสิร์ฟหน้าเว็บและ proxy แชทไป OpenAI API
- `server.js` เสิร์ฟหน้าเว็บ, proxy แชทไป OpenAI API, และขอ “ตาเดินถัดไป” สำหรับ AI บนกระดาน
- `app.js` logic เกม, AI บนกระดาน, และ client chat
- `index.html` หน้า UI หลัก
- `styles.css` สไตล์หน้าเกมและ sidebar

## หมายเหตุ

- ถ้ายังไม่ตั้ง `OPENAI_API_KEY` โปรเจกต์จะยังเปิดได้ และช่องแชทจะ fallback เป็น AI local อัตโนมัติ
- ถ้ามี `OPENAI_API_KEY` แล้ว ตอนนี้ทั้ง `Sensei Chat` และ `AI คู่แข่งบนกระดาน` จะใช้ OpenAI API ได้
- ถ้าอยากให้โมเดลเดินหมากแยกจากโมเดลแชท ให้ตั้ง `OPENAI_MOVE_MODEL`
- ถ้า Live API ใช้งานไม่ได้ระหว่างเกม ระบบจะ fallback กลับมาใช้ local engine ชั่วคราว
## KataGo Analysis Engine

The board AI can now run through KataGo Analysis Engine instead of OpenAI.

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
- `BOARD_AI_PROVIDER=openai`
  - force board AI to use the OpenAI move model only
- `BOARD_AI_PROVIDER=auto`
  - prefer KataGo when available, otherwise fall back to OpenAI, otherwise fall back to the local browser engine

Notes:

- Chat and board AI are now independent. You can use KataGo for moves while keeping chat on local fallback or OpenAI.
- The client now sends full move history to the server, so KataGo can analyze from the actual game sequence instead of only the visible stones.
- If KataGo is configured but unavailable at runtime, the app will keep running and the board AI will fall back according to `BOARD_AI_PROVIDER`.
