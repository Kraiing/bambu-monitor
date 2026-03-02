const net = require('net');
const { Client } = require('basic-ftp');
const AdmZip = require('adm-zip');
const path = require('path');
const { Readable } = require('stream');

// ===== TCP Port Probe =====

/**
 * ทดสอบว่า TCP port เปิดหรือไม่ (ไม่ login)
 * @returns {Promise<{open: boolean, error?: string, latency?: number}>}
 */
function tcpProbe(host, port, timeout = 2000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const socket = new net.Socket();
        let resolved = false;

        const done = (open, error) => {
            if (resolved) return;
            resolved = true;
            socket.destroy();
            resolve({
                open,
                error: error || undefined,
                latency: Date.now() - start,
            });
        };

        socket.setTimeout(timeout);
        socket.on('connect', () => done(true));
        socket.on('timeout', () => done(false, `TCP timeout ${timeout}ms`));
        socket.on('error', (err) => done(false, err.message));

        socket.connect(port, host);
    });
}

// ===== FTPS/FTP Login Test =====

/**
 * ทดสอบ FTPS/FTP login ด้วย basic-ftp
 * @param {'ftps990'|'ftp21'} mode
 * @param {number} loginTimeout - ms (default 15000)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function ftpLoginTest(host, user, password, mode, loginTimeout = 15000) {
    const client = new Client(loginTimeout);
    client.ftp.verbose = false;

    try {
        if (mode === 'ftps990') {
            // Implicit FTPS on port 990
            await client.access({
                host,
                port: 990,
                user,
                password,
                secure: 'implicit',
                secureOptions: { rejectUnauthorized: false },
            });
        } else {
            // FTP on port 21 (no TLS)
            await client.access({
                host,
                port: 21,
                user,
                password,
                secure: false,
            });
        }

        client.close();
        return { ok: true };
    } catch (err) {
        client.close();
        return { ok: false, error: err.message };
    }
}

// ===== Full Probe + Test =====

/**
 * TCP probe + FTP login test สำหรับ port เดียว
 * retry ไม่เกิน 2 ครั้ง
 * @returns {Promise<{tcp: boolean, login: boolean, error?: string, latency?: number}>}
 */
async function probeAndTest(host, accessCode, mode, retries = 2) {
    const port = mode === 'ftps990' ? 990 : 21;

    for (let attempt = 1; attempt <= retries; attempt++) {
        console.log(`[FTP] TCP probe ${host}:${port} (attempt ${attempt}/${retries})...`);

        // Step 1: TCP probe
        const probe = await tcpProbe(host, port, 2000);
        if (!probe.open) {
            console.log(`[FTP] TCP ${host}:${port} CLOSED (${probe.error}) [${probe.latency}ms]`);
            if (attempt === retries) {
                return { tcp: false, login: false, error: probe.error };
            }
            continue;
        }

        console.log(`[FTP] TCP ${host}:${port} OPEN [${probe.latency}ms] — trying login...`);

        // Step 2: FTPS/FTP login (user is always 'bblp' for Bambu printers)
        const login = await ftpLoginTest(host, 'bblp', accessCode, mode, 15000);
        if (login.ok) {
            console.log(`[FTP] ✅ Login ${mode} สำเร็จ`);
            return { tcp: true, login: true, latency: probe.latency };
        }

        console.log(`[FTP] ❌ Login ${mode} ล้มเหลว: ${login.error}`);
        if (attempt === retries) {
            return { tcp: true, login: false, error: login.error };
        }
    }

    return { tcp: false, login: false, error: 'UNKNOWN' };
}

// ===== Download G-code =====

/**
 * ดาวน์โหลด G-code จากเครื่องพิมพ์ผ่าน FTPS/FTP
 * @returns {Promise<string>} raw G-code text
 */
