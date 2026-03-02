import { Component, useEffect, useState } from 'react';
import usePrinterStore from './store/usePrinterStore';
import ConnectPanel from './components/ConnectPanel';
import PrinterView3D from './components/PrinterView3D';
import HUD from './components/HUD';
import SettingsPanel from './components/SettingsPanel';

// Error Boundary สำหรับจับ React crash
class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary]', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: '40px',
                    background: '#0d0d12',
                    color: '#ff4466',
                    fontFamily: 'monospace',
                    minHeight: '100vh',
                }}>
                    <h1 style={{ color: '#00e5ff' }}>⚠️ Application Error</h1>
                    <pre style={{
                        background: '#1a1a24',
                        padding: '20px',
                        borderRadius: '8px',
                        overflow: 'auto',
                        color: '#ff6633',
                        fontSize: '13px',
                        lineHeight: '1.6',
                    }}>
                        {this.state.error?.message || 'Unknown error'}
                        {'\n\n'}
                        {this.state.error?.stack || ''}
                    </pre>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: '20px',
                            padding: '10px 24px',
                            background: '#00e5ff',
                            color: '#000',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 600,
                        }}
                    >
                        🔄 Reload
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

function AppContent() {
    const connected = usePrinterStore((s) => s.connected);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const handleDragOver = (e) => {
            e.preventDefault(); // ป้องกัน Browser เปิดไฟล์
            if (!isDragging) setIsDragging(true);
        };
        const handleDragLeave = (e) => {
            e.preventDefault();
            // ตรวจสอบว่าออกจาก window จริงๆ
            if (e.clientX === 0 && e.clientY === 0) {
                setIsDragging(false);
            }
        };
        const handleDrop = async (e) => {
            e.preventDefault(); // ป้องกัน Browser เปิดไฟล์
            setIsDragging(false);

            const file = e.dataTransfer.files?.[0];
            if (!file) return;

            const filename = file.name.toLowerCase();
            if (!filename.endsWith('.gcode') && !filename.endsWith('.3mf')) {
                usePrinterStore.setState({ infoMessage: 'รองรับเฉพาะไฟล์ .gcode หรือ .3mf' });
                setTimeout(() => usePrinterStore.setState({ infoMessage: null }), 5000);
                return;
            }

            usePrinterStore.setState({ uploading: true });
            try {
                const formData = new FormData();
                formData.append('file', file);
                const res = await fetch('/api/load-gcode', {
                    method: 'POST',
                    body: formData,
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                console.log(`[Upload] สำเร็จ: ${data.totalLayers} layers`);
            } catch (err) {
                console.error('[Upload] Error:', err.message);
                usePrinterStore.setState({ infoMessage: `❌ ${err.message}` });
                setTimeout(() => usePrinterStore.setState({ infoMessage: null }), 5000);
            } finally {
                usePrinterStore.setState({ uploading: false });
            }
        };

        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);

        return () => {
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('drop', handleDrop);
        };
    }, [isDragging]);

    return (
        <>
            {!connected && <ConnectPanel />}
            {connected && (
                <>
                    <PrinterView3D />
                    <HUD />
                    <SettingsPanel />
                </>
            )}

            {/* Global Drag & Drop Overlay */}
            {isDragging && (
                <div className="drag-drop-overlay">
                    <div className="drag-drop-box">
                        <div className="drag-drop-icon">📂</div>
                        <h3>วางไฟล์ G-code หรือ .3mf เพื่อแสดงผล</h3>
                        <p>ไฟล์จะถูกประมวลผลและแสดงขึ้นหน้าจอทันที</p>
                    </div>
                </div>
            )}
        </>
    );
}

export default function App() {
    return (
        <ErrorBoundary>
            <AppContent />
        </ErrorBoundary>
    );
}
