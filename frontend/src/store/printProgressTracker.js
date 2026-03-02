/**
 * Print Progress Tracker v5 — mc_percent + default rate + wall-clock
 *
 * Flow:
 * 1. MQTT: update(data) → mc_percent, remaining_time
 * 2. On first update: compute default percentRate from remaining + progress
 * 3. Every frame: _getSmoothPercent() → advances at rate per second
 * 4. percent → map through layerCumulativeTimes → segment count
 */

class PrintProgressTracker {
    constructor() {
        this.currentLayer = null;
        this.totalLayers = null;
        this.gcodeState = null;

        // Percent tracking
        this._lastPercent = 0;
        this._percentRate = 0;       // %/second (how fast percent advances)
        this._lastPercentTime = 0;   // timestamp of last MQTT update (seconds)
        this._smoothPercent = 0;
        this._printStarted = false;
        this._hasRate = false;       // do we have a computed rate?

        // Parser timing
        this.layerCumulativeTimes = null;
        this.totalPrintTime = null;

        // Fallback
        this.layerStartTime = null;
        this.lastLayer = null;
        this.layerDurations = [];
        this.estimatedLayerDuration = 60000;
    }

    setTimingData(layerCumulativeTimes, totalPrintTime) {
        this.layerCumulativeTimes = layerCumulativeTimes;
        this.totalPrintTime = totalPrintTime;
        console.log(`[Tracker] Timing: ${layerCumulativeTimes.length} layers, ${totalPrintTime.toFixed(1)}s total`);
    }

    update(mqttData) {
        const { layer, totalLayers, remainingTime, progress, gcodeState } = mqttData;

        this.gcodeState = gcodeState;
        if (totalLayers != null) this.totalLayers = totalLayers;

        if (progress != null && progress > 0) {
            const now = Date.now() / 1000;

            // Compute default rate from remaining_time on first update
            if (!this._hasRate && remainingTime != null && remainingTime > 0) {
                const remainingSec = remainingTime * 60;
                const fraction = progress / 100;
                if (fraction > 0 && fraction < 1) {
                    const totalSec = remainingSec / (1 - fraction);
                    // Base rate (unscaled) — dynamic layer scaling applied in _getSmoothPercent
                    this._percentRate = 100 / totalSec;
                    this._hasRate = true;
                    console.log(`[Tracker] Default rate: ${(this._percentRate * 60).toFixed(4)} %/min, total: ${(totalSec / 60).toFixed(1)} min`);
                }
            }

            // Refine rate when percent actually changes
            if (progress > this._lastPercent && this._lastPercentTime > 0) {
                const dt = now - this._lastPercentTime;
                if (dt > 1) {
                    const measuredRate = (progress - this._lastPercent) / dt;
                    // EMA smoothing
                    this._percentRate = this._hasRate
                        ? this._percentRate * 0.6 + measuredRate * 0.4
                        : measuredRate;
                    this._hasRate = true;
                }
            }

            if (progress !== this._lastPercent || !this._printStarted) {
                this._lastPercent = progress;
                this._lastPercentTime = now;
            }

            if (!this._printStarted) {
                this._smoothPercent = progress;
                this._printStarted = true;
            }
        }

        if (layer == null) return;

        if (layer !== this.lastLayer) {
            const now = Date.now();
            if (this.layerStartTime != null && this.lastLayer != null) {
                const duration = now - this.layerStartTime;
                if (duration > 500 && duration < 600000) {
                    this.layerDurations.push(duration);
                    if (this.layerDurations.length > 10) this.layerDurations.shift();
                    const sum = this.layerDurations.reduce((a, b) => a + b, 0);
                    this.estimatedLayerDuration = sum / this.layerDurations.length;
                }
            }
            this.layerStartTime = now;
            this.lastLayer = layer;
        }
        this.currentLayer = layer;
    }