async function downloadGcode(config) {
    const { printerIP, accessCode, filename, mode = 'ftps990', useFullPath = false, plateNumber = null } = config;
    const client = new Client(30000); // 30s timeout for download
    client.ftp.verbose = false;

    try {
        const accessOpts = mode === 'ftps990'
            ? {
                host: printerIP, port: 990,
                user: 'bblp', password: accessCode,
                secure: 'implicit',
                secureOptions: { rejectUnauthorized: false },
            }
            : {
                host: printerIP, port: 21,
                user: 'bblp', password: accessCode,
                secure: false,
            };

        await client.access(accessOpts);
        console.log(`[FTP] เชื่อมต่อสำเร็จ (${mode})`);

        // ใช้ full path ถ้าระบุ หรือ prepend /cache/
        const remotePath = useFullPath ? filename : `/cache/${filename}`;
        console.log(`[FTP] กำลังดาวน์โหลด ${remotePath}...`);

        // Download to buffer via writable stream
        const chunks = [];
        const writable = new (require('stream').Writable)({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            }
        });

        await client.downloadTo(writable, remotePath);
        client.close();

        const buffer = Buffer.concat(chunks);
        const ext = path.extname(remotePath).toLowerCase();

        if (ext === '.3mf') {
            return extract3mf(buffer, plateNumber);
        }
        return buffer.toString('utf-8');

    } catch (err) {
        client.close();
        throw new Error(`FTP download failed (${mode}): ${err.message}`);
    }
}

// ===== List Files =====

async function listFiles(config) {
    const { printerIP, accessCode, mode = 'ftps990', dir = '/cache/' } = config;
    const client = new Client(10000);
    client.ftp.verbose = false;

    try {
        const accessOpts = mode === 'ftps990'
            ? {
                host: printerIP, port: 990,
                user: 'bblp', password: accessCode,
                secure: 'implicit',
                secureOptions: { rejectUnauthorized: false },
            }
            : {
                host: printerIP, port: 21,
                user: 'bblp', password: accessCode,
                secure: false,
            };

        await client.access(accessOpts);

        const list = await client.list(dir);
        client.close();

        return list
            .filter(f => f.type === 1) // file type
            .filter(f => {
                const ext = path.extname(f.name).toLowerCase();
                return ext === '.3mf' || ext === '.gcode';
            })
            .map(f => ({
                name: f.name,
                size: f.size,
                date: f.modifiedAt,
            }));

    } catch (err) {
        client.close();
        throw new Error(`FTP list failed: ${err.message}`);
    }
}

// ===== Extract 3MF =====

function extract3mf(buffer, plateNumber = null) {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    // Log entries เพื่อ debug
    const gcodeEntries = entries.filter(e => e.entryName.toLowerCase().endsWith('.gcode') && !e.isDirectory);
    console.log(`[3MF] G-code entries: ${gcodeEntries.map(e => e.entryName).join(', ')}`);

    // 1. ถ้ามี plateNumber → หา plate ที่ตรงกัน
    if (plateNumber != null) {
        const plateEntry = gcodeEntries.find(e => {
            const name = e.entryName.toLowerCase();
            return name.includes(`plate_${plateNumber}.gcode`) ||
                name.includes(`plate${plateNumber}.gcode`);
        });
        if (plateEntry) {
            console.log(`[3MF] ✅ ใช้ plate ${plateNumber}: ${plateEntry.entryName}`);
            return plateEntry.getData().toString('utf-8');
        }
        console.log(`[3MF] ⚠ ไม่พบ plate_${plateNumber} — fallback`);
    }

    // 2. Fallback: หา .gcode ตัวแรก
    if (gcodeEntries.length > 0) {
        console.log(`[3MF] ใช้ fallback: ${gcodeEntries[0].entryName}`);
        return gcodeEntries[0].getData().toString('utf-8');
    }

    throw new Error('ไม่พบ G-code ในไฟล์ .3mf');
}

module.exports = { tcpProbe, probeAndTest, downloadGcode, listFiles, extract3mf };
