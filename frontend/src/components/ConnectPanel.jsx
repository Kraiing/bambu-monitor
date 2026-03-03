import { useState, useEffect, useRef } from 'react';
import usePrinterStore from '../store/usePrinterStore';

const BACKEND_URL = `${window.location.protocol}//${window.location.host}`;

function BambuPrinterLogo({ size = 48 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="4" width="28" height="24" rx="3" fill="#1a1a2e" stroke="#00e5ff" strokeWidth="1.2" />
            <rect x="5" y="7" width="22" height="14" rx="2" fill="#0a0a16" stroke="rgba(0,229,255,0.4)" strokeWidth="0.8" />
            <line x1="7" y1="18" x2="25" y2="18" stroke="#00e5ff" strokeWidth="1.2" opacity="0.6" />
            <rect x="13" y="11" width="6" height="4" rx="1" fill="#2a2a3e" stroke="#00e5ff" strokeWidth="0.6" />
            <line x1="16" y1="15" x2="16" y2="17" stroke="#ff6633" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="16" cy="25" r="1.2" fill="#00e5ff" opacity="0.9" />
            <rect x="6" y="3" width="20" height="2.5" rx="1.2" fill="#1a1a2e" stroke="#00e5ff" strokeWidth="0.6" />
        </svg>
    );
}
const STORAGE_KEY = 'bambu_monitor_credentials';

// โหลดค่าที่บันทึกไว้จาก localStorage
function loadSavedCredentials() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return null;
}

// บันทึกค่าลง localStorage
function saveCredentials(ip, serial, accessCode) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ip, serial, accessCode }));
}

