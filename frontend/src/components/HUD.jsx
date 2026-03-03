import { useMemo, useRef, useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import usePrinterStore from '../store/usePrinterStore';

const BACKEND_URL = `${window.location.protocol}//${window.location.host}`;

/**
 * Bambu Printer Icon — SVG แทน emoji 🖨️
 */
function BambuPrinterIcon({ size = 28 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Enclosure body */}
            <rect x="2" y="4" width="28" height="24" rx="3" fill="#1a1a2e" stroke="#00e5ff" strokeWidth="1.2" />
            {/* Glass door */}
            <rect x="5" y="7" width="22" height="14" rx="2" fill="#0a0a16" stroke="rgba(0,229,255,0.4)" strokeWidth="0.8" />
            {/* Build plate */}
            <line x1="7" y1="18" x2="25" y2="18" stroke="#00e5ff" strokeWidth="1.2" opacity="0.6" />
            {/* Print head (nozzle) */}
            <rect x="13" y="11" width="6" height="4" rx="1" fill="#2a2a3e" stroke="#00e5ff" strokeWidth="0.6" />
            <line x1="16" y1="15" x2="16" y2="17" stroke="#ff6633" strokeWidth="1.5" strokeLinecap="round" />
            {/* LED indicator */}
            <circle cx="16" cy="25" r="1.2" fill="#00e5ff" opacity="0.9" />
            {/* Top frame bar */}
            <rect x="6" y="3" width="20" height="2.5" rx="1.2" fill="#1a1a2e" stroke="#00e5ff" strokeWidth="0.6" />
        </svg>
    );
}

/**
 * แปลงเวลาที่เหลือ (นาที) เป็นรูปแบบ HH:MM
 */
