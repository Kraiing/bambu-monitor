import { useState } from 'react';
import usePrinterStore from '../store/usePrinterStore';

const PRESET_COLORS = [
    '#00e5ff', '#ff4466', '#00ff88', '#ffaa00',
    '#aa66ff', '#ff6600', '#66ffcc', '#ff66aa',
    '#ffffff', '#4488ff',
];

export default function SettingsPanel() {
    const {
        settingsOpen,
        setSettingsOpen,
        userFilamentColor,
        setUserFilamentColor,
        showEffects,
        setShowEffects,
    } = usePrinterStore();

    const [customColor, setCustomColor] = useState(userFilamentColor);

    if (!settingsOpen) return null;

    return (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
            <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
                <div className="settings-panel__header">
                    <h2 className="settings-panel__title">⚙️ ตั้งค่า</h2>
                    <button
                        className="settings-panel__close"
                        onClick={() => setSettingsOpen(false)}
                    >
                        ✕
                    </button>
                </div>

                {/* สีเส้น Filament */}
                <div className="settings-panel__section">
                    <label className="settings-panel__label">สีเส้น Filament</label>
                    <div className="settings-panel__colors">
                        {PRESET_COLORS.map((color) => (
                            <button
                                key={color}
                                className={`settings-panel__color-btn ${userFilamentColor === color ? 'settings-panel__color-btn--active' : ''
                                    }`}
                                style={{ backgroundColor: color }}
                                onClick={() => {
                                    setUserFilamentColor(color);
                                    setCustomColor(color);
                                }}
                            />
                        ))}
                    </div>
                    <div className="settings-panel__custom-color">
                        <input
                            type="color"
                            value={customColor}
                            onChange={(e) => {
                                setCustomColor(e.target.value);
                                setUserFilamentColor(e.target.value);
                            }}
                            className="settings-panel__color-picker"
                        />
                        <span className="settings-panel__color-hex">{userFilamentColor}</span>
                    </div>
                </div>

                {/* Effects Toggle */}
                <div className="settings-panel__section">
                    <label className="settings-panel__label">เอฟเฟกต์</label>

                    <div className="settings-panel__toggle-row">
                        <span>Glow Effect & Travel Lines</span>
                        <button
                            className={`settings-panel__toggle ${showEffects ? 'settings-panel__toggle--on' : ''}`}
                            onClick={() => setShowEffects(!showEffects)}
                        >
                            <span className="settings-panel__toggle-knob" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
