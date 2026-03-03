const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const mqttClient = require('./mqttClient');
const gcodeParser = require('./gcodeParser');
const ftpClient = require('./ftpClient');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// เสิร์ฟไฟล์ Static ของ Frontend (หลังจากการ Build ด้วย Vite)
const frontendDistPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath));

// Multer — เก็บไฟล์ใน memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.gcode' || ext === '.3mf') {
            cb(null, true);
        } else {
            cb(new Error('รองรับเฉพาะไฟล์ .gcode และ .3mf'));
        }
    },
});

// สร้าง HTTP server
const server = http.createServer(app);

// สร้าง WebSocket server
const wss = new WebSocketServer({ server });

// เก็บ WebSocket clients
const clients = new Set();

// เก็บข้อมูล layers ที่ parse แล้ว
let parsedLayers = null;

// เก็บ credentials สำหรับ auto-load G-code
let printerConfig = null;

// สถานะ auto-load
let autoLoading = false;
let autoLoadAttempted = null;       // เก็บชื่อ subtaskName ที่เพิ่งลองโหลดไป (ป้องกันโหลดซ้ำรัวๆ)
let autoLoadAttemptedFile = null;   // เก็บชื่อ gcodeFile ที่เพิ่งลองโหลดไป (เพื่อเช็คก่อนแบน)
let autoLoadFailTime = 0;           // เก็บ timestamp การลองโหลดที่ fail (สำหรับ cooldown)
const AUTO_LOAD_RETRY_DELAY = 30000; // 30 วินาทีระหว่าง retry
let mqttErrorCleared = false;

// FTP capabilities ที่ตรวจพบ (null = ยังไม่ทดสอบ)
let detectedCapabilities = null;

// G-code cache: { subtaskName: parsedResult }
const gcodeCache = new Map();

wss.on('connection', (ws) => {
    console.log('[WS] Client เชื่อมต่อแล้ว');
    clients.add(ws);

    // ส่งข้อมูลล่าสุดให้ client ใหม่ทันที
    const latest = mqttClient.getLatestStatus();
    if (latest) {
        ws.send(JSON.stringify({ type: 'status', data: latest }));
    }

    // ถ้ามี layers ที่ parse ไว้แล้ว ส่งให้ด้วย
    if (parsedLayers) {
        ws.send(JSON.stringify({ type: 'layers', data: parsedLayers }));
    }

    // ส่งสถานะการเชื่อมต่อ
    ws.send(JSON.stringify({
        type: 'connection',
        data: { connected: mqttClient.isConnected() }
    }));

    // ส่งสถานะ FTP capabilities
    if (detectedCapabilities !== null) {
        ws.send(JSON.stringify({
            type: 'capabilities',
            data: detectedCapabilities,
        }));
    }

    ws.on('close', () => {
        console.log('[WS] Client ตัดการเชื่อมต่อ');
        clients.delete(ws);
    });

    ws.on('error', (err) => {
        console.error('[WS] Error:', err.message);
        clients.delete(ws);
    });
});

// ===== Broadcast helpers =====

function broadcast(data) {
    const message = JSON.stringify({ type: 'status', data });
    for (const ws of clients) {
        if (ws.readyState === ws.OPEN) ws.send(message);
    }
}

function broadcastLayers(layersData) {
    const message = JSON.stringify({ type: 'layers', data: layersData });
    for (const ws of clients) {
        if (ws.readyState === ws.OPEN) ws.send(message);
    }
}

function broadcastInfo(text) {
    const message = JSON.stringify({ type: 'info', data: { message: text } });
    for (const ws of clients) {
        if (ws.readyState === ws.OPEN) ws.send(message);
    }
}

function broadcastCapabilities(caps) {
    const message = JSON.stringify({
        type: 'capabilities',
        data: caps,
    });
    for (const ws of clients) {
        if (ws.readyState === ws.OPEN) ws.send(message);
    }
}

// ===== FTP Capability Detection =====

