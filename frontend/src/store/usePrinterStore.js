import { create } from 'zustand';
import tracker from './printProgressTracker';

const usePrinterStore = create((set, get) => ({
    // สถานะการเชื่อมต่อ
    connected: false,
    connecting: false,

    // ข้อมูลเครื่องพิมพ์จาก MQTT
    layer: null,
    totalLayers: null,
    nozzleTemp: null,
    nozzleTarget: null,
    bedTemp: null,
    bedTarget: null,
    progress: null,
    remainingTime: null,
    gcodeState: null,
    printSpeed: null,
    fanSpeed: null,
    auxFanSpeed: null,
    chamberFanSpeed: null,
    subtaskName: null,

    // ข้อมูลสีเส้นพิมพ์
    filamentColor: null,
    filamentType: null,

    // ข้อมูลชิ้นงานที่ข้าม
    skippedObjects: [],
    detectedObjects: [],      // unique object IDs จาก parsed G-code

    // G-code layers data
    layers: null,
    layerCumulativeTimes: null,  // เวลาสะสมต่อ layer (วินาที) จาก parser
    totalPrintTime: null,        // เวลาพิมพ์ทั้งหมดจาก parser (วินาที)
    printHeadPos: null,

    // FTP capabilities
    autoLoadAvailable: null,  // null=ยังไม่ทดสอบ, true/false
    ftpMode: null,            // 'ftps990', 'ftp21', หรือ null
    ftpCapabilities: null,    // { ftps990:{tcp,login,error}, ftp21:{tcp,login,error} }
    ftpReason: null,          // 'PORT_CLOSED_OR_BLOCKED', 'AUTH_OR_TLS', null
    gcodeCache: {},

    // ตั้งค่าผู้ใช้
    userFilamentColor: '#00e5ff',
    showEffects: true,
    settingsOpen: false,
    hudCollapsed: false,
    mqttError: null,
    infoMessage: null,
    uploading: false,

    // Camera preset
    cameraPreset: 'iso',

    // Temperature history (60 วินาที)
    tempHistory: [],

    // WebSocket instance
    ws: null,

    // ===== Actions =====
    setConnected: (connected) => set({ connected, connecting: false }),
    setConnecting: (connecting) => set({ connecting }),

    setStatus: (data) => {
        const state = get();
        // อัปเดตข้อมูลหลัก
        const updates = {
            layer: data.layer,
            totalLayers: data.totalLayers,
            nozzleTemp: data.nozzleTemp,
            nozzleTarget: data.nozzleTarget,
            bedTemp: data.bedTemp,
            bedTarget: data.bedTarget,
            progress: data.progress,
            remainingTime: data.remainingTime,
            gcodeState: data.gcodeState,
            printSpeed: data.printSpeed,
            fanSpeed: data.fanSpeed,
            auxFanSpeed: data.auxFanSpeed ?? state.auxFanSpeed,
            chamberFanSpeed: data.chamberFanSpeed ?? state.chamberFanSpeed,
            subtaskName: data.subtaskName,
            filamentColor: data.filamentColor ?? state.filamentColor,
            filamentType: data.filamentType ?? state.filamentType,
            skippedObjects: data.skippedObjects || [],
        };

        // อัปเดต temperature history
        if (data.nozzleTemp != null || data.bedTemp != null) {
            const now = Date.now();
            const newEntry = {
                time: now,
                nozzle: data.nozzleTemp ?? state.nozzleTemp,
                bed: data.bedTemp ?? state.bedTemp,
            };
            const cutoff = now - 60000; // 60 วินาที
            const history = [...state.tempHistory, newEntry].filter(e => e.time > cutoff);
            updates.tempHistory = history;
        }

        set(updates);

        // Feed MQTT data to progress tracker
        tracker.update(data);
    },

    setWs: (ws) => set({ ws }),
    setLayers: (data) => {
        // data can be full parser result { layers, layerCumulativeTimes, totalPrintTime }
        // or just layers array for backward compatibility
        if (Array.isArray(data)) {
            set({ layers: data });
        } else {
            // Extract unique object IDs จาก layers
            const objectIds = new Set();
            if (data.layers) {
                for (const layer of data.layers) {
                    for (const seg of layer) {
                        if (seg.objectId != null) {
                            objectIds.add(seg.objectId);
                        }
                    }
                }
            }

            set({
                layers: data.layers,
                layerCumulativeTimes: data.layerCumulativeTimes || null,
                totalPrintTime: data.totalPrintTime || null,
                detectedObjects: Array.from(objectIds).sort((a, b) => a - b),
            });
            // Feed timing data to tracker
            if (data.layerCumulativeTimes) {
                tracker.setTimingData(data.layerCumulativeTimes, data.totalPrintTime);
            }
        }
    },
    setPrintHeadPos: (pos) => set({ printHeadPos: pos }),
    setAutoLoadAvailable: (available) => set({ autoLoadAvailable: available }),
    setFtpMode: (mode) => set({ ftpMode: mode }),
    setUploading: (uploading) => set({ uploading }),
    cacheGcode: (name, layers) => set((state) => ({
        gcodeCache: { ...state.gcodeCache, [name]: layers }
    })),
    setUserFilamentColor: (color) => set({ userFilamentColor: color }),
    setShowEffects: (show) => set({ showEffects: show }),
    setSettingsOpen: (open) => set({ settingsOpen: open }),
    setHudCollapsed: (collapsed) => set({ hudCollapsed: collapsed }),
    setCameraPreset: (preset) => set({ cameraPreset: preset }),

    // ตัดการเชื่อมต่อ
    disconnect: () => {
        tracker.reset();
        set((state) => {
            if (state.ws) {
                state.ws.close();
            }
            return {
                connected: false,
                connecting: false,
                ws: null,
                layer: null,
                totalLayers: null,
                nozzleTemp: null,
                nozzleTarget: null,
                bedTemp: null,
                bedTarget: null,
                progress: null,
                remainingTime: null,
                gcodeState: null,
                printSpeed: null,
                fanSpeed: null,
                auxFanSpeed: null,
                chamberFanSpeed: null,
                subtaskName: null,
                filamentColor: null,
                filamentType: null,
                layers: null,
                layerCumulativeTimes: null,
                totalPrintTime: null,
                printHeadPos: null,
                tempHistory: [],
                autoLoadAvailable: null,
                ftpMode: null,
                ftpCapabilities: null,
                ftpReason: null,
                detectedObjects: [],
            };
        });
    },
}));

export default usePrinterStore;
