import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Text } from '@react-three/drei';
import * as THREE from 'three';
import usePrinterStore from '../store/usePrinterStore';
import printHeadState from '../store/printHeadState';
import LayerRenderer from './LayerRenderer';

// ===== ขนาด Build Volume ของ Bambu P2S (มม.) =====
const BED_X = 256;
const BED_Y = 256;
const BED_Z = 256;
const LAYER_HEIGHT = 0.2;

// ===== Camera Presets =====
const CAMERA_PRESETS = {
    iso: { position: [300, 250, 300], target: [0, BED_Z / 3, 0] },
    front: { position: [0, BED_Z / 2, 400], target: [0, BED_Z / 3, 0] },
    top: { position: [0, 500, 0.1], target: [0, 0, 0] },
    free: null, // ไม่บังคับตำแหน่ง
};

// ===== Print Bed =====
function PrintBed() {
    return (
        <group>
            {/* PEI Textured Plate - สีเทาเข้มเหมือน Bambu Studio */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
                <planeGeometry args={[BED_X, BED_Y]} />
                <meshStandardMaterial
                    color="#3a3a3a"
                    roughness={0.9}
                    metalness={0.1}
                />
            </mesh>
            <Grid
                position={[0, 0.05, 0]}
                args={[BED_X, BED_Y]}
                cellSize={10}
                cellThickness={0.6}
                cellColor="#555555"
                sectionSize={50}
                sectionThickness={1.2}
                sectionColor="#444444"
                fadeDistance={500}
                fadeStrength={1}
                infiniteGrid={false}
            />
        </group>
    );
}

// ===== Build Volume Wireframe =====
function BuildVolume() {
    const edges = useMemo(() => {
        const geo = new THREE.BoxGeometry(BED_X, BED_Z, BED_Y);
        return new THREE.EdgesGeometry(geo);
    }, []);

    return (
        <lineSegments geometry={edges} position={[0, BED_Z / 2, 0]}>
            <lineBasicMaterial color="#999999" opacity={0.15} transparent />
        </lineSegments>
    );
}

// ===== หัวพิมพ์ (Print Head) — อ่านตำแหน่งจาก printHeadState (ไม่ผ่าน React) =====
function PrintHead() {
    const headRef = useRef();
    const glowRef = useRef();

    const layer = usePrinterStore((s) => s.layer);
    const filamentColor = usePrinterStore((s) => s.filamentColor);
    const userFilamentColor = usePrinterStore((s) => s.userFilamentColor);
    const showEffects = usePrinterStore((s) => s.showEffects);
    const gcodeState = usePrinterStore((s) => s.gcodeState);

    const effectiveColor = filamentColor || userFilamentColor || '#00e5ff';
    const isActive = gcodeState === 'RUNNING' || gcodeState === 'PREPARE';

    useFrame((state, delta) => {
        if (!headRef.current) return;

        // Hide nozzle when not active
        if (!isActive) {
            headRef.current.visible = false;
            return;
        }
        headRef.current.visible = true;

        let targetX, targetY, targetZ;

        if (printHeadState.active) {
            // อ่านตำแหน่งตรงจาก shared state (G-code data มีอยู่)
            targetX = printHeadState.x;
            targetY = printHeadState.y;
            targetZ = printHeadState.z;
        } else {
            // Fallback: ไม่มี G-code data → ใช้ MQTT layer สำหรับ Y
            targetX = headRef.current.position.x; // keep current X
            targetY = layer != null ? Math.max(layer * LAYER_HEIGHT, 2) : 2;
            targetZ = headRef.current.position.z; // keep current Z
        }

        // Smooth lerp — responsive following
        const lerpSpeed = 0.15;
        headRef.current.position.x += (targetX - headRef.current.position.x) * lerpSpeed;
        headRef.current.position.y += (targetY - headRef.current.position.y) * lerpSpeed;
        headRef.current.position.z += (targetZ - headRef.current.position.z) * lerpSpeed;

        // หมุน glow ring
        if (glowRef.current && showEffects) {
            glowRef.current.rotation.y += delta * 0.8;
        }
    });

    return (
        <group ref={headRef} position={[0, 30, 0]}>
            {/* ตัวหัวพิมพ์ — offset +3 ให้ปลาย tip อยู่ตรง position */}
            <mesh rotation={[Math.PI, 0, 0]} position={[0, 3, 0]}>
                <coneGeometry args={[2.5, 6, 8]} />
                <meshStandardMaterial
                    color="#ff6600"
                    emissive="#ff4400"
                    emissiveIntensity={0.3}
                    metalness={0.5}
                    roughness={0.4}
                />
            </mesh>

            {/* Glow effect ที่ nozzle tip */}
            {showEffects && (
                <>
                    <pointLight
                        color="#ffaa33"
                        intensity={3}
                        distance={50}
                        decay={2}
                        position={[0, -3, 0]}
                    />
                    <pointLight
                        color={effectiveColor}
                        intensity={1.5}
                        distance={30}
                        decay={2}
                        position={[0, -5, 0]}
                    />
                </>
            )}

            {/* Glow ring */}
            {showEffects && (
                <mesh ref={glowRef} position={[0, -2, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[3, 0.25, 8, 32]} />
                    <meshBasicMaterial
                        color={effectiveColor}
                        transparent
                        opacity={0.6}
                    />
                </mesh>
            )}

            {/* Nozzle tip glow sphere */}
            {showEffects && (
                <mesh position={[0, -4, 0]}>
                    <sphereGeometry args={[1.5, 16, 16]} />
                    <meshBasicMaterial
                        color="#ffaa33"
                        transparent
                        opacity={0.4}
                    />
                </mesh>
            )}

            {/* เส้นที่กำลังพิมพ์ */}
            <mesh position={[0, -5, 0]}>
                <cylinderGeometry args={[0.3, 0.3, 3, 8]} />
                <meshBasicMaterial color={effectiveColor} />
            </mesh>
        </group>
    );
}

// ===== แกน Axis Labels =====
function AxisLabels() {
    return (
        <group>
            <Text position={[BED_X / 2 + 10, 0, 0]} fontSize={8} color="#666666" anchorX="left" font={undefined}>X</Text>
            <Text position={[0, BED_Z + 10, 0]} fontSize={8} color="#666666" anchorX="center" font={undefined}>Z</Text>
            <Text position={[0, 0, BED_Y / 2 + 10]} fontSize={8} color="#666666" anchorX="center" font={undefined}>Y</Text>
        </group>
    );
}

// ===== Camera Controller — รองรับ presets =====
function CameraController() {
    const controlsRef = useRef();
    const { camera } = useThree();
    const cameraPreset = usePrinterStore((s) => s.cameraPreset);
    const lastPresetRef = useRef(cameraPreset);

    useFrame(() => {
        if (cameraPreset === 'free' || cameraPreset === lastPresetRef.current) return;

        const preset = CAMERA_PRESETS[cameraPreset];
        if (!preset) return;

        // Smooth lerp ไปยัง preset
        camera.position.x += (preset.position[0] - camera.position.x) * 0.05;
        camera.position.y += (preset.position[1] - camera.position.y) * 0.05;
        camera.position.z += (preset.position[2] - camera.position.z) * 0.05;

        if (controlsRef.current) {
            controlsRef.current.target.x += (preset.target[0] - controlsRef.current.target.x) * 0.05;
            controlsRef.current.target.y += (preset.target[1] - controlsRef.current.target.y) * 0.05;
            controlsRef.current.target.z += (preset.target[2] - controlsRef.current.target.z) * 0.05;
        }

        // หยุด lerp เมื่อใกล้พอ
        const dist = camera.position.distanceTo(new THREE.Vector3(...preset.position));
        if (dist < 1) {
            lastPresetRef.current = cameraPreset;
        }
    });

    // Reset lastPreset เมื่อ preset เปลี่ยน
    useEffect(() => {
        if (cameraPreset !== lastPresetRef.current) {
            lastPresetRef.current = null; // force animation
        }
    }, [cameraPreset]);

    return (
        <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.05}
            minDistance={5}
            maxDistance={800}
            maxPolarAngle={Math.PI / 2 + 0.3}
            onChange={() => {
                // เมื่อ user drag → เปลี่ยนเป็น free mode
                const current = usePrinterStore.getState().cameraPreset;
                if (current !== 'free' && lastPresetRef.current === current) {
                    usePrinterStore.getState().setCameraPreset('free');
                }
            }}
        />
    );
}

// ===== Scene หลัก =====
function Scene() {
    return (
        <>
            {/* Enhanced lighting for line depth perception */}
            <ambientLight intensity={0.35} />
            <directionalLight position={[200, 400, 200]} intensity={1.2} color="#ffffff" />
            <directionalLight position={[-150, 300, -100]} intensity={0.6} color="#e8e8ff" />
            <directionalLight position={[0, 50, 300]} intensity={0.5} color="#ffffff" />
            <directionalLight position={[0, -50, 0]} intensity={0.2} color="#aaaaaa" />
            <PrintBed />
            <BuildVolume />
            <PrintHead />
            <AxisLabels />
            <LayerRenderer />

            <CameraController />
        </>
    );
}

// ===== Canvas ที่ export ออกไป =====
export default function PrinterView3D() {
    return (
        <div className="canvas-container">
            <Canvas
                camera={{
                    position: [300, 250, 300],
                    fov: 45,
                    near: 0.1,
                    far: 2000,
                }}
                gl={{ antialias: true, alpha: false }}
                onCreated={({ gl }) => {
                    gl.setClearColor('#f5f5f5');
                    gl.toneMapping = THREE.NoToneMapping;
                }}
            >
                <Scene />
            </Canvas>
        </div>
    );
}
