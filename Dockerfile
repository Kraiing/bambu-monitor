# HA Add-on Dockerfile — Bambu Monitor
# Target: aarch64 (Raspberry Pi 5 with HAOS)
#
# HA Supervisor จะ inject BUILD_FROM ให้อัตโนมัติตาม arch
# ใช้ Alpine Linux base image ของ HA (มี bashio, s6-overlay พร้อมแล้ว)
ARG BUILD_FROM
FROM $BUILD_FROM

# ——— ติดตั้ง Node.js 20 LTS ———
# Alpine 3.20+ มี Node.js 20.x ใน repo หลัก
RUN apk add --no-cache nodejs npm python3 make g++

WORKDIR /app

# ——— Copy source code ———
COPY . .

# ——— ติดตั้ง backend dependencies (production เท่านั้น) ———
RUN cd backend && npm install --omit=dev

# ——— ติดตั้ง frontend dependencies และ build ———
# (ต้องการ devDeps เช่น vite เพื่อ build, แต่หลัง build ไม่ต้องการแล้ว)
RUN cd frontend && npm install && npm run build

# ——— ตั้งค่า startup script ———
RUN sed -i 's/\r$//' /app/run.sh && cp /app/run.sh /run.sh && chmod +x /run.sh

# Port ที่ backend ฟัง
EXPOSE 3001

# HA Supervisor จะเรียก /run.sh เมื่อ start container
CMD ["/run.sh"]