async function detectFtpCapabilities(printerIP, accessCode) {
    console.log('[CAP] ═══════════════════════════════════');
    console.log('[CAP] กำลังทดสอบ FTP capabilities...');

    // ทดสอบ FTPS:990 (TCP probe + login)
    console.log('[CAP] --- PORT 990 (FTPS implicit) ---');
    const r990 = await ftpClient.probeAndTest(printerIP, accessCode, 'ftps990', 2);
    const ftps990 = { tcp: r990.tcp, login: r990.login, error: r990.error };

    // ทดสอบ FTP:21 (TCP probe + login)
    console.log('[CAP] --- PORT 21 (FTP plain) ---');
    const r21 = await ftpClient.probeAndTest(printerIP, accessCode, 'ftp21', 2);
    const ftp21 = { tcp: r21.tcp, login: r21.login, error: r21.error };

    // สรุปผล
    let autoLoadAvailable = false;
    let mode = null;
    let reason = 'UNKNOWN';

    if (r990.login) {
        autoLoadAvailable = true;
        mode = 'ftps990';
        reason = null;
    } else if (r21.login) {
        autoLoadAvailable = true;
        mode = 'ftp21';
        reason = null;
    } else if (!r990.tcp && !r21.tcp) {
        reason = 'PORT_CLOSED_OR_BLOCKED';
    } else {
        reason = 'AUTH_OR_TLS';
    }

    const result = { ftps990, ftp21, autoLoadAvailable, mode, reason, printerIP };
    console.log(`[CAP] Result: autoLoad=${autoLoadAvailable}, mode=${mode}, reason=${reason}`);
    console.log('[CAP] ═══════════════════════════════════');
    return result;
}

