#!/bin/bash
# startup.sh — เริ่ม Xvfb + Fluxbox + x11vnc + noVNC

DISPLAY_NUM=${DISPLAY_NUM:-99}
SCREEN_RES=${SCREEN_RES:-1280x800x24}
VNC_PORT=${VNC_PORT:-5900}
NOVNC_PORT=${NOVNC_PORT:-6080}

export DISPLAY=:${DISPLAY_NUM}

echo "[startup] Starting Xvfb on DISPLAY=${DISPLAY} (${SCREEN_RES})..."
# ลบ lock file เก่าที่ค้างอยู่ (กรณี container restart)
rm -f /tmp/.X${DISPLAY_NUM}-lock /tmp/.X11-unix/X${DISPLAY_NUM}
Xvfb :${DISPLAY_NUM} -screen 0 ${SCREEN_RES} -ac +extension GLX +render -noreset &

# รอ Xvfb พร้อมจริงๆ ก่อน
echo "[startup] Waiting for Xvfb to be ready..."
for i in $(seq 1 20); do
    if xdpyinfo -display :${DISPLAY_NUM} >/dev/null 2>&1; then
        echo "[startup] Xvfb is ready."
        break
    fi
    sleep 0.5
done

echo "[startup] Starting Fluxbox window manager..."
fluxbox &
sleep 1

echo "[startup] Starting x11vnc on port ${VNC_PORT}..."
for i in $(seq 1 10); do
    x11vnc -display :${DISPLAY_NUM} -nopw -listen 0.0.0.0 -xkb -forever -shared -rfbport ${VNC_PORT} &
    sleep 1
    if ps aux | grep -q "[x]11vnc"; then
        echo "[startup] x11vnc started successfully."
        break
    fi
    echo "[startup] x11vnc failed, retrying ($i/10)..."
    sleep 1
done

echo "[startup] Starting noVNC on port ${NOVNC_PORT}..."
/opt/novnc/utils/novnc_proxy \
    --vnc localhost:${VNC_PORT} \
    --listen ${NOVNC_PORT} &

echo "[startup] All services started."
echo "[startup] Open http://localhost:${NOVNC_PORT}/vnc.html in your browser."

# รัน Node.js backend เป็น process หลัก (foreground)
exec node /app/src/server.js