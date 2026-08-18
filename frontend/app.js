// Configuration
const GATEWAY_HTTP = 'http://localhost:4000';
const GATEWAY_WS = 'ws://localhost:4000';

// Canvas State
const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');
const canvasOverlay = document.getElementById('canvas-overlay');

let isDrawing = false;
let currentTool = 'pen'; // 'pen' | 'eraser'
let currentColor = '#6366f1';
let brushSize = 4;
let lastX = 0;
let lastY = 0;
let currentStrokePoints = [];

// Cluster state cache
let lastLeaderId = null;
let lastTerm = 0;

// WebSocket
let ws = null;

// Initialization
function initCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

window.addEventListener('resize', () => {
  // Store existing image content when resizing
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(canvas, 0, 0);

  initCanvas();
  ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width / window.devicePixelRatio, tempCanvas.height / window.devicePixelRatio);
});

initCanvas();

// --- CANVAS EVENT LISTENERS ---

function getPointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function startDrawing(e) {
  isDrawing = true;
  const pos = getPointerPos(e);
  lastX = pos.x;
  lastY = pos.y;
  currentStrokePoints = [{ x: pos.x, y: pos.y }];
}

function draw(e) {
  if (!isDrawing) return;
  const pos = getPointerPos(e);

  // Draw locally for immediate user feedback
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(pos.x, pos.y);
  ctx.strokeStyle = currentTool === 'eraser' ? '#0d1322' : currentColor;
  ctx.lineWidth = currentTool === 'eraser' ? brushSize * 4 : brushSize;
  ctx.stroke();

  currentStrokePoints.push({ x: pos.x, y: pos.y });

  lastX = pos.x;
  lastY = pos.y;
}

function stopDrawing() {
  if (!isDrawing) return;
  isDrawing = false;

  if (currentStrokePoints.length > 0) {
    const strokeData = {
      points: currentStrokePoints,
      color: currentTool === 'eraser' ? '#0d1322' : currentColor,
      size: currentTool === 'eraser' ? brushSize * 4 : brushSize,
      isEraser: currentTool === 'eraser',
      timestamp: Date.now()
    };

    // Send stroke to Gateway via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'draw_stroke',
        stroke: strokeData
      }));
    }
  }

  currentStrokePoints = [];
}

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);

canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDrawing(e); }, { passive: false });
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); draw(e); }, { passive: false });
canvas.addEventListener('touchend', (e) => { e.preventDefault(); stopDrawing(e); }, { passive: false });

// --- TOOLBAR CONTROLS ---

document.getElementById('btn-pen').addEventListener('click', (e) => {
  currentTool = 'pen';
  document.getElementById('btn-pen').classList.add('active');
  document.getElementById('btn-eraser').classList.remove('active');
});

document.getElementById('btn-eraser').addEventListener('click', (e) => {
  currentTool = 'eraser';
  document.getElementById('btn-eraser').classList.add('active');
  document.getElementById('btn-pen').classList.remove('active');
});

document.getElementById('color-picker').addEventListener('input', (e) => {
  currentColor = e.target.value;
  updateColorSwatches(currentColor);
});

document.querySelectorAll('.color-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    currentColor = swatch.getAttribute('data-color');
    document.getElementById('color-picker').value = currentColor;
    updateColorSwatches(currentColor);
  });
});

function updateColorSwatches(color) {
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.classList.toggle('active', swatch.getAttribute('data-color').toLowerCase() === color.toLowerCase());
  });
}

document.getElementById('brush-size').addEventListener('input', (e) => {
  brushSize = parseInt(e.target.value, 10);
  document.getElementById('brush-size-val').textContent = `${brushSize}px`;
});

document.getElementById('btn-clear').addEventListener('click', () => {
  // Clear canvas locally & replicate clear event
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const clearStroke = {
    type: 'clear',
    timestamp: Date.now()
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'draw_stroke',
      stroke: clearStroke
    }));
  }
  logEvent('Cleared canvas', 'warning');
});

// --- RENDER STROKE ON CANVAS ---

function renderStroke(stroke) {
  if (!stroke) return;

  if (stroke.type === 'clear') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  if (!stroke.points || stroke.points.length === 0) return;

  ctx.beginPath();
  ctx.strokeStyle = stroke.color || '#6366f1';
  ctx.lineWidth = stroke.size || 4;

  const pts = stroke.points;
  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
}

// --- WEBSOCKET ENGINE ---