    /**
     * Smooth percent — เดินหน้าทุก frame ตาม percentRate
     * Dynamic scaling: layer 1 ช้ากว่า (first layer speed ~50%)
     */
    _getSmoothPercent() {
        if (!this._printStarted || !this._hasRate) return this._lastPercent;

        const now = Date.now() / 1000;
        const dt = now - this._lastPercentTime;

        // Dynamic scale based on current layer
        // Layer 1 prints at ~50% speed → scale down more
        const layerScale = (this.currentLayer != null && this.currentLayer <= 1) ? 0.35 : 0.70;

        // Advance at estimated rate × layer scale
        const projected = this._lastPercent + this._percentRate * layerScale * dt;

        // Never go backward, cap at 1.0% ahead of last known
        // (MQTT updates every ~5s → need enough headroom for continuous motion)
        this._smoothPercent = Math.max(
            this._smoothPercent,
            Math.min(projected, this._lastPercent + 1.0, 100)
        );

        return this._smoothPercent;
    }

    getDisplayedSegmentCount(layers, cumulativeSegCounts, maxLayer) {
        if (!layers || !cumulativeSegCounts) return 0;

        // Print complete → show ALL segments (full model)
        // ต้องเช็คก่อน currentLayer == null เพราะ FINISH อาจมี currentLayer = null
        if (this.gcodeState === 'FINISH' || this._lastPercent >= 100) {
            const totalSegs = cumulativeSegCounts[cumulativeSegCounts.length - 1] || 0;
            return totalSegs;
        }

        if (this.currentLayer == null) return 0;
        if (this.gcodeState !== 'RUNNING') return 0;

        // ========== LAYER-ANCHORED TIMING ==========
        // ยึด Layer จาก MQTT เป็นที่ตั้ง (strict boundary)
        const layerIdx = Math.max(0, Math.min(this.currentLayer - 1, layers.length - 1));
        const completedSegs = layerIdx > 0 ? cumulativeSegCounts[layerIdx - 1] : 0;
        const segsInCurrentLayer = layers[layerIdx] ? layers[layerIdx].length : 0;

        // ดึงเวลาเริ่มต้นและเวลาที่ควรจะใช้ของเลเยอร์นี้จาก Parser
        let parsedLayerDuration = this.estimatedLayerDuration / 1000; // default 60s
        if (this.layerCumulativeTimes && this.layerCumulativeTimes.length > layerIdx) {
            const layerStart = layerIdx > 0 ? this.layerCumulativeTimes[layerIdx - 1] : 0;
            const layerEnd = this.layerCumulativeTimes[layerIdx];
            parsedLayerDuration = layerEnd - layerStart;
        }

        // กันเหนียวกรณี G-code บางเลเยอร์เป็น 0 วินาที
        if (parsedLayerDuration <= 0) parsedLayerDuration = 1;

        // คำนวนเวลาจริงที่ผ่านไปนับตั้งแต่ขึ้นเลเยอร์นี้
        let elapsedSinceLayerStart = 0;
        if (this.layerStartTime) {
            elapsedSinceLayerStart = (Date.now() - this.layerStartTime) / 1000;
        }

        // ความก้าวหน้าในเลเยอร์ปัจจุบัน (0.0 ถึง 0.999)
        // ** ห้ามถึง 1.0 (100%) เพื่อไม่ให้ขึ้นเลเยอร์ใหม่ก่อน MQTT สั่ง **
        let layerProgress = 0;
        if (elapsedSinceLayerStart > 0) {
            layerProgress = elapsedSinceLayerStart / parsedLayerDuration;
        }

        // Cap กักบริเวณให้อยู่แค่ปลายเลเยอร์ปัจจุบัน ถ้ารอคำสั่งขึ้นเลเยอร์ใหม่อยู่
        layerProgress = Math.max(0, Math.min(layerProgress, 0.999));

        // คำนวนจำนวน segment: เส้นเลเยอร์เก่าที่เสร็จแล้ว + เส้นในเลเยอร์นี้ที่กำลังวาด
        return completedSegs + Math.floor(layerProgress * segsInCurrentLayer);
    }

    reset() {
        this.currentLayer = null;
        this.totalLayers = null;
        this.gcodeState = null;
        this._lastPercent = 0;
        this._percentRate = 0;
        this._lastPercentTime = 0;
        this._smoothPercent = 0;
        this._printStarted = false;
        this._hasRate = false;
        this.layerCumulativeTimes = null;
        this.totalPrintTime = null;
        this.layerStartTime = null;
        this.lastLayer = null;
        this.layerDurations = [];
        this.estimatedLayerDuration = 60000;
    }
}

const tracker = new PrintProgressTracker();
export default tracker;
