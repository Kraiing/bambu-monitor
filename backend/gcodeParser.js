/**
 * G-code Parser — v5 with Feedrate Timing
 * 
 * Layer detection strategies (ตามลำดับความน่าเชื่อถือ):
 * 1. ;LAYER_CHANGE comment (Bambu/Prusa)
 * 2. ;Z:[number] comment (Bambu alternative)  
 * 3. Z-height tracking: layer ใหม่ = extrusion ที่ Z สูงกว่า maxExtrudeZ + threshold
 *    (Z-hop = Z ขึ้นลงโดยไม่ extrude ไม่นับ)
 * 
 * NEW: คำนวณ timing ต่อ segment จาก feedrate (F parameter)
 *   → layerCumulativeTimes[i] = เวลารวมจนจบ layer i (วินาที)
 *   → totalPrintTime = เวลาพิมพ์ทั้งหมด (วินาที)
 */

function parse(gcodeText) {
    const lines = gcodeText.split('\n');
    const totalLines = lines.length;

    // === Pass 1: Detect which strategy to use ===
    let hasLayerChange = false;
    let hasZComment = false;
    const scanLimit = Math.min(totalLines, 100000);

    for (let i = 0; i < scanLimit; i++) {
        const t = lines[i].trim();
        if (t === ';LAYER_CHANGE') { hasLayerChange = true; break; }
        if (t.startsWith(';Z:')) { hasZComment = true; }
    }

    // Detect extrusion mode from first 2000 lines
    let relativeE = false;
    for (let i = 0; i < Math.min(totalLines, 2000); i++) {
        const t = lines[i].trim();
        if (t === 'M83') { relativeE = true; break; }
        if (t === 'M82') { relativeE = false; break; }
    }

    const strategy = hasLayerChange ? 'LAYER_CHANGE' : hasZComment ? 'Z_COMMENT' : 'Z_HEIGHT';
    console.log(`[Parser] Strategy: ${strategy}, E-mode: ${relativeE ? 'relative' : 'absolute'}`);

    // === Parse state ===
    let x = 0, y = 0, z = 0, e = 0;
    let feedrate = 1800; // default 30mm/s (1800 mm/min)
    let currentLayer = [];
    let currentLayerTime = 0; // เวลาสะสมทั้ง layer ปัจจุบัน (วินาที)
    let currentObjectId = null; // Object ID tracking
    const layers = [];
    const layerTimes = []; // เวลาของแต่ละ layer (วินาที)

    // Z-HEIGHT mode state
    let maxExtrudeZ = -Infinity;
    let retractedAmount = 0;      // tracks pending deretraction
    let postRetractSkip = 0;      // skip N extrusion segments after deretraction

    const MIN_E = 0.002;
    const MIN_E_PER_MM = 0.02;    // minimum extrusion per mm (filters wipe/travel)
    const MIN_DIST_SQ = 0.0001;
    const LAYER_DZ = 0.04;
    const POST_RETRACT_SKIP = 1;  // skip 1 segment after deretract (run-up/priming)

    const bounds = {
        minX: Infinity, maxX: -Infinity,
        minY: Infinity, maxY: -Infinity,
        minZ: Infinity, maxZ: -Infinity,
    };

    const pushLayer = () => {
        if (currentLayer.length > 0) {
            layers.push(currentLayer);
            layerTimes.push(currentLayerTime);
            currentLayer = [];
            currentLayerTime = 0;
        }
    };

    // === Pass 2: Parse ===
    for (let i = 0; i < totalLines; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // --- Extrusion mode switches ---
        if (line === 'M83') { relativeE = true; continue; }
        if (line === 'M82') { relativeE = false; continue; }

        // --- Comments ---
        if (line.startsWith(';')) {
            if (strategy === 'LAYER_CHANGE' && line === ';LAYER_CHANGE') {
                pushLayer();
            } else if (strategy === 'Z_COMMENT' && line.startsWith(';Z:')) {
                pushLayer();
            }

            // Exclude Object Label Tracking
            // Bambu Studio specific: "; start printing object, unique label id: 970"
            if (line.startsWith('; start printing object, unique label id:')) {
                const match = line.match(/id:\s*(\d+)/);
                if (match) currentObjectId = parseInt(match[1], 10);
            } else if (line.startsWith('; stop printing object,')) {
                currentObjectId = null;
            }
            continue;
        }

        // --- G commands ---
        const semi = line.indexOf(';');
        const cmdStr = semi >= 0 ? line.substring(0, semi) : line;
        const parts = cmdStr.trim().split(/\s+/);
        const cmd = parts[0]?.toUpperCase();

        if (cmd === 'G28') { x = 0; y = 0; z = 0; e = 0; continue; }

        if (cmd === 'G92') {
            for (let j = 1; j < parts.length; j++) {
                const p = parts[j].toUpperCase();
                if (p[0] === 'X') x = parseFloat(p.slice(1)) || 0;
                else if (p[0] === 'Y') y = parseFloat(p.slice(1)) || 0;
                else if (p[0] === 'Z') z = parseFloat(p.slice(1)) || 0;
                else if (p[0] === 'E') e = parseFloat(p.slice(1)) || 0;
            }
            continue;
        }

        if (cmd !== 'G0' && cmd !== 'G1' && cmd !== 'G2' && cmd !== 'G3') continue;

        // Parse G0/G1/G2/G3 parameters
        const fx = x, fy = y, fz = z;
        let newE = e;
        let hasXY = false, hasE = false, hasF = false;
        let iOffset = 0, jOffset = 0;

        for (let j = 1; j < parts.length; j++) {
            const p = parts[j].toUpperCase();
            const val = parseFloat(p.slice(1));
            if (isNaN(val)) continue;
            if (p[0] === 'X') { x = val; hasXY = true; }
            else if (p[0] === 'Y') { y = val; hasXY = true; }
            else if (p[0] === 'Z') { z = val; }
            else if (p[0] === 'E') { newE = val; hasE = true; }
            else if (p[0] === 'F') { feedrate = val; hasF = true; }
            else if (p[0] === 'I') { iOffset = val; }
            else if (p[0] === 'J') { jOffset = val; }
        }

        // Extrusion amount — track retraction/deretraction
        let dE = 0;
        if (hasE) {
            const rawDE = relativeE ? newE : newE - e;
            if (rawDE < 0) {
                retractedAmount += Math.abs(rawDE);
                dE = 0;
            } else {
                if (retractedAmount > 0) {
                    const deretract = Math.min(rawDE, retractedAmount);
                    retractedAmount -= deretract;
                    dE = rawDE - deretract;
                    // Deretraction เสร็จสมบูรณ์ + ไม่มี real extrusion
                    // → segment ถัดไปคือ run-up/priming → ให้ skip
                    if (retractedAmount === 0 && dE < MIN_E) {
                        postRetractSkip = POST_RETRACT_SKIP;
                    }
                } else {
                    dE = rawDE;
                }
            }
        }
        if (!relativeE) e = newE;

        const isExtrude = dE > MIN_E && hasXY;

        // === Z-HEIGHT layer detection ===
        if (strategy === 'Z_HEIGHT' && isExtrude) {
            if (z > maxExtrudeZ + LAYER_DZ) {
                pushLayer();
                maxExtrudeZ = z;
            } else if (z > maxExtrudeZ) {
                maxExtrudeZ = z;
            }
        }

        // === Store extrusion segment + compute time ===
        if (isExtrude) {
            // Check if it's an arc move (G2/G3)
            if (cmd === 'G2' || cmd === 'G3') {
                const isCw = cmd === 'G2';
                const cx = fx + iOffset;
                const cy = fy + jOffset;

                let angleA = Math.atan2(fy - cy, fx - cx);
                let angleB = Math.atan2(y - cy, x - cx);

                // Adjust angles based on direction
                if (isCw) {
                    if (angleB >= angleA) angleB -= 2 * Math.PI;
                } else {
                    if (angleB <= angleA) angleB += 2 * Math.PI;
                }

                // If start and end are identical (full circle)
                if (angleA === angleB && (x !== fx || y !== fy) === false) {
                    angleB += isCw ? -2 * Math.PI : 2 * Math.PI;
                }

                const angularDist = Math.abs(angleB - angleA);
                const radius = Math.sqrt(iOffset * iOffset + jOffset * jOffset);
                const arcLength = radius * angularDist;

                // Interpolate into segments (approx 1mm resolution)
                const numSegments = Math.max(1, Math.ceil(arcLength / 1.0));
                const totalE = dE;
                const dz = z - fz;

                // Add bounding box for start point of arc
                bounds.minX = Math.min(bounds.minX, fx); bounds.maxX = Math.max(bounds.maxX, fx);
                bounds.minY = Math.min(bounds.minY, fy); bounds.maxY = Math.max(bounds.maxY, fy);
                bounds.minZ = Math.min(bounds.minZ, fz); bounds.maxZ = Math.max(bounds.maxZ, fz);

                for (let step = 1; step <= numSegments; step++) {
                    const t = step / numSegments;
                    const cAngle = angleA + t * (angleB - angleA);

                    const segFx = step === 1 ? fx : cx + radius * Math.cos(angleA + ((step - 1) / numSegments) * (angleB - angleA));
                    const segFy = step === 1 ? fy : cy + radius * Math.sin(angleA + ((step - 1) / numSegments) * (angleB - angleA));
                    const segFz = fz + ((step - 1) / numSegments) * dz;

                    const segTx = cx + radius * Math.cos(cAngle);
                    const segTy = cy + radius * Math.sin(cAngle);
                    const segTz = fz + t * dz;

                    const segDx = segTx - segFx;
                    const segDy = segTy - segFy;
                    const segDist = Math.sqrt(segDx * segDx + segDy * segDy + (segTz - segFz) * (segTz - segFz));

                    // Filter wipe moves
                    if ((totalE / numSegments) / segDist < MIN_E_PER_MM) continue;

                    if (postRetractSkip > 0) {
                        postRetractSkip--;
                        continue;
                    }

                    currentLayer.push({
                        from: { x: segFx, y: segFy, z: segFz },
                        to: { x: segTx, y: segTy, z: segTz },
                        objectId: currentObjectId,
                    });

                    const speed = feedrate / 60;
                    currentLayerTime += (speed > 0 ? segDist / speed : 0);

                    bounds.minX = Math.min(bounds.minX, segTx); bounds.maxX = Math.max(bounds.maxX, segTx);
                    bounds.minY = Math.min(bounds.minY, segTy); bounds.maxY = Math.max(bounds.maxY, segTy);
                    bounds.minZ = Math.min(bounds.minZ, segTz); bounds.maxZ = Math.max(bounds.maxZ, segTz);
                }
            } else {
                // Standard G0/G1 Linear move
                const dx = x - fx, dy = y - fy;
                const distSq = dx * dx + dy * dy;

                if (distSq > MIN_DIST_SQ) {
                    const dz = z - fz;
                    const dist = Math.sqrt(distSq + dz * dz);

                    // Filter out wipe/travel moves with very low extrusion density
                    if (dE / dist < MIN_E_PER_MM) continue;

                    // Skip first N segments after deretraction (run-up/priming)
                    if (postRetractSkip > 0) {
                        postRetractSkip--;
                        continue;
                    }

                    currentLayer.push({
                        from: { x: fx, y: fy, z: fz },
                        to: { x, y, z },
                        objectId: currentObjectId,
                    });

                    // คำนวณเวลาของ segment นี้
                    const speed = feedrate / 60;
                    const segTime = speed > 0 ? dist / speed : 0;
                    currentLayerTime += segTime;

                    bounds.minX = Math.min(bounds.minX, fx, x);
                    bounds.maxX = Math.max(bounds.maxX, fx, x);
                    bounds.minY = Math.min(bounds.minY, fy, y);
                    bounds.maxY = Math.max(bounds.maxY, fy, y);
                    bounds.minZ = Math.min(bounds.minZ, fz, z);
                    bounds.maxZ = Math.max(bounds.maxZ, fz, z);
                }
            }
        }
    }

    pushLayer();

    if (bounds.minX === Infinity) {
        bounds.minX = bounds.maxX = bounds.minY = bounds.maxY = bounds.minZ = bounds.maxZ = 0;
    }

    // สร้าง cumulative times
    const layerCumulativeTimes = new Array(layerTimes.length);
    let cumTime = 0;
    for (let i = 0; i < layerTimes.length; i++) {
        cumTime += layerTimes[i];
        layerCumulativeTimes[i] = cumTime;
    }
    const totalPrintTime = cumTime;

    const totalSegs = layers.reduce((s, l) => s + l.length, 0);
    console.log(`[Parser] Done: ${layers.length} layers, ${totalSegs} segments, ${totalPrintTime.toFixed(1)}s total print time`);
    console.log(`[Parser] Layer times (first 5): ${layerTimes.slice(0, 5).map(t => t.toFixed(1) + 's').join(', ')}`);

    return {
        layers,
        totalLayers: layers.length,
        bounds,
        layerCumulativeTimes,   // เวลาสะสมจนจบแต่ละ layer (วินาที)
        totalPrintTime,         // เวลาพิมพ์ทั้งหมด (วินาที)
    };
}

module.exports = { parse };