function formatETA(minutes) {
    if (minutes == null || minutes < 0) return '--:--';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} `;
}

/**
 * หา label สำหรับ gcode state
 */
function stateLabel(state) {
    const map = {
        IDLE: 'ว่าง',
        PREPARE: 'กำลังเตรียม',
        RUNNING: 'กำลังพิมพ์',
        PAUSE: 'หยุดชั่วคราว',
        FINISH: 'เสร็จสิ้น',
        FAILED: 'ล้มเหลว',
        SLICING: 'กำลัง Slice',
    };
    return map[state] || state || '--';
}

function dotClass(state) {
    if (state === 'RUNNING') return 'hud__state-dot';
    if (state === 'PAUSE') return 'hud__state-dot hud__state-dot--paused';
    if (state === 'PREPARE') return 'hud__state-dot hud__state-dot--prepare';
    if (state === 'FINISH') return 'hud__state-dot hud__state-dot--finish';
    return 'hud__state-dot hud__state-dot--idle';
}

/**
 * Temperature Graph — Recharts LineChart
 */
function TempGraph() {
    const tempHistory = usePrinterStore((s) => s.tempHistory);

    const chartData = useMemo(() => {
        return tempHistory.map((entry, i) => ({
            time: i,
            nozzle: entry.nozzle ?? 0,
            bed: entry.bed ?? 0,
        }));
    }, [tempHistory]);

    if (chartData.length < 2) return null;

    return (
        <div className="hud__graph">
            <div className="hud__graph-title">📈 อุณหภูมิ (60 วินาที)</div>
            <ResponsiveContainer width="100%" height={80}>
                <LineChart data={chartData}>
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={[0, 'auto']} />
                    <Tooltip
                        contentStyle={{
                            background: 'rgba(13,13,18,0.95)',
                            border: '1px solid rgba(0,229,255,0.2)',
                            borderRadius: '8px',
                            fontSize: '11px',
                            color: '#e0e0e8',
                        }}
                        formatter={(value, name) => [
                            `${Math.round(value)}°C`,
                            name === 'nozzle' ? 'หัวฉีด' : 'เตียง'
                        ]}
                        labelFormatter={() => ''}
                    />
                    <Line
                        type="monotone"
                        dataKey="nozzle"
                        stroke="#ff6633"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                    />
                    <Line
                        type="monotone"
                        dataKey="bed"
                        stroke="#00e5ff"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                    />
                </LineChart>
            </ResponsiveContainer>
            <div className="hud__graph-legend">
                <span className="hud__graph-legend-item">
                    <span className="hud__graph-dot" style={{ background: '#ff6633' }} />
                    หัวฉีด
                </span>
                <span className="hud__graph-legend-item">
                    <span className="hud__graph-dot" style={{ background: '#00e5ff' }} />
                    เตียง
                </span>
            </div>
        </div>
    );
}

/**
 * Camera Preset Buttons
 */
function CameraButtons() {
    const cameraPreset = usePrinterStore((s) => s.cameraPreset);
    const setCameraPreset = usePrinterStore((s) => s.setCameraPreset);

    const presets = [
        { id: 'front', label: '🎯 Front' },
        { id: 'top', label: '⬇️ Top' },
        { id: 'iso', label: '🔲 Iso' },
        { id: 'free', label: '🖱️ Free' },
    ];

    return (
        <div className="hud__camera-buttons">
            {presets.map((p) => (
                <button
                    key={p.id}
                    className={`hud__camera - btn ${cameraPreset === p.id ? 'hud__camera-btn--active' : ''} `}
                    onClick={() => setCameraPreset(p.id)}
                >
                    {p.label}
                </button>
            ))}
        </div>
    );
}

/**
 * Fan Slider — slider ที่ใช้ local state เพื่อ UX ลื่น
 */
function FanSlider({ fan, value, onChange, disabled }) {
    const [localValue, setLocalValue] = useState(value ?? 0);
    const isDragging = useRef(false);

    useEffect(() => {
        if (!isDragging.current && value != null) {
            setLocalValue(value);
        }
    }, [value]);

    return (
        <>
            <input
                type="range"
                className="hud__fan-slider"
                min="0" max="100" step="5"
                value={localValue}
                onChange={(e) => {
                    isDragging.current = true;
                    setLocalValue(parseInt(e.target.value));
                }}
                onMouseUp={() => {
                    isDragging.current = false;
                    onChange(localValue);
                }}
                onTouchEnd={() => {
                    isDragging.current = false;
                    onChange(localValue);
                }}
                disabled={disabled}
            />
            <span className="hud__fan-value">
                {localValue}%
            </span>
        </>
    );
}

/**
 * Fan Control Panel — ควบคุมพัดลม Part Cooling / AUX / Chamber
 */
function FanControlPanel() {
    const fanSpeed = usePrinterStore((s) => s.fanSpeed);
    const auxFanSpeed = usePrinterStore((s) => s.auxFanSpeed);
    const chamberFanSpeed = usePrinterStore((s) => s.chamberFanSpeed);
    const connected = usePrinterStore((s) => s.connected);
    const [sending, setSending] = useState(false);

    if (!connected) return null;

    const toPercent = (val) => val != null ? Math.round((val / 255) * 100) : null;

    const handleFanChange = async (fan, percent) => {
        if (sending) return;
        setSending(true);
        try {
            const res = await fetch(`${BACKEND_URL}/api/control/fan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fan, speed: percent }),
            });
            if (!res.ok) {
                const data = await res.json();
                console.error('[Fan] Error:', data.error);
            }
        } catch (err) {
            console.error('[Fan] Request failed:', err.message);
        } finally {
            setSending(false);
        }
    };

    const fans = [
        { id: 'cooling', label: 'Cooling', icon: '💨', value: toPercent(fanSpeed) },
        { id: 'aux', label: 'AUX', icon: '🌀', value: toPercent(auxFanSpeed) },
    ];
    // Chamber fan เฉพาะ X1C/X1E — ซ่อนถ้าไม่มีข้อมูล
    if (chamberFanSpeed != null) {
        fans.push({ id: 'chamber', label: 'Chamber', icon: '🔄', value: toPercent(chamberFanSpeed) });
    }

    return (
        <div className="hud__fan-control">
            <div className="hud__fan-control-title">Fan Control</div>
            {fans.map((fan) => (
                <div key={fan.id} className="hud__fan-row">
                    <span className="hud__fan-icon">{fan.icon}</span>
                    <span className="hud__fan-label">{fan.label}</span>
                    <FanSlider
                        fan={fan.id}
                        value={fan.value}
                        onChange={(percent) => handleFanChange(fan.id, percent)}
                        disabled={sending}
                    />
                </div>
            ))}
        </div>
    );
}

/**
 * Skip Object Panel — ข้ามชิ้นงานระหว่างพิมพ์
 */