export default function ConnectPanel() {
    const saved = useRef(loadSavedCredentials());

    const [ip, setIp] = useState(saved.current?.ip || '');
    const [serial, setSerial] = useState(saved.current?.serial || '');
    const [accessCode, setAccessCode] = useState(saved.current?.accessCode || '');
    const [error, setError] = useState('');
    const [editMode, setEditMode] = useState(!saved.current); // ถ้ายังไม่เคยบันทึก → แสดงฟอร์ม
    const [autoConnecting, setAutoConnecting] = useState(false);

    const { connecting, setConnecting, setConnected, setStatus, setWs, setLayers } = usePrinterStore();
    const hasAutoConnected = useRef(false);

    // ===== ฟังก์ชันเชื่อมต่อหลัก =====
    const doConnect = async (creds) => {
        const { ip: connIp, serial: connSerial, accessCode: connAccessCode } = creds;
        setError('');

        if (!connIp || !connSerial || !connAccessCode) {
            setError('กรุณากรอกข้อมูลให้ครบทุกช่อง');
            setAutoConnecting(false);
            setConnecting(false);
            return;
        }

        setConnecting(true);

        try {
            const res = await fetch(`${BACKEND_URL}/api/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    printerIP: connIp,
                    serial: connSerial,
                    accessCode: connAccessCode,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'เชื่อมต่อไม่สำเร็จ');
            }

            // บันทึกค่าหลัง connect สำเร็จ
            saveCredentials(connIp, connSerial, connAccessCode);

            // เริ่มต้น WebSocket
            const wsUrl = `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}`;
            const ws = new WebSocket(wsUrl);

            let connectionTimeout = setTimeout(() => {
                // ถ้า 15 วินาทียังไม่ได้ข้อมูล MQTT → อาจผิด serial/accessCode
                const state = usePrinterStore.getState();
                if (!state.gcodeState && !state.nozzleTemp) {
                    setError('เชื่อมต่อได้ แต่ไม่ได้รับข้อมูลจากเครื่องพิมพ์ — ตรวจสอบ Serial Number หรือ Access Code');
                }
            }, 15000);

            ws.onopen = () => {
                console.log('[WS] เชื่อมต่อสำเร็จ');
                setWs(ws);
                setConnected(true);
                setAutoConnecting(false);
                setEditMode(false);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'status' && msg.data) {
                        clearTimeout(connectionTimeout);
                        setStatus(msg.data);
                    } else if (msg.type === 'layers' && msg.data) {
                        console.log(`[WS] ได้รับ layers: ${msg.data.totalLayers} layers`);
                        setLayers(msg.data);
                    } else if (msg.type === 'layerUpdate' && msg.data) {
                        usePrinterStore.getState().setStatus({
                            ...usePrinterStore.getState(),
                            layer: msg.data.currentLayer,
                        });
                    } else if (msg.type === 'mqttError' && msg.data) {
                        console.error('[WS] MQTT Error:', msg.data.error);
                        clearTimeout(connectionTimeout);
                        // วิเคราะห์ error เพื่อบอกผู้ใช้ให้ชัด
                        const errMsg = msg.data.error || '';
                        if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT') || errMsg.includes('ENOTFOUND')) {
                            setError('ไม่สามารถเชื่อมต่อเครื่องพิมพ์ — ตรวจสอบ IP Address ว่าถูกต้อง และเครื่องพิมพ์เปิดอยู่');
                        } else if (errMsg.includes('Not authorized') || errMsg.includes('auth') || errMsg.includes('credential')) {
                            setError('Access Code ไม่ถูกต้อง — กดแก้ไขเพื่อเปลี่ยน');
                        } else {
                            setError(`MQTT Error: ${errMsg}`);
                        }
                        usePrinterStore.setState({ mqttError: msg.data.error });
                    } else if (msg.type === 'info' && msg.data) {
                        console.log('[WS] Info:', msg.data.message);
                        usePrinterStore.setState({ infoMessage: msg.data.message });
                        setTimeout(() => {
                            usePrinterStore.setState({ infoMessage: null });
                        }, 8000);
                    } else if (msg.type === 'clearMqttError') {
                        const current = usePrinterStore.getState().mqttError;
                        if (current) {
                            usePrinterStore.setState({ mqttError: null });
                            setError('');
                        }
                    } else if (msg.type === 'capabilities' && msg.data) {
                        console.log('[WS] Capabilities:', msg.data);
                        usePrinterStore.setState({
                            autoLoadAvailable: msg.data.autoLoadAvailable,
                            ftpMode: msg.data.mode,
                            ftpCapabilities: {
                                ftps990: msg.data.ftps990,
                                ftp21: msg.data.ftp21,
                                printerIP: msg.data.printerIP,
                            },
                            ftpReason: msg.data.reason,
                        });
                    }
                } catch (err) {
                    // ข้ามข้อความที่ parse ไม่ได้
                }
            };

            ws.onerror = () => {
                setError('WebSocket เชื่อมต่อไม่สำเร็จ — ตรวจสอบว่า Server ทำงานอยู่');
                setConnecting(false);
                setAutoConnecting(false);
                clearTimeout(connectionTimeout);
            };

            ws.onclose = () => {
                console.log('[WS] ตัดการเชื่อมต่อ');
                clearTimeout(connectionTimeout);
            };

        } catch (err) {
            // Fetch ล้มเหลว → IP ผิด หรือ server ล่ม
            if (err.message === 'Failed to fetch') {
                setError('ไม่สามารถเชื่อมต่อ Server ได้ — ตรวจสอบ IP Address');
            } else {
                setError(err.message);
            }
            setConnecting(false);
            setAutoConnecting(false);
        }
    };

    // ===== Auto-Connect เมื่อเปิดหน้าเว็บ =====
    useEffect(() => {
        if (hasAutoConnected.current) return;
        if (saved.current?.ip && saved.current?.serial && saved.current?.accessCode) {
            hasAutoConnected.current = true;
            setAutoConnecting(true);
            doConnect(saved.current);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ===== Handle form submit =====
    const handleSubmit = (e) => {
        e.preventDefault();
        doConnect({ ip, serial, accessCode });
    };

    // ===== Handle แก้ไขค่า =====
    const handleEdit = () => {
        setEditMode(true);
        setError('');
    };

    // ===== UI: กำลัง Auto-Connect =====
    if (autoConnecting && !editMode) {
        return (
            <div className="connect-overlay">
                <div className="connect-panel" style={{ textAlign: 'center' }}>
                    <div className="connect-panel__logo">
                        <div className="connect-panel__logo-icon"><BambuPrinterLogo size={48} /></div>
                    </div>
                    <h1 className="connect-panel__title">Bambu Monitor</h1>
                    <p className="connect-panel__subtitle">กำลังเชื่อมต่ออัตโนมัติ...</p>

                    <div className="connect-panel__auto-status">
                        <div className="connect-panel__spinner"></div>
                        <p style={{ margin: '16px 0 4px', opacity: 0.7, fontSize: '0.85rem' }}>
                            {ip || saved.current?.ip}
                        </p>
                    </div>

                    {error && (
                        <>
                            <div className="connect-panel__error">⚠ {error}</div>
                            <button
                                className="connect-panel__btn connect-panel__btn--edit"
                                type="button"
                                onClick={handleEdit}
                            >
                                ✏️ แก้ไขการเชื่อมต่อ
                            </button>
                        </>
                    )}
                </div>
            </div>
        );
    }

    // ===== UI: ฟอร์มปกติ (ครั้งแรก หรือ กด "แก้ไข") =====
    return (
        <div className="connect-overlay">
            <form className="connect-panel" onSubmit={handleSubmit}>
                <div className="connect-panel__logo">
                    <div className="connect-panel__logo-icon"><BambuPrinterLogo size={48} /></div>
                </div>
                <h1 className="connect-panel__title">Bambu Monitor</h1>
                <p className="connect-panel__subtitle">Real-time 3D Print Visualization</p>

                {saved.current && (
                    <p style={{ fontSize: '0.8rem', opacity: 0.5, margin: '0 0 12px', textAlign: 'center' }}>
                        แก้ไขค่าที่ต้องการ แล้วกดเชื่อมต่อ
                    </p>
                )}

                <div className="connect-panel__field">
                    <label className="connect-panel__label">Printer IP Address</label>
                    <input
                        className="connect-panel__input"
                        type="text"
                        placeholder="192.168.1.xxx"
                        value={ip}
                        onChange={(e) => setIp(e.target.value)}
                        autoFocus
                    />
                </div>

                <div className="connect-panel__field">
                    <label className="connect-panel__label">Serial Number</label>
                    <input
                        className="connect-panel__input"
                        type="text"
                        placeholder="01P0xxxxxxxxxxxxx"
                        value={serial}
                        onChange={(e) => setSerial(e.target.value)}
                    />
                </div>

                <div className="connect-panel__field">
                    <label className="connect-panel__label">Access Code</label>
                    <input
                        className="connect-panel__input"
                        type="password"
                        placeholder="xxxxxxxx"
                        value={accessCode}
                        onChange={(e) => setAccessCode(e.target.value)}
                    />
                </div>

                <button
                    className="connect-panel__btn"
                    type="submit"
                    disabled={connecting}
                >
                    {connecting ? '⟳ กำลังเชื่อมต่อ...' : '▶ เชื่อมต่อเครื่องพิมพ์'}
                </button>

                {error && (
                    <div className="connect-panel__error">⚠ {error}</div>
                )}
            </form>
        </div>
    );
}
