# 🖨️ Bambu Monitor

ระบบแสดงผลการพิมพ์ 3D แบบเรียลไทม์สำหรับ **Bambu Lab P2S** พร้อม 3D Visualization ที่แสดงโมเดลขึ้นมาทีละ layer ตามจริง

![Status](https://img.shields.io/badge/status-active%20development-brightgreen)
![Node](https://img.shields.io/badge/Node.js-v18+-339933)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Three.js](https://img.shields.io/badge/Three.js-r160-black)

---

## ✨ ฟีเจอร์หลัก

### 🔗 การเชื่อมต่อ
- เชื่อมต่อ Bambu P2S ผ่าน **MQTT TLS** (port 8883)
- ดาวน์โหลด G-code อัตโนมัติจากเครื่องพิมพ์ผ่าน **FTPS** (port 990)
- อัปโหลด G-code ด้วยตนเองผ่าน UI รองรับ `.gcode` และ `.3mf`
- ระบบ auto-reconnect เมื่อขาดการเชื่อมต่อ

### 🖥️ 3D Visualization
- แสดงโมเดล 3D ที่กำลังพิมพ์แบบ **real-time** ทีละ layer
- **Ghost Model Preview**: แสดงโครงตาข่ายโปร่งใส (5%) ของชิ้นงานล่วงหน้าทั้งหมด เพื่อให้เห็นภาพรวมของงาน
- **Faux-3D Lighting**: แสงเงาตกกระทบแบบ 3 มิติบนเส้นพลาสติกแต่ละเส้น ให้ความรู้สึกเหมือนเส้นพลาสติกจริงฉีดออกมา (Bambu Studio Style) 
- แสดง **print bed** ขนาด 256×256mm พร้อม grid แบบ Bambu Studio
- **หัวพิมพ์ (Nozzle)** แสดงตำแหน่งจริงพร้อม smooth fractional interpolation
- สีเส้นพิมพ์ตรงกับ **สีจริงจาก AMS** (True Color ไม่จำกัดความสว่าง)
- มุมมองหลากหลาย: **Front / Top / Iso / Free** orbit

### 📊 HUD (Head-Up Display)
- Layer ปัจจุบัน / ทั้งหมด
- อุณหภูมิหัวฉีด (Nozzle) และเตียง (Bed) — ค่าจริง / เป้าหมาย
- ชื่องาน, จำนวน G-code layers
- กราฟอุณหภูมิย้อนหลัง 60 วินาที
- ความคืบหน้า (%) พร้อม progress bar
- เวลาที่เหลือ (ชม:นาที)
- สถานะเครื่องพิมพ์พร้อม indicator dot (สี + animation)

### 🎨 UI/UX
- Dark theme สไตล์ **sci-fi** (BambuStudio aesthetic)
- Glassmorphism panels พร้อม backdrop blur
- ตั้งค่าสีเส้นพิมพ์เองได้ผ่าน Settings panel
- Responsive design

---

## 📋 สิ่งที่ต้องมี

- **Node.js** v18 ขึ้นไป
- **npm** v9 ขึ้นไป
- เครื่องพิมพ์ **Bambu Lab P2S** ที่อยู่ในเครือข่ายเดียวกัน

---

## 🚀 วิธี Run

### 1. ติดตั้ง Dependencies

```bash
# ติดตั้ง root dependencies (concurrently)
npm install

# ติดตั้ง backend dependencies
cd backend && npm install

# ติดตั้ง frontend dependencies
cd ../frontend && npm install
cd ..
```

### 2. รัน Development Server

**รันทั้ง backend + frontend พร้อมกัน:**
```bash
npm run dev
```

**หรือรันแยก:**
```bash
# Terminal 1: Backend (port 3001)
npm run dev:backend

# Terminal 2: Frontend (port 5173)
npm run dev:frontend
```

### 3. เปิดเบราว์เซอร์

เข้า [http://localhost:5173](http://localhost:5173)

1. กรอก **IP Address** ของเครื่องพิมพ์ (เช่น `192.168.1.100`)
2. กรอก **Serial Number** (ดูจาก Bambu Handy / BambuStudio / หน้าจอเครื่อง)
3. กรอก **Access Code** (หน้าจอเครื่อง → Settings → Network → Access Code)
4. กด **เชื่อมต่อเครื่องพิมพ์**

---

## � สถาปัตยกรรมระบบ

```
┌─────────────────────────────────────────────────────────────────┐
│                        Bambu Lab P2S                            │
│                   ┌──────────┐  ┌──────────┐                   │
│                   │ MQTT TLS │  │   FTPS   │                   │
│                   │ :8883    │  │   :990   │                   │
│                   └────┬─────┘  └────┬─────┘                   │
└────────────────────────┼─────────────┼─────────────────────────┘
                         │             │
                         ▼             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend  (Node.js :3001)                     │
│                                                                 │
│  ┌── mqttClient.js ──┐  ┌── ftpClient.js ──┐                   │
│  │ • MQTT TLS client │  │ • FTPS download  │                   │
│  │ • Parse JSON data │  │ • Auto-detect    │                   │
│  │ • Heartbeat ping  │  │   ftps990/plain  │                   │
│  └───────┬───────────┘  └───────┬──────────┘                   │
│          │                      │                               │
│  ┌───────▼──────────────────────▼──────────┐                   │
│  │             server.js                    │                   │
│  │  • Express REST API                     │                   │
│  │  • WebSocket broadcast                  │                   │
│  │  • G-code cache management              │                   │
│  │  • Auto-load G-code on print start      │                   │
│  └───────┬─────────────┬───────────────────┘                   │
│          │             │                                        │
│  ┌───────▼─────────┐   │                                       │
│  │ gcodeParser.js  │   │                                       │
│  │ • Parse G-code  │   │                                       │
│  │ • Layer detect  │   │                                       │
│  │ • Gap filter    │   │                                       │
│  │ • Segment time  │   │                                       │
│  └─────────────────┘   │                                       │
└─────────────────────────┼──────────────────────────────────────┘
                          │ WebSocket
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Frontend  (React + Vite :5173)                 │
│                                                                 │
│  ┌── usePrinterStore.js ───┐  ┌── printProgressTracker.js ──┐  │
│  │ Zustand global state    │  │ Smooth % interpolation      │  │
│  │ • MQTT data (WS)       │  │ • Dynamic layer scaling     │  │
│  │ • G-code layers        │  │ • Segment-to-time mapping   │  │
│  │ • Settings             │  │ • Feedrate-based animation  │  │
│  └─────────┬──────────────┘  └──────────────┬───────────────┘  │
│            │                                 │                  │
│  ┌─────────▼─────────────────────────────────▼───────────────┐  │
│  │                  Components                                │  │
│  │  ┌── PrinterView3D.jsx ──┐  ┌── LayerRenderer.jsx ──────┐ │  │
│  │  │ • 3D scene setup      │  │ • Instanced line geometry │ │  │
│  │  │ • Print bed + grid    │  │ • Progressive rendering   │ │  │
│  │  │ • Print head (nozzle) │  │ • Print head tracking     │ │  │
│  │  │ • Camera controls     │  │ • Smooth lerp animation   │ │  │
│  │  └───────────────────────┘  └────────────────────────────┘ │  │
│  │  ┌── HUD.jsx ────────────┐  ┌── ConnectPanel.jsx ───────┐ │  │
│  │  │ • Stats overlay       │  │ • Connection form         │ │  │
│  │  │ • Temp graph (Canvas) │  │ • IP/Serial/AccessCode    │ │  │
│  │  │ • Progress bar        │  │ • Auto-save credentials   │ │  │
│  │  │ • State indicator     │  │ • Upload G-code           │ │  │
│  │  └───────────────────────┘  └────────────────────────────┘ │  │
│  │  ┌── SettingsPanel.jsx ──┐                                 │  │
│  │  │ • Filament color pick │                                 │  │
│  │  └───────────────────────┘                                 │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## ⚙️ วิธีการทำงานของแต่ละส่วน

### 1. MQTT Client (`mqttClient.js`)

เชื่อมต่อเครื่องพิมพ์ Bambu Lab ผ่าน MQTT over TLS:

- **Protocol**: MQTTS (port 8883, self-signed cert)
- **Topic**: `device/{serial}/report` — รับข้อมูลสถานะเครื่องพิมพ์
- **Heartbeat**: ส่ง `pushing.pushall` ทุก 5 วินาทีเพื่อขอข้อมูลล่าสุด
- **Data**: แปลง JSON payload → normalize → ส่งผ่าน callback

### 2. FTP Client (`ftpClient.js`)

ดาวน์โหลดไฟล์ G-code จากเครื่องพิมพ์:

- **Protocol**: FTPS Implicit TLS (port 990) หรือ plain FTP (port 21) — auto-detect
- **Auth**: username `bblp`, password = Access Code
- **Paths**: รองรับการดาวน์โหลดไฟล์ `.gcode` และสกัดไฟล์จาก `.3mf` (Multi-plate support)
- **Retry Mechanism**: ระบบดีเลย์ 30 วินาทีและพยายามดาวน์โหลดซ้ำเมื่อ FTP กลับมาพร้อมใช้งาน

### 3. G-code Parser (`gcodeParser.js`)

แปลผล G-code เป็นข้อมูล vector สำหรับการเรนเดอร์ 3D:

- **Layer Detection**: 3 กลยุทธ์ — `LAYER_CHANGE` comment / `Z:` comment / Z-height auto
- **Arc Interpolation**: รองรับคำสั่ง G2/G3 (ลักษณะโค้ง) โดยแปลงเป็นจุดย่อยๆ เพื่อให้รูและส่วนโค้งกลมเนียน
- **Extrusion Tracking**: ติดตาม retraction/deretraction เพื่อแยก extrusion จริง
- **Filtering**:
  - `MIN_E_PER_MM` (0.02) — กรอง wipe/travel ที่มีปริมาณการฉีดพลาสติกต่ำ (ลบเส้น stray)
  - **Retraction-based Skip** — ตรวจจับ deretraction → skip 1 segment (run-up/priming)
- **Time Calculation**: ประเมินเวลาพิมพ์ของแต่ละเส้นจากค่า Feedrate เพื่อใช้ sync แอนิเมชัน

### 4. WebSocket Server (`server.js`)

ศูนย์กลางการสื่อสารระหว่าง hardware ↔ frontend:

- **REST API**:
  - `POST /api/connect` — เชื่อมต่อ MQTT
  - `POST /api/disconnect` — ตัดการเชื่อมต่อ
  - `POST /api/upload-gcode` — อัปโหลด G-code
  - `GET /api/capabilities` — ทดสอบ FTP
  - `GET /api/status` — สถานะปัจจุบัน
- **WebSocket Messages**:
  - `printerData` — ข้อมูล MQTT (layer, temp, progress, ...)
  - `layers` — G-code parsed data สำหรับ 3D rendering
  - `info` — ข้อความแจ้งสถานะ
  - `connection` — สถานะการเชื่อมต่อ
- **Auto-load**: เมื่อตรวจพบงานพิมพ์ใหม่ → ดาวน์โหลด + parse G-code อัตโนมัติ
- **Cache**: เก็บผลลัพธ์ parse ไว้ใน memory เพื่อไม่ต้อง re-download

### 5. Zustand Store (`usePrinterStore.js`)

จัดการ state ทั้งหมดของ frontend:

- **Printer Data**: อัปเดตจาก WebSocket real-time
- **G-code Layers**: เก็บ parsed segments + cumulative counts
- **Settings**: สีเส้นพิมพ์ที่กำหนดเอง, ข้อมูลเชื่อมต่อ
- **Connection State**: สถานะการเชื่อมต่อ + auto-save credentials

### 6. Print Progress Tracker (`printProgressTracker.js`)

ระบบซิงก์ความพยายามระหว่างเวลาพิมพ์จริง กับ การรันแอนิเมชันในโปรแกรม:

- **Layer-Anchored Timing**: ผูกตำแหน่งแอนิเมชันให้ติดอยู่กับ Layer ปัจจุบันที่เครื่องพิมพ์ (MQTT) รายงานเสมอ
- **Sub-Layer Interpolation**: คำนวณร้อยละของการพิมพ์ภายใน Layer นั้นๆ โดยอิงกับระยะเวลาที่ผ่านไป vs เวลาประเมินของ Layer
- **No-Runaway Anchor**: แอนิเมชันจะไม่วิ่งทะลุไป Layer ถัดไป ถ้าเครื่องพิมพ์ของจริงยังพิมพ์ไม่เสร็จ (Cap at 99.9%)
- **Dynamic Layer Scaling**: Layer 1 ชดเชยความเร็วให้ช้าลงเพื่อความสมจริง

### 7. Layer Renderer (`LayerRenderer.jsx`)

แสดงผลโมเดล 3D แบบ Dual-Mesh Overlap เพื่อ Performance สูงสุด:

- **Instanced Line2**: ใช้ `LineSegments2` จาก Three.js สำหรับการเรนเดอร์เส้นหนา (`worldUnits`)
- **Dual-Mesh Architecture**: เรนเดอร์แยก 2 เลเยอร์: 
  - `GhostMesh`: โมเดล 100% ล่วงหน้า โปร่งแสง 5% (เรนเดอร์ครั้งเดียวตอนโหลดไฟล์)
  - `SolidMesh`: โมเดลอัพเดทตามเปอร์เซ็นต์จริง สีทึบแสง มีแสงเงาวิ่งทับ GhostMesh
- **Faux-3D Lighting**: คำนวณ Normal vector ของเส้นเพื่อเพิ่มแสงตกกระทบ (Specular highlight)
- **Smooth Animation**: Lerp แอนิเมชันของ instanceCount 6% per frame เพื่อความนุ่มนวลในการวาดเส้น

### 8. HUD (`HUD.jsx`)

แสดงข้อมูลสถานะเครื่องพิมพ์:

- **State Indicator**: จุดสีแสดงสถานะ
  - 🟢 `RUNNING` — กำลังพิมพ์ (กระพริบ)
  - 🟡 `PREPARE` — กำลังเตรียม (กระพริบเร็ว)
  - 🟠 `PAUSE` — หยุดชั่วคราว
  - 🟢 `FINISH` — เสร็จสิ้น (นิ่ง)
  - ⚪ `IDLE` — ว่าง
- **Temperature Graph**: Canvas-based, แสดง nozzle + bed temp ย้อนหลัง 60 วินาที
- **Filament Info**: ประเภทเส้นพิมพ์ + สีจาก AMS

---

## 📁 โครงสร้างโปรเจค

```
bambu-monitor/
├── package.json                # Root monorepo (concurrently)
├── README.md
│
├── backend/
│   ├── package.json
│   ├── server.js               # Express + WebSocket + orchestration
│   ├── mqttClient.js           # MQTT TLS client for Bambu P2S
│   ├── ftpClient.js            # FTPS client for G-code download
│   └── gcodeParser.js          # G-code → layers + segments parser
│
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css             # Dark sci-fi theme + animations
        ├── store/
        │   ├── usePrinterStore.js      # Zustand global state
        │   ├── printProgressTracker.js  # Smooth animation engine
        │   └── printHeadState.js        # Shared nozzle position
        └── components/
            ├── ConnectPanel.jsx    # Connection form + G-code upload
            ├── PrinterView3D.jsx   # 3D scene (bed, nozzle, camera)
            ├── LayerRenderer.jsx   # 3D model rendering engine
            ├── HUD.jsx             # Stats overlay + temp graph
            └── SettingsPanel.jsx   # Filament color settings
```

---

## 📡 MQTT Data ที่ดึงมา

| ฟิลด์ | คำอธิบาย |
|-------|---------|
| `layer_num` | Layer ปัจจุบัน |
| `total_layer_num` | จำนวน layer ทั้งหมด |
| `nozzle_temper` / `nozzle_target_temper` | อุณหภูมิหัวฉีด — จริง / เป้าหมาย (°C) |
| `bed_temper` / `bed_target_temper` | อุณหภูมิเตียง — จริง / เป้าหมาย (°C) |
| `mc_percent` | ความคืบหน้า (%) |
| `mc_remaining_time` | เวลาที่เหลือ (นาที) |
| `gcode_state` | สถานะ: `IDLE`, `PREPARE`, `RUNNING`, `PAUSE`, `FINISH`, `FAILED` |
| `gcode_file` | ชื่อไฟล์ G-code ที่กำลังพิมพ์ |
| `subtask_name` | ชื่องานพิมพ์ |
| `ams.tray_color` | สีเส้นพิมพ์ (Hex) จาก AMS |
| `ams.tray_type` | ชนิดเส้นพิมพ์ (PLA, PETG, ABS, ...) |

---

## 🛠️ สิ่งที่ทำแล้ว

### Phase 1: Foundation ✅
- [x] ตั้ง monorepo (backend + frontend + concurrently)
- [x] MQTT TLS client เชื่อมต่อ Bambu P2S
- [x] WebSocket server สำหรับส่งข้อมูล real-time
- [x] React + Vite + Three.js setup
- [x] Zustand store สำหรับ global state

### Phase 2: 3D Visualization ✅
- [x] Print bed 256×256mm พร้อม grid
- [x] G-code parser — แปลง G-code → segments
- [x] Layer rendering ด้วย instanced line geometry
- [x] Progressive animation (แสดงโมเดลทีละ segment)
- [x] หัวพิมพ์เคลื่อนไหวตามตำแหน่งจริง

### Phase 3: Data Integration ✅
- [x] FTPS auto-download G-code จากเครื่อง
- [x] Auto-detect FTP protocol (FTPS 990 / plain 21)
- [x] Auto-load G-code เมื่อเริ่มพิมพ์งานใหม่
- [x] G-code cache ใน memory
- [x] สีเส้นพิมพ์จาก AMS (filament color + type)

### Phase 4: Animation & Accuracy ✅
- [x] Layer-Anchored Timing (บังคับ sync แอนิเมชันตาม Layer จาก MQTT)
- [x] Support G2/G3 Arc Interpolation (แก้ปัญหาเส้นทะแยงตัดรูโค้ง)
- [x] Gap detection + Extrusion density filter (กรองเส้น travel มั่วซั่ว)
- [x] Retraction/deretraction tracking (ช่วยลดเส้นเชื่อมต่อมั่ว)
- [x] Print head fractional interpolation (smooth nozzle motion)

### Phase 5: Advanced Rendering & UI ✅
- [x] Dual-Mesh Layout (โชว์ Ghost Model แบบ 100% โปร่งใส)
- [x] Faux-3D Plastic Specular Highlights (ตกแต่งแสงเงาแนว Bambu Studio)
- [x] True AMS Filament Colors (ยึดสีจริง ไม่สว่างเพี้ยนด่าง)
- [x] HUD overlay — stats, temp, progress, state
- [x] Temperature graph (60s history)
- [x] Camera presets (Front/Top/Iso/Free)
- [x] Responsive layout & Settings Panel

---

## 🗺️ แผนพัฒนาต่อไป (Roadmap)

### 🔜 ระยะสั้น (Short-term)
- [ ] **ปรับปรุง Gap Detection** — ลด false positive เพื่อแสดงเส้นโมเดลครบถ้วนขึ้น
- [ ] **Timeline Calibration** — ปรับ dynamic scaling ให้ตรงกับความเร็วพิมพ์จริงมากขึ้น
- [ ] **Multi-color Support** — แสดงสีแตกต่างเมื่อใช้หลาย filament จาก AMS
- [ ] **Error/Warning Display** — แสดงข้อผิดพลาดจากเครื่องพิมพ์ (filament runout, nozzle clog)

### 📐 ระยะกลาง (Mid-term)
- [ ] **Print History** — บันทึกประวัติการพิมพ์ + สถิติ
- [ ] **G-code Preview** — แสดงตัวอย่างโมเดลทั้งหมดก่อนเริ่มพิมพ์
- [ ] **Timelapse Recording** — บันทึกวิดีโอ visualization เป็น timelapse
- [ ] **Multi-Printer** — รองรับเครื่องพิมพ์หลายเครื่องพร้อมกัน
- [ ] **Notification System** — แจ้งเตือน LINE/Discord เมื่อพิมพ์เสร็จ/ผิดพลาด
- [ ] **Mobile Responsive** — ปรับ UI สำหรับมือถือ

### 🚀 ระยะยาว (Long-term)
- [ ] **Bambu X1/A1 Support** — รองรับเครื่องพิมพ์ Bambu รุ่นอื่น
- [ ] **OctoPrint Integration** — รองรับเครื่องพิมพ์ที่ใช้ OctoPrint
- [ ] **AI Print Quality Monitor** — ตรวจจับปัญหาคุณภาพพิมพ์อัตโนมัติ
- [ ] **Remote Control** — สั่ง pause/resume/cancel จาก UI
- [ ] **Plugin System** — ระบบปลั๊กอินสำหรับเพิ่มฟีเจอร์
- [ ] **Desktop App** — แพ็คเป็น Electron app

---

## ⚠️ หมายเหตุ

- เครื่องพิมพ์ต้องเปิด **LAN Only Mode** หรือเชื่อมต่ออยู่ในเครือข่ายเดียวกัน
- Access Code ดูได้จาก: หน้าจอเครื่องพิมพ์ → Settings → Network → Access Code
- Backend ใช้ `rejectUnauthorized: false` เนื่องจาก Bambu ใช้ self-signed certificate
- G-code parser รองรับ BambuStudio / PrusaSlicer / OrcaSlicer format

---

## 📜 License

MIT © 2026