function connectWebSocket() {
  updateWsStatus('Connecting...', 'grey');
  ws = new WebSocket(GATEWAY_WS);

  ws.onopen = () => {
    updateWsStatus('Connected to Gateway', 'green');
    canvasOverlay.classList.add('hidden');
    logEvent('Connected to WebSocket Gateway (Port 4000)', 'success');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'init_history') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (data.strokes && data.strokes.length > 0) {
          data.strokes.forEach(stroke => renderStroke(stroke));
          logEvent(`Synchronized ${data.strokes.length} historical committed strokes`, 'info');
        }
      } else if (data.type === 'stroke_committed') {
        renderStroke(data.stroke);
        document.getElementById('metric-commit-idx').textContent = `#${data.index}`;
      }
    } catch (err) {
      console.error('WS message error:', err);
    }
  };

  ws.onclose = () => {
    updateWsStatus('Gateway Disconnected', 'red');
    canvasOverlay.classList.remove('hidden');
    document.querySelector('.overlay-msg').textContent = 'Gateway offline. Reconnecting...';
    setTimeout(connectWebSocket, 1500);
  };

  ws.onerror = (err) => {
    ws.close();
  };
}

function updateWsStatus(text, color) {
  document.getElementById('ws-status-text').textContent = text;
  const dot = document.querySelector('#ws-status .pulse-dot');
  dot.className = `pulse-dot ${color}`;
}

// --- CLUSTER MONITORING & FAULT INJECTION ---

async function fetchClusterStatus() {
  try {
    const res = await fetch(`${GATEWAY_HTTP}/cluster-status`);
    const data = await res.json();

    updateClusterUI(data);
  } catch (err) {
    // Gateway unreachable
  }
}

function updateClusterUI(data) {
  const container = document.getElementById('node-cards');
  container.innerHTML = '';

  let leaderFound = false;

  data.replicas.forEach(node => {
    const card = document.createElement('div');
    const isLeader = node.state === 'LEADER' && !node.isOffline;
    const isOffline = node.isOffline || node.state === 'OFFLINE';

    card.className = `node-card ${isLeader ? 'is-leader' : ''} ${isOffline ? 'is-offline' : ''}`;

    if (isLeader) {
      leaderFound = true;
      if (lastLeaderId !== node.id) {
        if (lastLeaderId !== null) {
          logEvent(`👑 LEADER FAILOVER! ${node.id} elected as new Leader (Term ${node.currentTerm})`, 'warning');
        } else {
          logEvent(`👑 Cluster Leader established: ${node.id} (Term ${node.currentTerm})`, 'success');
        }
        lastLeaderId = node.id;
      }
      lastTerm = node.currentTerm;
    }

    const roleClass = isOffline ? 'OFFLINE' : node.state;

    card.innerHTML = `
      <div class="node-header">
        <span class="node-title">
          <span class="pulse-dot ${isOffline ? 'red' : isLeader ? 'green' : 'grey'}"></span>
          ${node.id.toUpperCase()} (Port ${node.port || '---'})
        </span>
        <span class="role-badge ${roleClass}">${roleClass}</span>
      </div>
      <div class="node-details">
        <span>Term: <strong>${isOffline ? '--' : node.currentTerm}</strong></span>
        <span>Log Size: <strong>${isOffline ? '--' : node.logLength}</strong></span>
        <span>Commit: <strong>${isOffline ? '--' : node.commitIndex}</strong></span>
      </div>
      <div class="node-controls">
        <button class="btn-ctrl kill" onclick="simCrashNode('${node.port}')" ${isOffline ? 'disabled' : ''}>
          Kill Node
        </button>
        <button class="btn-ctrl restart" onclick="simRestartNode('${node.port}')">
          Restart Node
        </button>
      </div>
    `;

    container.appendChild(card);
  });

  // Update summary metrics
  document.getElementById('metric-term').textContent = lastTerm || '--';
  document.getElementById('metric-leader').textContent = lastLeaderId || 'Election...';
  document.getElementById('leader-text').textContent = lastLeaderId ? `Leader: ${lastLeaderId.toUpperCase()}` : 'Re-electing Leader...';

  if (!leaderFound && lastLeaderId) {
    logEvent('⚠️ Active Leader lost! RAFT Election in progress...', 'danger');
    lastLeaderId = null;
  }
}

window.simCrashNode = async function(port) {
  try {
    await fetch(`http://localhost:${port}/sim-crash`, { method: 'POST' });
    logEvent(`💥 Simulated node crash on port ${port}`, 'danger');
    fetchClusterStatus();
  } catch (err) {
    console.error(err);
  }
};

window.simRestartNode = async function(port) {
  try {
    await fetch(`http://localhost:${port}/sim-restart`, { method: 'POST' });
    logEvent(`🔄 Node on port ${port} restarted (Syncing missing logs...)`, 'success');
    fetchClusterStatus();
  } catch (err) {
    console.error(err);
  }
};

// --- LOGGING CONSOLE ---

function logEvent(msg, type = 'info') {
  const consoleElem = document.getElementById('log-console');
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${msg}`;
  consoleElem.appendChild(entry);
  consoleElem.scrollTop = consoleElem.scrollHeight;
}

document.getElementById('btn-clear-log').addEventListener('click', () => {
  document.getElementById('log-console').innerHTML = '';
});

// Start loop
connectWebSocket();
fetchClusterStatus();
setInterval(fetchClusterStatus, 400);
