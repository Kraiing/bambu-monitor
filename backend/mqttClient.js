const mqtt = require('mqtt');

let client = null;
let latestStatus = null;
let lastFilamentLog = null;

/**
 * เชื่อมต่อ MQTT กับ Bambu Lab P2S ผ่าน TLS (port 8883)
 * @param {Object} config - { printerIP, serial, accessCode }
 * @param {Function} onData - callback เมื่อได้รับข้อมูลใหม่
 * @param {Function} onError - callback เมื่อเกิด error
 * @returns {Object} mqtt client instance
 */
function connect(config, onData, onError) {
  const { printerIP, serial, accessCode } = config;

  // ปิดการเชื่อมต่อเก่า (ถ้ามี)
  if (client) {
    client.end(true);
    client = null;
  }

  const brokerUrl = `mqtts://${printerIP}:8883`;
  const topic = `device/${serial}/report`;

  console.log(`[MQTT] กำลังเชื่อมต่อ ${brokerUrl}...`);

  client = mqtt.connect(brokerUrl, {
    username: 'bblp',
    password: accessCode,
    rejectUnauthorized: false, // Bambu ใช้ self-signed cert
    clientId: `bambu_monitor_${Date.now()}`,
    connectTimeout: 10000,
    keepalive: 30,
    reconnectPeriod: 5000, // ลอง reconnect ทุก 5 วินาที
    protocolVersion: 4, // MQTT v3.1.1
  });

  console.log(`[MQTT] Config: username=bblp, accessCode=${accessCode ? accessCode.substring(0, 2) + '***' : 'EMPTY'}, serial=${serial}`);

  client.on('connect', () => {
    console.log(`[MQTT] เชื่อมต่อสำเร็จ!`);
    client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) {
        console.error(`[MQTT] Subscribe ผิดพลาด:`, err.message);
      } else {
        console.log(`[MQTT] Subscribe topic: ${topic}`);
      }
    });
  });

  client.on('message', (receivedTopic, message) => {
    try {
      const raw = JSON.parse(message.toString());
      const print = raw?.print;

      if (!print) return;

      // ดึงข้อมูลสีเส้นพิมพ์จาก AMS
      let filamentColor = null;
      let filamentType = null;

      // Bambu MQTT: ams_mapping บอกว่า tray ไหนที่กำลังใช้
      // ams_mapping = [tray_global_id] เช่น [0] = AMS unit 0, slot 0
      const activeTrayId = print.ams?.tray_now != null
        ? parseInt(print.ams.tray_now)
        : (print.ams_mapping?.[0] ?? null);

      if (print.ams && print.ams.ams && activeTrayId != null) {
        const amsList = print.ams.ams;
        // Bambu tray_now: 0-3 = AMS unit 0, 4-7 = AMS unit 1, etc.
        const targetUnit = Math.floor(activeTrayId / 4);
        const targetSlot = activeTrayId % 4;

        for (const amsUnit of amsList) {
          const unitId = parseInt(amsUnit.id ?? '0');
          if (unitId === targetUnit && amsUnit.tray) {
            for (const tray of amsUnit.tray) {
              const slotId = parseInt(tray.id ?? '0');
              if (slotId === targetSlot) {
                if (tray.tray_color) {
                  filamentColor = '#' + tray.tray_color.substring(0, 6);
                }
                filamentType = tray.tray_type || null;
                break;
              }
            }
          }
        }

        if (filamentColor && (!lastFilamentLog || Date.now() - lastFilamentLog > 30000)) {
          console.log(`[MQTT] Filament: ${filamentType} ${filamentColor} (tray ${activeTrayId})`);
          lastFilamentLog = Date.now();
        }
      }

      // ถ้าไม่เจอจาก AMS ลองดูจาก vt_tray (external spool)
      if (!filamentColor && print.vt_tray) {
        if (print.vt_tray.tray_color) {
          filamentColor = '#' + print.vt_tray.tray_color.substring(0, 6);
        }
        filamentType = print.vt_tray.tray_type || filamentType;
        if (filamentColor && (!lastFilamentLog || Date.now() - lastFilamentLog > 30000)) {
          console.log(`[MQTT] Filament (vt_tray): ${filamentType} ${filamentColor}`);
          lastFilamentLog = Date.now();
        }
      }

      // Normalize ข้อมูล
      const normalized = {
        layer: print.layer_num ?? null,
        totalLayers: print.total_layer_num ?? null,
        nozzleTemp: print.nozzle_temper ?? null,
        nozzleTarget: print.nozzle_target_temper ?? null,
        bedTemp: print.bed_temper ?? null,
        bedTarget: print.bed_target_temper ?? null,
        progress: print.mc_percent ?? null,
        remainingTime: print.mc_remaining_time ?? null,
        gcodeState: print.gcode_state ?? null,
        printSpeed: print.spd_lvl ?? null,
        fanSpeed: print.cooling_fan_speed ?? null,
        wifiSignal: print.wifi_signal ?? null,
        subtaskName: print.subtask_name ?? null,
        gcodeFile: print.gcode_file ?? null,     // full path, e.g. "/sdcard/xxx.gcode.3mf"
        subtaskId: print.subtask_id ?? null,
        filamentColor: filamentColor,
        filamentType: filamentType,
        skippedObjects: print.s_obj ?? [],       // Array of skipped object IDs
        timestamp: Date.now(),
      };

      latestStatus = normalized;

      if (onData) {
        onData(normalized);
      }
    } catch (err) {
      // ข้อความที่ไม่ใช่ JSON จะถูกข้ามไป
    }
  });

  client.on('error', (err) => {
    console.error(`[MQTT] Error:`, err.message);
    if (onError) {
      onError(err.message);
    }
  });

  client.on('close', () => {
    console.log(`[MQTT] การเชื่อมต่อถูกปิด`);
  });

  client.on('offline', () => {
    console.log(`[MQTT] ออฟไลน์`);
  });

  return client;
}

/**
 * ปิดการเชื่อมต่อ MQTT
 */
function disconnect() {
  if (client) {
    client.end(true);
    client = null;
    console.log(`[MQTT] ตัดการเชื่อมต่อแล้ว`);
  }
}

/**
 * ดึงข้อมูลสถานะล่าสุด
 */
function getLatestStatus() {
  return latestStatus;
}

/**
 * ตรวจสอบสถานะการเชื่อมต่อ
 */
function isConnected() {
  return client && client.connected;
}

module.exports = { connect, disconnect, getLatestStatus, isConnected };
