import { useMemo, useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import usePrinterStore from '../store/usePrinterStore';
import printHeadState from '../store/printHeadState';
import tracker from '../store/printProgressTracker';

const BED_CENTER_X = 128;
const BED_CENTER_Y = 128;

/**
 * คำนวณ mapped layer index
 */
function getMappedLayerIndex(mqttLayer, mqttTotalLayers, parsedTotalLayers) {
    if (mqttLayer == null || !parsedTotalLayers) return parsedTotalLayers - 1;

    if (mqttTotalLayers && Math.abs(parsedTotalLayers - mqttTotalLayers) / mqttTotalLayers < 0.1) {
        return Math.min(mqttLayer, parsedTotalLayers - 1);
    }

    if (mqttTotalLayers && mqttTotalLayers > 0) {
        const ratio = mqttLayer / mqttTotalLayers;
        return Math.min(Math.floor(ratio * parsedTotalLayers), parsedTotalLayers - 1);
    }

    return Math.min(mqttLayer, parsedTotalLayers - 1);
}

/**
 * อ่านตำแหน่ง 3D ของปลายสุด segment ที่ index
 */
function getSegmentEndPos(layers, flatIndex, cumulativeSegCounts) {
    if (!layers || !cumulativeSegCounts || flatIndex <= 0) return null;

    let layerIdx = 0;
    for (let i = 0; i < cumulativeSegCounts.length; i++) {
        if (flatIndex <= cumulativeSegCounts[i]) {
            layerIdx = i;
            break;
        }
    }

    const segsBefore = layerIdx > 0 ? cumulativeSegCounts[layerIdx - 1] : 0;
    const segIdx = Math.min(flatIndex - segsBefore - 1, layers[layerIdx].length - 1);

    if (segIdx < 0 || !layers[layerIdx] || !layers[layerIdx][segIdx]) return null;
    const seg = layers[layerIdx][segIdx];

    return {
        x: seg.to.x - BED_CENTER_X,
        y: seg.to.z,
        z: -(seg.to.y - BED_CENTER_Y),
    };
}

/**
 * LayerRenderer — ใช้ PrintProgressTracker แทน mc_percent
 * 
 * - Completed layers = แสดงครบ (จาก layer_num)
 * - Current layer = interpolate ตามเวลาจริง
 * - worldUnits: true → เส้นหนาจริง
 */
export default function LayerRenderer() {
    const layers = usePrinterStore((s) => s.layers);
    const currentLayer = usePrinterStore((s) => s.layer);
    const totalLayers = usePrinterStore((s) => s.totalLayers);
    const userFilamentColor = usePrinterStore((s) => s.userFilamentColor);
    const filamentColor = usePrinterStore((s) => s.filamentColor);
    const gcodeState = usePrinterStore((s) => s.gcodeState);
    const progress = usePrinterStore((s) => s.progress);
    const skippedObjects = usePrinterStore((s) => s.skippedObjects);

    const { size } = useThree();
    const groupRef = useRef();
    const ghostObjRef = useRef(null);
    const solidObjRef = useRef(null);
    const ghostMatRef = useRef(null);
    const solidMatRef = useRef(null);

    // Animation state (ไม่ผ่าน React)
    const animRef = useRef({
        displayedSegCount: 0,
        lastBuiltCount: -1,
    });

    // 1. Pre-build ALL positions + cumulative counts (ทำครั้งเดียวตอนโหลดไฟล์!)
    // ลบ currentLayer, gcodeState, progress ออกจาก dependency เพราะเราจะวาด 100% ทุกครั้ง
    // แต่เพิ่ม skippedObjects เข้าไป เพื่อให้ Re-build เมื่อมีการตั้งค่าสคิปใหม่
    const { allPositions, allColors, cumulativeSegCounts } = useMemo(() => {
        if (!layers || layers.length === 0) {
            return { allPositions: null, allColors: null, cumulativeSegCounts: null };
        }

        const counts = new Array(layers.length);
        let total = 0;

        // Base color — work in HSL for perceptual contrast
        const rawColor = filamentColor || userFilamentColor || '#999999';
        const baseColor = new THREE.Color(rawColor);
        const hsl = {};
        baseColor.getHSL(hsl);

        const pos = [];
        const colors = [];

        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            if (!layer) {
                counts[i] = total;
                continue;
            }

            // Per-layer color: gradient + odd/even alternation
            const layerFrac = layers.length > 1 ? i / (layers.length - 1) : 0;
            // Layer ล่าง = เข้มกว่า (70%), layer บน = สว่างขึ้น (100%)
            const gradientBright = 0.70 + layerFrac * 0.30;
            // สลับ odd/even (ลดความต่างลงหน่อยเพื่อเน้นแสงเงา)
            const oddEven = (i % 2 === 0) ? 1.0 : 0.85;
            const layerL = hsl.l * gradientBright * oddEven;

            const c = new THREE.Color();

            for (const seg of layer) {
                // ข้ามการเรนเดอร์ชิ้นงานที่ถูกระบุไว้ใน skippedObjects
                if (seg.objectId != null && skippedObjects.includes(seg.objectId)) {
                    continue;
                }

                total++;

                // Fake 3D Highlight (Directional Lighting)
                const dx = seg.to.x - seg.from.x;
                const dy = seg.to.y - seg.from.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;

                // Normal vector of the line
                const nx = -dy / len;
                const ny = dx / len;

                // Light direction (Top-Left)
                const lightDirX = -0.707;
                const lightDirY = 0.707;

                // Dot product (absolute value to light both sides of the "tube")
                const intensity = Math.abs(nx * lightDirX + ny * lightDirY);

                // Plastic highlight effect: Shift lightness directly
                // (Shadow: -15%, Highlight: +25%) - Increased contrast to mimic cylinder
                const lightShift = -0.15 + (intensity * 0.40);
                const finalL = Math.max(0.02, Math.min(0.98, layerL + lightShift));

                c.setHSL(hsl.h, hsl.s, finalL);

                pos.push(
                    seg.from.x - BED_CENTER_X, seg.from.z, -(seg.from.y - BED_CENTER_Y),
                    seg.to.x - BED_CENTER_X, seg.to.z, -(seg.to.y - BED_CENTER_Y)
                );
                colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
            }
        }

        return {
            allPositions: pos.length > 0 ? new Float32Array(pos) : null,
            allColors: colors.length > 0 ? new Float32Array(colors) : null,
            cumulativeSegCounts: counts,
        };
    }, [layers, totalLayers, filamentColor, userFilamentColor, skippedObjects]); // ตัด dependency ที่ทำให้ต้องรีรันบ่อยออก

    // Reset เมื่อ layers เปลี่ยน
    useEffect(() => {
        if (!layers) {
            animRef.current.displayedSegCount = 0;
            animRef.current.lastBuiltCount = -1;
            printHeadState.active = false;
        }
    }, [layers]);

    // 2. สร้าง Dual Geometry (Ghost + Solid)
    useEffect(() => {
        if (!groupRef.current) return;

        // Cleanup ของเก่า
        if (ghostObjRef.current) groupRef.current.remove(ghostObjRef.current);
        if (solidObjRef.current) groupRef.current.remove(solidObjRef.current);
        ghostObjRef.current?.geometry?.dispose();
        solidObjRef.current?.geometry?.dispose();
        ghostMatRef.current?.dispose();
        solidMatRef.current?.dispose();
        ghostObjRef.current = null;
        solidObjRef.current = null;

        if (!allPositions) return;

        // --- สร้าง Geometry แชร์กันระหว่าง 2 Layer ---
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(allPositions);
        if (allColors) geometry.setColors(allColors);

        // --- Layer 1: GHOST MODEL (โชว์ 100% เสมอ, โปร่งใส 10%) ---
        const ghostMat = new LineMaterial({
            linewidth: 0.45,
            worldUnits: true,
            vertexColors: true,
            transparent: true,
            opacity: 0.05, // 5% ตามที่ขอ
            depthTest: true,
            depthWrite: false, // เพื่อไม่ให้บังเส้นทึบ
            resolution: new THREE.Vector2(size.width, size.height),
        });
        const ghostMesh = new LineSegments2(geometry, ghostMat);
        ghostMesh.computeLineDistances();
        // ไม่ต้องเซ็ต instanceCount เพราะจะโชว์ทั้งหมด (100% of buffer)

        // --- Layer 2: SOLID MODEL (โชว์เฉพาะส่วนที่พิมพ์ถึง, สีทึบ 100%) ---
        const solidMat = new LineMaterial({
            linewidth: 0.45,
            worldUnits: true,
            vertexColors: true,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            resolution: new THREE.Vector2(size.width, size.height),
        });
        const solidGeometry = geometry.clone(); // Clone ของแยกกันเพื่อกันบัค instanceCount ตีกัน
        const solidMesh = new LineSegments2(solidGeometry, solidMat);
        solidMesh.computeLineDistances();
        solidGeometry.instanceCount = 0; // เริ่มต้นที่ 0

        groupRef.current.add(ghostMesh);
        groupRef.current.add(solidMesh);

        ghostObjRef.current = ghostMesh;
        solidObjRef.current = solidMesh;
        ghostMatRef.current = ghostMat;
        solidMatRef.current = solidMat;

        return () => {
            if (ghostObjRef.current && groupRef.current) groupRef.current.remove(ghostObjRef.current);
            if (solidObjRef.current && groupRef.current) groupRef.current.remove(solidObjRef.current);
            geometry.dispose();
            solidGeometry.dispose();
            ghostMat.dispose();
            solidMat.dispose();
        };
    }, [allPositions, allColors, size]);

    // 3. Update Solid Model ในแต่ละเฟรม
    useFrame(() => {
        if (solidMatRef.current && ghostMatRef.current) {
            solidMatRef.current.resolution.set(size.width, size.height);
            ghostMatRef.current.resolution.set(size.width, size.height);
        }

        if (!solidObjRef.current || !allPositions || !cumulativeSegCounts) return;

        const anim = animRef.current;
        const segsInGeo = allPositions.length / 6;

        // คำนวณเลเยอร์ปัจจุบันใหม่ใน frame นี้
        const isComplete = gcodeState === 'FINISH' || progress >= 100;
        const maxLayer = isComplete
            ? layers.length - 1
            : getMappedLayerIndex(currentLayer, totalLayers, layers.length);

        // ถาม tracker: ควรแสดงกี่ segments (ใช้ algorithm เดิมเป๊ะ ไม่กระทบ Sync!)
        const targetSegs = Math.min(
            tracker.getDisplayedSegmentCount(layers, cumulativeSegCounts, maxLayer),
            segsInGeo
        );

        // Smooth lerp
        const diff = targetSegs - anim.displayedSegCount;
        if (Math.abs(diff) < 0.5) {
            anim.displayedSegCount = targetSegs;
        } else if (Math.abs(diff) > 500) {
            anim.displayedSegCount = targetSegs;
        } else {
            const lerpFactor = 0.06;
            anim.displayedSegCount += diff * lerpFactor;
        }

        const showSegs = Math.max(0, Math.min(Math.floor(anim.displayedSegCount), segsInGeo));

        // อัปเดตฝั่ง Solid เท่านั้น (Ghost แสดง 100% ตลอดกาล)
        if (showSegs !== anim.lastBuiltCount) {
            solidObjRef.current.geometry.instanceCount = showSegs;
            anim.lastBuiltCount = showSegs;
        }

        // อัปเดตตำแหน่งหัวพิมพ์ตามปกติ
        if (showSegs > 0) {
            const frac = anim.displayedSegCount - Math.floor(anim.displayedSegCount);
            const segIdx = Math.max(0, showSegs - 1);
            const headPos = getSegmentEndPos(layers, segIdx + 1, cumulativeSegCounts);
            if (headPos) {
                const nextPos = getSegmentEndPos(layers, segIdx + 2, cumulativeSegCounts);
                if (nextPos && frac > 0) {
                    printHeadState.x = headPos.x + (nextPos.x - headPos.x) * frac;
                    printHeadState.y = headPos.y + (nextPos.y - headPos.y) * frac;
                    printHeadState.z = headPos.z + (nextPos.z - headPos.z) * frac;
                } else {
                    printHeadState.x = headPos.x;
                    printHeadState.y = headPos.y;
                    printHeadState.z = headPos.z;
                }
                printHeadState.active = true;
            }
        }
    });

    return <group ref={groupRef} />;
}

export { getMappedLayerIndex };