function SkipObjectPanel() {
    const detectedObjects = usePrinterStore((s) => s.detectedObjects);
    const skippedObjects = usePrinterStore((s) => s.skippedObjects);
    const gcodeState = usePrinterStore((s) => s.gcodeState);
    const connected = usePrinterStore((s) => s.connected);
    const [sending, setSending] = useState(false);

    if (!connected || gcodeState !== 'RUNNING' || detectedObjects.length === 0) {
        return null;
    }

    const handleSkip = async (objectId) => {
        if (sending) return;
        if (skippedObjects.includes(objectId)) return;

        const newSkipList = [...skippedObjects, objectId];

        setSending(true);
        try {
            const res = await fetch(`${BACKEND_URL}/api/control/skip-object`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ objectIds: newSkipList }),
            });
            if (!res.ok) {
                const data = await res.json();
                console.error('[Skip] Error:', data.error);
            }
        } catch (err) {
            console.error('[Skip] Request failed:', err.message);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="hud__skip-objects">
            <div className="hud__skip-objects-title">Skip Objects ({detectedObjects.length})</div>
            <div className="hud__skip-objects-list">
                {detectedObjects.map((objId) => {
                    const isSkipped = skippedObjects.includes(objId);
                    return (
                        <div
                            key={objId}
                            className={`hud__skip-object-item ${isSkipped ? 'hud__skip-object-item--skipped' : ''}`}
                        >
                            <span className="hud__skip-object-label">
                                Object #{objId}
                            </span>
                            <button
                                className={`hud__skip-object-btn ${isSkipped ? 'hud__skip-object-btn--skipped' : ''}`}
                                onClick={() => handleSkip(objId)}
                                disabled={sending || isSkipped}
                                title={isSkipped ? 'Already skipped' : 'Skip this object'}
                            >
                                {isSkipped ? '⏭️ Skipped' : '⏩ Skip'}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * FTP Status Panel + Upload — แสดงสถานะ FTP + Re-test + Upload fallback
 */
function FtpStatusPanel() {
    const autoLoadAvailable = usePrinterStore((s) => s.autoLoadAvailable);
    const ftpCapabilities = usePrinterStore((s) => s.ftpCapabilities);
    const ftpReason = usePrinterStore((s) => s.ftpReason);
    const ftpMode = usePrinterStore((s) => s.ftpMode);
    const layers = usePrinterStore((s) => s.layers);
    const uploading = usePrinterStore((s) => s.uploading);
    const connected = usePrinterStore((s) => s.connected);
    const fileRef = useRef(null);
    const [retesting, setRetesting] = useState(false);
    const [cooldown, setCooldown] = useState(0);

    // Cooldown timer
    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
        return () => clearTimeout(timer);
    }, [cooldown]);

    // ซ่อนถ้ามี layers แล้ว (ไม่ต้องแสดง)
    if (layers) return null;
    // ซ่อนถ้ายังไม่ connected
    if (!connected) return null;
    // ซ่อนถ้า FTP available (inline card จัดการแล้ว — ป้องกัน AUTO-LOAD แสดง 2 ครั้ง)
    if (autoLoadAvailable) return null;

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        usePrinterStore.setState({ uploading: true });
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${BACKEND_URL} /api/load - gcode`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            console.log(`[Upload] สำเร็จ: ${data.totalLayers} layers`);
        } catch (err) {
            console.error('[Upload] Error:', err.message);
            usePrinterStore.setState({ infoMessage: `❌ ${err.message} ` });
            setTimeout(() => usePrinterStore.setState({ infoMessage: null }), 5000);
        } finally {
            usePrinterStore.setState({ uploading: false });
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const handleRetest = async () => {
        setRetesting(true);
        try {
            await fetch(`${BACKEND_URL} /api/retest - ftp`, { method: 'POST' });
        } catch (err) {
            console.error('[Retest]', err);
        }
        setRetesting(false);
        setCooldown(10);
    };

    const isPortClosed = ftpReason === 'PORT_CLOSED_OR_BLOCKED';
    const isAuthError = ftpReason === 'AUTH_OR_TLS';

    return (
        <div className="ftp-status">
            {/* AUTO-LOAD Status */}
            <div className="ftp-status__header">
                <span className={`ftp - status__badge ${autoLoadAvailable ? 'ftp-status__badge--on' : 'ftp-status__badge--off'} `}>
                    {autoLoadAvailable === null ? '⏳ กำลังทดสอบ FTP...' :
                        autoLoadAvailable ? `✅ AUTO - LOAD ${ftpMode?.toUpperCase()} ` :
                            '❌ AUTO-LOAD OFF'}
                </span>
            </div>

            {/* Per-port detail */}
            {ftpCapabilities && !autoLoadAvailable && (
                <div className="ftp-status__detail">
                    <div className="ftp-status__port">
                        <span>{ftpCapabilities.ftps990?.tcp ? '🟢' : '🔴'} Port 990:</span>
                        <span>{ftpCapabilities.ftps990?.tcp ?
                            (ftpCapabilities.ftps990?.login ? 'Login ✅' : `TCP OK, Login ❌`) :
                            'Closed'
                        }</span>
                    </div>
                    <div className="ftp-status__port">
                        <span>{ftpCapabilities.ftp21?.tcp ? '🟢' : '🔴'} Port 21:</span>
                        <span>{ftpCapabilities.ftp21?.tcp ?
                            (ftpCapabilities.ftp21?.login ? 'Login ✅' : `TCP OK, Login ❌`) :
                            'Closed'
                        }</span>
                    </div>

                    {/* Reason + Diagnostic */}
                    {isPortClosed && (
                        <div className="ftp-status__diag">
                            <div className="ftp-status__reason">⚠️ ทั้ง 2 พอร์ตถูกปิดหรือบล็อก</div>
                            <div className="ftp-status__cmd-title">ทดสอบบน PowerShell:</div>
                            <code className="ftp-status__cmd">Test-NetConnection {ftpCapabilities.printerIP || '<IP>'} -Port 990</code>
                            <code className="ftp-status__cmd">Test-NetConnection {ftpCapabilities.printerIP || '<IP>'} -Port 21</code>
                        </div>
                    )}
                    {isAuthError && (
                        <div className="ftp-status__diag">
                            <div className="ftp-status__reason">⚠️ TCP เชื่อมต่อได้ แต่ TLS/Auth ล้มเหลว</div>
                            <div className="ftp-status__hint">ตรวจสอบ Access Code ว่าถูกต้อง</div>
                        </div>
                    )}
                </div>
            )}

            {/* Re-test button */}
            {!autoLoadAvailable && autoLoadAvailable !== null && (
                <button
                    className="ftp-status__retest-btn"
                    onClick={handleRetest}
                    disabled={retesting || cooldown > 0}
                >
                    {retesting ? '⏳ กำลังทดสอบ...' :
                        cooldown > 0 ? `รอ ${cooldown} s` :
                            '🔄 Re-test FTP'}
                </button>
            )}

            {/* Upload fallback */}
            {!autoLoadAvailable && autoLoadAvailable !== null && (
                <div className="ftp-status__upload">
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".gcode,.3mf"
                        onChange={handleUpload}
                        style={{ display: 'none' }}
                        id="gcode-upload"
                    />
                    <button
                        className="hud__upload-btn"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                    >
                        {uploading ? '⏳ อัปโหลด...' : '📤 อัปโหลด G-code'}
                    </button>
                    <div className="ftp-status__hint">รองรับ .gcode และ .3mf</div>
                </div>
            )}
        </div>
    );
}

export default function HUD() {
    const {
        layer,
        totalLayers,
        nozzleTemp,
        nozzleTarget,
        bedTemp,
        bedTarget,
        progress,
        remainingTime,
        gcodeState,
        subtaskName,
        filamentColor,
        filamentType,
        layers,
        disconnect,
        hudCollapsed,
        setHudCollapsed,
        setSettingsOpen,
        mqttError,
        infoMessage,
        ftpMode, // Added ftpMode here
    } = usePrinterStore();

    const fileInputRef = useRef(null); // Added fileInputRef

    const handleDisconnect = async () => {
        try {
            await fetch(`${BACKEND_URL} /api/disconnect`, { method: 'POST' });
        } catch (e) {
            // ไม่เป็นไร
        }
        disconnect();
    };

    // Placeholder for onDrop function, assuming it exists elsewhere or needs to be defined
    // This function would handle the file upload logic, similar to FtpStatusPanel's handleUpload
    const onDrop = async (event) => {
        event.preventDefault();
        const files = event.dataTransfer?.items
            ? Array.from(event.dataTransfer.items)
                .filter(item => item.kind === 'file')
                .map(item => item.getAsFile())
            : Array.from(event.dataTransfer?.files || []);

        const file = files[0];
        if (!file) return;

        usePrinterStore.setState({ uploading: true });
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${BACKEND_URL} /api/load - gcode`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            console.log(`[Upload] สำเร็จ: ${data.totalLayers} layers`);
            usePrinterStore.setState({ infoMessage: `✅ อัปโหลดสำเร็จ: ${file.name} ` });
        } catch (err) {
            console.error('[Upload] Error:', err.message);
            usePrinterStore.setState({ infoMessage: `❌ ${err.message} ` });
        } finally {
            usePrinterStore.setState({ uploading: false });
            setTimeout(() => usePrinterStore.setState({ infoMessage: null }), 5000);
        }
    };

    const onDragOver = (event) => {
        event.preventDefault();
    };

    return (
        <div className="hud" onDrop={onDrop} onDragOver={onDragOver}> {/* Added onDrop and onDragOver */}
            {/* ===== Header ===== */}
            <div className="hud__header">
                <div className="hud__brand">
                    <span className="hud__brand-icon"><BambuPrinterIcon size={28} /></span>
                    <span className="hud__brand-name">Bambu Monitor</span>
                </div>

                {/* สีเส้นพิมพ์ */}
                {filamentColor && (
                    <div className="hud__filament">
                        <div
                            className="hud__filament-swatch"
                            style={{ backgroundColor: filamentColor }}
                        />
                        <span className="hud__filament-label">
                            {filamentType || 'Filament'}
                        </span>
                    </div>
                )}

                {/* ปุ่มต่างๆ */}
                <div className="hud__header-actions">
                    <div className="hud__state-badge">
                        <span className={dotClass(gcodeState)} />
                        <span>{stateLabel(gcodeState)}</span>
                    </div>

                    {/* Settings button */}
                    <button
                        className="hud__icon-btn"
                        onClick={() => setSettingsOpen(true)}
                        title="ตั้งค่า"
                    >
                        ⚙️
                    </button>

                    {/* Hamburger menu (mobile) */}
                    <button
                        className="hud__hamburger"
                        onClick={() => setHudCollapsed(!hudCollapsed)}
                    >
                        {hudCollapsed ? '☰' : '✕'}
                    </button>

                    <button className="hud__disconnect-btn" onClick={handleDisconnect}>
                        ✕ ตัดการเชื่อมต่อ
                    </button>
                </div>
            </div>

            {/* ===== Camera Buttons (มุมขวาบน ใต้ header) ===== */}
            <CameraButtons />

            {/* ===== MQTT Error Banner ===== */}
            {mqttError && (
                <div className="hud__error-banner">
                    ⚠️ MQTT Error: {mqttError}
                </div>
            )}

            {/* ===== Info Banner (auto-load / upload status) ===== */}
            {infoMessage && (
                <div className={`hud__info - banner ${infoMessage.includes('❌') || infoMessage.toLowerCase().includes('error') || infoMessage.toLowerCase().includes('fail')
                        ? 'hud__info-banner--error'
                        : 'hud__info-banner--neutral'
                    } `}>
                    {infoMessage}
                </div>
            )}

            {/* ===== Stats Panel (ล่างซ้าย) ===== */}
            <div className={`hud__stats ${hudCollapsed ? 'hud__stats--collapsed' : ''} `}>
                {/* Layer */}
                <div className="hud__stat-card">
                    <div className="hud__stat-icon">📐</div>
                    <div className="hud__stat-info">
                        <div className="hud__stat-label">Layer</div>
                        <div className="hud__stat-value hud__stat-value--accent">
                            {layer ?? '--'} / {totalLayers ?? layers?.length ?? '--'}
                        </div>
                    </div>
                </div>

                {/* อุณหภูมิหัวฉีด */}
                <div className="hud__stat-card">
                    <div className="hud__stat-icon">🔥</div>
                    <div className="hud__stat-info">
                        <div className="hud__stat-label">หัวฉีด (Nozzle)</div>
                        <div className="hud__stat-value">
                            {nozzleTemp != null ? `${nozzleTemp}°C` : '--'}
                            {nozzleTarget != null && (
                                <span style={{ color: '#555570', fontSize: '12px' }}>
                                    {' '}/ {nozzleTarget}°C
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* อุณหภูมิเตียง */}
                <div className="hud__stat-card">
                    <div className="hud__stat-icon">🛏️</div>
                    <div className="hud__stat-info">
                        <div className="hud__stat-label">เตียงพิมพ์ (Bed)</div>
                        <div className="hud__stat-value">
                            {bedTemp != null ? `${bedTemp}°C` : '--'}
                            {bedTarget != null && (
                                <span style={{ color: '#555570', fontSize: '12px' }}>
                                    {' '}/ {bedTarget}°C
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* FTP Mode Indicator & Manual Upload */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', pointerEvents: 'auto' }}>
                    <div className={`hud__stat - card ${ftpMode ? 'hud__stat-card--active' : 'hud__stat-card--disabled'} `}
                        style={{ padding: '8px 12px', flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className="hud__stat-icon" style={{ fontSize: '12px' }}>
                                {ftpMode ? '✅' : '⏳'}
                            </div>
                            <div style={{
                                fontSize: '10px', fontWeight: 'bold', letterSpacing: '1px',
                                color: ftpMode ? '#00e5ff' : '#aaaaaa'
                            }}>
                                {ftpMode ? `AUTO - LOAD ${ftpMode?.toUpperCase()} ` : 'กำลังทดสอบ FTP...'}
                            </div>
                        </div>
                    </div>
                    {/* ปุ่มอัปโหลดแมนนวลสำหรับมือถือ/HA */}
                    <button
                        className="hud__settings-btn"
                        onClick={() => fileInputRef.current?.click()}
                        style={{ padding: '8px 12px', height: '100%', fontSize: '16px' }}
                        title="อัปโหลดไฟล์ 3MF/G-code แบบแมนนวล (สำหรับมือถือ/Cloud Print)"
                    >
                        📁
                    </button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        accept=".3mf,.gcode"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                                // จำลอง Event เหมือนการ Drag & Drop
                                const fakeEvent = {
                                    preventDefault: () => { },
                                    dataTransfer: { items: [{ getAsFile: () => file, kind: 'file' }] }
                                };
                                onDrop(fakeEvent);
                            }
                        }}
                    />
                </div>

                {/* ชื่องาน */}
                {subtaskName && (
                    <div className="hud__stat-card">
                        <div className="hud__stat-icon">📄</div>
                        <div className="hud__stat-info">
                            <div className="hud__stat-label">งานพิมพ์</div>
                            <div className="hud__stat-value" style={{ fontSize: '12px' }}>
                                {subtaskName}
                            </div>
                        </div>
                    </div>
                )}

                {/* G-code layers info */}
                {layers && (
                    <div className="hud__stat-card">
                        <div className="hud__stat-icon">📦</div>
                        <div className="hud__stat-info">
                            <div className="hud__stat-label">G-code Layers</div>
                            <div className="hud__stat-value hud__stat-value--accent">
                                {layers.length} layers
                            </div>
                        </div>
                    </div>
                )}

                {/* ปุ่มอัปโหลด G-code (แสดงเมื่อ auto-load ไม่พร้อม) */}
                <FtpStatusPanel />

                {/* Temperature Graph */}
                <TempGraph />

                {/* Fan Control */}
                <FanControlPanel />

                {/* Skip Object */}
                <SkipObjectPanel />
            </div>

            {/* ===== Progress Panel (ล่างขวา) ===== */}
            <div className={`hud__progress - panel ${hudCollapsed ? 'hud__progress-panel--collapsed' : ''} `}>
                <div className="hud__progress-header">
                    <span className="hud__progress-title">ความคืบหน้า</span>
                    <span className="hud__progress-percent">
                        {progress != null ? `${progress}% ` : '--%'}
                    </span>
                </div>

                <div className="hud__progress-bar">
                    <div
                        className="hud__progress-fill"
                        style={{ width: `${progress ?? 0}% ` }}
                    />
                </div>

                <div className="hud__progress-detail">
                    <span className="hud__progress-detail-icon">⏱️</span>
                    <span>เวลาที่เหลือ: {formatETA(remainingTime)}</span>
                </div>
            </div>
        </div>
    );
}