// ===== Auto-load G-code =====
async function autoLoadGcode(subtaskName, gcodeFile = null) {
    if (autoLoading || !printerConfig || !detectedCapabilities?.autoLoadAvailable) return;

    // ถ้ามี parsedLayers คาอยู่แล้ว (เช่นมาจากการณี User วางไฟล์เองผ่านหน้าเว็บ) ให้ข้ามไปเลย!
    if (parsedLayers != null && parsedLayers.totalLayers > 0) {
        console.log(`[AUTO] ข้ามการโหลดอัตโนมัติ เนื่องจากมี G-code ในระบบแล้ว (${parsedLayers.totalLayers} layers)`);
        broadcastInfo(`✅ ใช้งาน G-code ที่ผู้ใช้อัปโหลดเอง`);
        return;
    }

    // ข้ามถ้าเคยพยายามโหลด subtask นี้ด้วยไฟล์นี้ไปแล้ว แล้วมันเฟล (เช่นเป็น /data/) แแล้ว
    if (autoLoadAttempted === subtaskName &&
        (!gcodeFile || autoLoadAttemptedFile === gcodeFile)) {
        return;
    }
    if (autoLoadFailTime && (Date.now() - autoLoadFailTime) < AUTO_LOAD_RETRY_DELAY) return;

    // FTP ยังตรวจอยู่ → ข้ามไปก่อน (ไม่ set autoLoadAttempted เพื่อให้ retry ได้)
    const ftpMode = detectedCapabilities?.mode;
    if (!ftpMode) {
        if (detectedCapabilities !== null) {
            console.log('[AUTO] FTP ยังไม่พร้อม — จะ retry เมื่อพร้อม');
        }
        return;
    }

    // ตรวจ cache ก่อน
    if (gcodeCache.has(subtaskName)) {
        console.log(`[AUTO] ใช้ cache สำหรับ ${subtaskName}`);
        parsedLayers = gcodeCache.get(subtaskName);
        broadcastLayers(parsedLayers);
        broadcastInfo(`✅ โหลด G-code จาก cache: ${parsedLayers.totalLayers} layers`);
        autoLoadAttempted = subtaskName;
        return;
    }

    autoLoading = true;
    autoLoadAttempted = subtaskName;
    autoLoadAttemptedFile = gcodeFile || null;

    const { printerIP, accessCode } = printerConfig;
    const mode = detectedCapabilities?.mode || 'ftps990';

    // ========== Extract plate number จาก MQTT gcode_file ==========
    // เช่น "/cache/metadata/plate_8.gcode" → plateNumber = 8
    let plateNumber = null;
    if (gcodeFile) {
        const plateMatch = gcodeFile.match(/plate_?(\d+)\.gcode/i);
        if (plateMatch) {
            plateNumber = parseInt(plateMatch[1], 10);
        }
    }

    console.log(`[AUTO] กำลัง auto-load: ${subtaskName}`);
    console.log(`[AUTO] gcodeFile from MQTT: ${gcodeFile || 'N/A'}, plate: ${plateNumber ?? 'N/A'}`);
    broadcastInfo(`กำลังดาวน์โหลด G-code: ${subtaskName}...`);

    try {
        let gcodeText = null;

        // ========== 1. เช็คว่าเป็นไฟล์ในหน่วยความจำภายใน (Cloud/Network Print) หรือไม่ ==========
        // Bambu Lab ปิดกั้นไม่ให้ FTP เข้าถึง /data/ (internal eMMC) จะโดน Error 550 เสมอ
        if (gcodeFile && gcodeFile.toLowerCase().startsWith('/data/')) {
            console.log(`[AUTO] ❌ ไฟล์อยู่ใน Internal Memory (${gcodeFile}) ไม่สามารถดึงผ่าน FTP ได้`);
            broadcastInfo('งานพิมพ์นี้มาจาก Cloud / Internal Memory (Bambu ปิดกั้น FTP)');
            broadcast({
                type: 'ftpError',
                message: 'พิมพ์จาก Cloud/Network: ไฟล์อยู่ในหน่วยความจำภายในซึ่งเครื่องพิมพ์ไม่อนุญาตให้ดาวน์โหลดผ่าน FTP โปรดลากไฟล์ .3mf หรือ .gcode มาใส่หน้าต่างนี้เพื่อดูภาพ 3D',
                path: gcodeFile
            });
            autoLoading = false;
            return;
        }

        // ========== 2. สร้าง path list สำหรับค้นหาใน SD Card ==========
        const pathsToTry = [];
        const baseName = subtaskName.replace(/\.(gcode\.3mf|3mf|gcode)$/i, '');

        if (gcodeFile) {
            pathsToTry.push(gcodeFile);
            if (gcodeFile.endsWith('.3mf')) {
                pathsToTry.push(gcodeFile.replace('.3mf', '.gcode'));
            } else if (gcodeFile.endsWith('.gcode')) {
                pathsToTry.push(gcodeFile.replace('.gcode', '.3mf'));
            }
        }

        // ลองใน /cache/, /sdcard/, และ / ด้วยชื่อหลายรูปแบบ
        const dirs = ['/cache', '/sdcard', ''];
        const exts = ['.gcode.3mf', '.3mf', '.gcode'];
        for (const dir of dirs) {
            for (const ext of exts) {
                const prefix = dir ? `${dir}/` : '/';
                const p = `${prefix}${baseName}${ext}`;
                if (!pathsToTry.includes(p)) pathsToTry.push(p);
            }
        }

        // เผื่อชื่อไฟล์มีเว้นวรรค ให้ลองแบบแปลง space เป็น underscore ลงไปด้วย
        const baseNameUnderscore = baseName.replace(/ /g, '_');
        if (baseNameUnderscore !== baseName) {
            for (const dir of dirs) {
                for (const ext of exts) {
                    const prefix = dir ? `${dir}/` : '/';
                    const p = `${prefix}${baseNameUnderscore}${ext}`;
                    if (!pathsToTry.includes(p)) pathsToTry.push(p);
                }
            }
        }

        console.log(`[AUTO] ลอง ${pathsToTry.length} paths...`);

        // ลองแต่ละ path (ส่ง plateNumber ไปด้วย)
        for (const remotePath of pathsToTry) {
            try {
                gcodeText = await ftpClient.downloadGcode({
                    printerIP, accessCode, filename: remotePath,
                    mode, useFullPath: true, plateNumber,
                });
                console.log(`[AUTO] ✅ ดาวน์โหลด ${remotePath} สำเร็จ (${gcodeText.length} chars)`);
                break;
            } catch (err) {
                console.log(`[AUTO] ❌ ${remotePath}: ${err.message}`);
            }
        }

        // ========== 3. Fuzzy matching — list directories ==========
        if (!gcodeText) {
            console.log('[AUTO] ลอง list directories (fuzzy match)...');
            const normalizedBase = baseName.normalize('NFC').trim().toLowerCase().replace(/[\s_-]+/g, '');

            for (const dir of ['/cache/', '/sdcard/', '/']) {
                try {
                    const files = await ftpClient.listFiles({ printerIP, accessCode, mode, dir });
                    const names = files.map(f => f.name);
                    console.log(`[AUTO] ${dir}: ${names.join(', ') || '(ว่าง)'}`);

                    // Fuzzy match: normalize (ลบ เว้นวรรค, ขีดล่าง, ขีดกลาง) + includes ทิศทางใดก็ได้
                    const match = files.find(f => {
                        const fBase = f.name
                            .replace(/\.(gcode\.3mf|3mf|gcode)$/i, '')
                            .normalize('NFC').trim().toLowerCase()
                            .replace(/[\s_-]+/g, '');

                        return fBase === normalizedBase ||
                            fBase.includes(normalizedBase) ||
                            normalizedBase.includes(fBase);
                    });

                    if (match) {
                        console.log(`[AUTO] พบ: ${dir}${match.name}`);
                        gcodeText = await ftpClient.downloadGcode({
                            printerIP, accessCode,
                            filename: `${dir}${match.name}`,
                            mode, useFullPath: true, plateNumber,
                        });
                        console.log(`[AUTO] ✅ ดาวน์โหลดจาก list สำเร็จ (${gcodeText.length} chars)`);
                        break;
                    }
                } catch (listErr) {
                    console.log(`[AUTO] list ${dir}: ${listErr.message}`);
                }
            }
        }

        if (gcodeText) {
            console.log(`[AUTO] กำลัง parse G-code...`);
            const result = gcodeParser.parse(gcodeText);
            parsedLayers = result;
            gcodeCache.set(subtaskName, result);
            autoLoadAttempted = subtaskName; // ← set เฉพาะตอนสำเร็จ

            console.log(`[AUTO] Parse สำเร็จ: ${result.totalLayers} layers`);
            broadcastLayers(result);
            broadcastInfo(`✅ โหลด G-code สำเร็จ: ${result.totalLayers} layers`);
        } else {
            autoLoadFailTime = Date.now(); // ← cooldown 30s ก่อน retry
            console.log(`[AUTO] ❌ ทุก path ล้มเหลว — จะ retry ใน ${AUTO_LOAD_RETRY_DELAY / 1000}s`);
            broadcastInfo(`❌ ยังไม่พบไฟล์ G-code — จะลองใหม่อัตโนมัติ...`);
        }
    } catch (err) {
        autoLoadFailTime = Date.now(); // ← cooldown 30s ก่อน retry
        console.error(`[AUTO] Auto-load error:`, err.message);
        broadcastInfo(`❌ Auto-load error: ${err.message} — จะลองใหม่...`);
    }

    autoLoading = false;
}

