# deploy-ha.ps1 — Deploy Bambu Monitor to HA Add-on via SCP
# Usage: .\deploy-ha.ps1
# แก้ค่า HA_IP และ SSH_PORT ให้ตรงกับเซิร์ฟเวอร์ของคุณ

$HA_IP = "192.168.0.7"
$SSH_PORT = 22
$ADDON_PATH = "/addons/bambu_monitor"
$SRC = "C:\Users\kitti\Projects\bambu-monitor"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Bambu Monitor -> HA Deploy Script" -ForegroundColor Cyan
Write-Host "  Target: root@${HA_IP}:${ADDON_PATH}" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ไฟล์ที่ต้อง deploy (source -> destination)
$files = @(
    @{ src = "$SRC\backend\mqttClient.js";                         dst = "${ADDON_PATH}/backend/mqttClient.js" },
    @{ src = "$SRC\backend\server.js";                              dst = "${ADDON_PATH}/backend/server.js" },
    @{ src = "$SRC\backend\gcodeParser.js";                         dst = "${ADDON_PATH}/backend/gcodeParser.js" },
    @{ src = "$SRC\backend\ftpClient.js";                           dst = "${ADDON_PATH}/backend/ftpClient.js" },
    @{ src = "$SRC\frontend\src\components\HUD.jsx";                dst = "${ADDON_PATH}/frontend/src/components/HUD.jsx" },
    @{ src = "$SRC\frontend\src\components\ConnectPanel.jsx";       dst = "${ADDON_PATH}/frontend/src/components/ConnectPanel.jsx" },
    @{ src = "$SRC\frontend\src\store\usePrinterStore.js";          dst = "${ADDON_PATH}/frontend/src/store/usePrinterStore.js" },
    @{ src = "$SRC\frontend\src\index.css";                         dst = "${ADDON_PATH}/frontend/src/index.css" },
    @{ src = "$SRC\config.yaml";                                    dst = "${ADDON_PATH}/config.yaml" },
    @{ src = "$SRC\Dockerfile";                                     dst = "${ADDON_PATH}/Dockerfile" },
    @{ src = "$SRC\run.sh";                                         dst = "${ADDON_PATH}/run.sh" },
    @{ src = "$SRC\.dockerignore";                                  dst = "${ADDON_PATH}/.dockerignore" }
)

$success = 0
$fail = 0

foreach ($f in $files) {
    $filename = Split-Path $f.src -Leaf
    Write-Host "  Copying $filename ... " -NoNewline

    scp -P $SSH_PORT "$($f.src)" "root@${HA_IP}:$($f.dst)" 2>$null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "OK" -ForegroundColor Green
        $success++
    } else {
        Write-Host "FAIL" -ForegroundColor Red
        $fail++
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Results: $success OK, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Yellow" })
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if ($fail -eq 0) {
    Write-Host "  All files copied! Now go to HA and click REBUILD:" -ForegroundColor Green
    Write-Host "  http://homeassistant.local:8123/config/app/local_bambu_monitor/info" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "  Some files failed. Check SSH connection:" -ForegroundColor Yellow
    Write-Host "  ssh -p $SSH_PORT root@$HA_IP" -ForegroundColor White
    Write-Host ""
}
