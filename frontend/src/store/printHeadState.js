/**
 * Shared mutable state สำหรับ print head position
 * ใช้ module-level object แทน React state เพื่อ:
 * - ไม่ trigger React re-render ทุก frame
 * - LayerRenderer เขียน, PrintHead อ่าน ใน useFrame ได้เลย
 */
const printHeadState = {
    x: 0,
    y: 30,
    z: 0,
    active: false,  // มี data จาก LayerRenderer หรือยัง
};

export default printHeadState;