// ===== REST API =====

/**
 * POST /api/connect
 */
app.post('/api/connect', (req, res) => {
    const { printerIP, serial, accessCode } = req.body;

    if (!printerIP || !serial || !accessCode) {
        return res.status(400).json({
            error: 'กรุณาระบุ printerIP, serial, และ accessCode'
        });
    }

    // เก็บ config
    printerConfig = { printerIP, serial, accessCode };
    parsedLayers = null;
    autoLoadAttempted = null;
    autoLoadAttemptedFile = null;
    autoLoadFailTime = 0;
    mqttErrorCleared = false;
    detectedCapabilities = null;

    console.log(`[API] กำลังเชื่อมต่อเครื่องพิมพ์ ${printerIP}...`);

    // เชื่อมต่อ MQTT
    mqttClient.connect({ printerIP, serial, accessCode }, (data) => {
        broadcast(data);

        // ล้าง mqttError เมื่อข้อมูลไหลสำเร็จ
        if (!mqttErrorCleared) {
            mqttErrorCleared = true;
            const clearMsg = JSON.stringify({ type: 'clearMqttError' });
            for (const ws of clients) {
                if (ws.readyState === ws.OPEN) ws.send(clearMsg);
            }
        }

        // AUTO-LOAD G-code เมื่อตรวจพบงานพิมพ์
        if (data.gcodeState === 'RUNNING' && data.subtaskName && !parsedLayers) {
            autoLoadGcode(data.subtaskName, data.gcodeFile);
        }
    }, (errorMsg) => {
        const errMessage = JSON.stringify({
            type: 'mqttError',
            data: { error: errorMsg }
        });
        for (const ws of clients) {
            if (ws.readyState === ws.OPEN) ws.send(errMessage);
        }
    });

    // แจ้ง connected
    setTimeout(() => {
        const connectionMsg = JSON.stringify({
            type: 'connection',
            data: { connected: true }
        });
        for (const ws of clients) {
            if (ws.readyState === ws.OPEN) ws.send(connectionMsg);
        }
    }, 2000);

    // ทดสอบ FTP capabilities (ทำเบื้องหลัง ไม่บล็อก)
    detectFtpCapabilities(printerIP, accessCode).then((caps) => {
        detectedCapabilities = caps;
        broadcastCapabilities(caps);
        console.log(`[API] FTP caps: mode=${caps.mode}, autoLoad=${caps.autoLoadAvailable}, reason=${caps.reason}`);

        // Retry auto-load ถ้า FTP พร้อมและมีงานพิมพ์ค้างอยู่
        if (caps.autoLoadAvailable && !parsedLayers) {
            const latest = mqttClient.getLatestStatus();
            if (latest && latest.gcodeState === 'RUNNING' && latest.subtaskName) {
                console.log(`[API] FTP พร้อมแล้ว → retry auto-load: ${latest.subtaskName}`);
                autoLoadAttempted = null;
                autoLoadFailTime = 0; // reset เพื่อให้ retry
                autoLoadGcode(latest.subtaskName, latest.gcodeFile);
            }
        }
    });

    res.json({
        success: true,
        message: `กำลังเชื่อมต่อกับเครื่องพิมพ์ ${printerIP}`
    });
});

/**
 * POST /api/disconnect
 */
app.post('/api/disconnect', (req, res) => {
    mqttClient.disconnect();
    printerConfig = null;
    parsedLayers = null;
    autoLoadAttempted = null;
    autoLoadAttemptedFile = null;
    autoLoadFailTime = 0;
    mqttErrorCleared = false;
    detectedCapabilities = null;

    const disconnectMsg = JSON.stringify({
        type: 'connection',
        data: { connected: false }
    });
    for (const ws of clients) {
        if (ws.readyState === ws.OPEN) ws.send(disconnectMsg);
    }

    res.json({ success: true, message: 'ตัดการเชื่อมต่อแล้ว' });
});

/**
 * GET /api/capabilities
 * ทดสอบ FTP connectivity
 */
app.get('/api/capabilities', async (req, res) => {
    if (detectedCapabilities) {
        return res.json(detectedCapabilities);
    }
    res.json({ ftps990: null, ftp21: null, autoLoadAvailable: null, mode: null, reason: 'NOT_TESTED' });
});

/**
 * POST /api/retest-ftp
 * Re-test FTP capabilities (สำหรับปุ่ม Re-test)
 */
app.post('/api/retest-ftp', async (req, res) => {
    if (!printerConfig) {
        return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อเครื่องพิมพ์' });
    }

    try {
        const { printerIP, accessCode } = printerConfig;
        const caps = await detectFtpCapabilities(printerIP, accessCode);
        detectedCapabilities = caps;
        broadcastCapabilities(caps);
        res.json(caps);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/load-gcode
 * อัปโหลดไฟล์ .gcode หรือ .3mf
 */
app.post('/api/load-gcode', upload.single('file'), async (req, res) => {
    try {
        let gcodeText = '';

        if (req.file) {
            // อัปโหลดไฟล์
            const ext = path.extname(req.file.originalname).toLowerCase();
            console.log(`[API] รับไฟล์: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);

            if (ext === '.3mf') {
                gcodeText = ftpClient.extract3mf(req.file.buffer);
            } else {
                gcodeText = req.file.buffer.toString('utf-8');
            }

            // --- TEMPORARY DEBUG ---
            const fs = require('fs');
            fs.writeFileSync('test_upload.gcode', gcodeText);
            console.log('[API] Saved test_upload.gcode for object analysis');
            // -----------------------
        } else if (req.body.gcode) {
            // รับ G-code text โดยตรง (backward compat)
            gcodeText = req.body.gcode;
            console.log(`[API] รับ G-code text (${gcodeText.length} chars)`);
        } else {
            return res.status(400).json({
                error: 'กรุณาอัปโหลดไฟล์ .gcode / .3mf หรือส่ง gcode text'
            });
        }

        // Parse G-code
        console.log('[API] กำลัง parse G-code...');
        const result = gcodeParser.parse(gcodeText);
        parsedLayers = result;

        // เก็บใน cache ด้วย
        const filename = req.file?.originalname || 'manual-upload';
        gcodeCache.set(filename, result);

        console.log(`[API] Parse สำเร็จ: ${result.totalLayers} layers`);

        // Broadcast ไปยัง WebSocket clients
        broadcastLayers(result);
        broadcastInfo(`✅ อัปโหลด G-code สำเร็จ: ${result.totalLayers} layers`);

        res.json({
            success: true,
            totalLayers: result.totalLayers,
            bounds: result.bounds,
            cachedAs: filename,
        });
    } catch (err) {
        console.error('[API] Load G-code error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/status
 */
app.get('/api/status', (req, res) => {
    const status = mqttClient.getLatestStatus();
    if (!status) {
        return res.json({
            connected: mqttClient.isConnected(),
            data: null,
            message: 'ยังไม่มีข้อมูล'
        });
    }

    res.json({
        connected: mqttClient.isConnected(),
        data: status
    });
});

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

/**
 * POST /api/control/fan
 * ควบคุมพัดลม: { fan: "aux"|"cooling"|"chamber", speed: 0-100 }
 */
app.post('/api/control/fan', (req, res) => {
    const { fan, speed } = req.body;

    if (!fan || !['aux', 'cooling', 'chamber'].includes(fan)) {
        return res.status(400).json({ error: 'Invalid fan type. Use: aux, cooling, chamber' });
    }
    if (speed == null || speed < 0 || speed > 100) {
        return res.status(400).json({ error: 'Speed must be 0-100' });
    }
    if (!mqttClient.isConnected()) {
        return res.status(503).json({ error: 'MQTT not connected' });
    }

    // P1=part cooling, P2=aux, P3=chamber
    const fanMap = { cooling: 1, aux: 2, chamber: 3 };
    const pValue = fanMap[fan];
    const pwm = Math.round((speed / 100) * 255);

    const payload = {
        print: {
            sequence_id: "0",
            command: "gcode_line",
            param: `M106 P${pValue} S${pwm}\n`
        }
    };

    const success = mqttClient.publish(payload);
    if (success) {
        console.log(`[API] Fan control: ${fan} -> ${speed}% (S${pwm})`);
        res.json({ success: true, fan, speed, pwm });
    } else {
        res.status(500).json({ error: 'Failed to publish MQTT command' });
    }
});

/**
 * POST /api/control/skip-object
 * ข้ามชิ้นงาน: { objectIds: [1, 2, ...] }
 */
app.post('/api/control/skip-object', (req, res) => {
    const { objectIds } = req.body;

    if (!Array.isArray(objectIds) || objectIds.length === 0) {
        return res.status(400).json({ error: 'objectIds must be a non-empty array' });
    }
    if (!objectIds.every(id => Number.isInteger(id) && id >= 0)) {
        return res.status(400).json({ error: 'All objectIds must be non-negative integers' });
    }
    if (!mqttClient.isConnected()) {
        return res.status(503).json({ error: 'MQTT not connected' });
    }

    const payload = {
        print: {
            sequence_id: "0",
            command: "print_option",
            option: "skip_object",
            obj_list: objectIds
        }
    };

    const success = mqttClient.publish(payload);
    if (success) {
        console.log(`[API] Skip objects: [${objectIds.join(', ')}]`);
        res.json({ success: true, skippedIds: objectIds });
    } else {
        res.status(500).json({ error: 'Failed to publish MQTT command' });
    }
});

/**
 * GET /api/detected-objects
 * ดึง unique object IDs จาก parsed G-code
 */
app.get('/api/detected-objects', (req, res) => {
    if (!parsedLayers || !parsedLayers.layers) {
        return res.json({ objects: [] });
    }

    const objectIds = new Set();
    for (const layer of parsedLayers.layers) {
        for (const seg of layer) {
            if (seg.objectId != null) {
                objectIds.add(seg.objectId);
            }
        }
    }

    res.json({
        objects: Array.from(objectIds).sort((a, b) => a - b)
    });
});

// API Routes จบแล้ว -> ที่เหลือโยนให้ React Router จัดการ (Catch-all)
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// เริ่ม server
server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║      🖨️  Bambu Monitor Backend          ║
║      Server running on port ${PORT}        ║
║      WebSocket ready                     ║
║      G-code Parser ready                 ║
║      Auto-load + Upload ready            ║
╚══════════════════════════════════════════╝
  `);
});
