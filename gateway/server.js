const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const axios = require('axios');

const PORT = parseInt(process.env.PORT || '4000', 10);
const REPLICAS = (process.env.REPLICAS || 'http://localhost:5001,http://localhost:5002,http://localhost:5003')
  .split(',')
  .map(r => r.trim());

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let activeLeaderUrl = null;
let activeLeaderId = null;

// Periodically discover the current active LEADER
async function discoverLeader() {
  for (const replicaUrl of REPLICAS) {
    try {
      const res = await axios.get(`${replicaUrl}/status`, { timeout: 300 });
      if (res.data && res.data.state === 'LEADER' && !res.data.isOffline) {
        if (activeLeaderId !== res.data.id) {
          console.log(`[Gateway] Detected Active Leader: ${res.data.id} at ${replicaUrl} (Term ${res.data.currentTerm})`);
        }
        activeLeaderUrl = replicaUrl;
        activeLeaderId = res.data.id;
        return;
      }
    } catch (err) {
      // Replica offline or unreachable
    }
  }
}

setInterval(discoverLeader, 250);

// Endpoint for Leader to push committed strokes to Gateway
app.post('/broadcast-stroke', (req, res) => {
  const { stroke, index, leaderId } = req.body;

  // Broadcast to all WebSocket clients
  const message = JSON.stringify({
    type: 'stroke_committed',
    stroke,
    index,
    leaderId
  });

  let clientCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      clientCount++;
    }
  });

  res.json({ success: true, clientsNotified: clientCount });
});

// Endpoint for Gateway cluster status overview
app.get('/cluster-status', async (req, res) => {
  const statusPromises = REPLICAS.map(async (url) => {
    try {
      const resp = await axios.get(`${url}/status`, { timeout: 400 });
      return resp.data;
    } catch (err) {
      return { id: url, state: 'OFFLINE', isOffline: true };
    }
  });

  const cluster = await Promise.all(statusPromises);
  res.json({
    activeLeaderId,
    activeLeaderUrl,
    replicas: cluster
  });
});

// WebSocket Handling
wss.on('connection', async (ws) => {
  console.log(`[Gateway] New WebSocket client connected. Total clients: ${wss.clients.size}`);

  // Fetch stroke history from leader and send to client
  await syncClientHistory(ws);

  ws.on('message', async (messageData) => {
    try {
      const data = JSON.parse(messageData.toString());

      if (data.type === 'draw_stroke') {
        await forwardStrokeToLeader(data.stroke);
      } else if (data.type === 'request_sync') {
        await syncClientHistory(ws);
      }
    } catch (err) {
      console.error('[Gateway] Error handling client message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[Gateway] Client disconnected. Remaining: ${wss.clients.size}`);
  });
});

async function forwardStrokeToLeader(stroke) {
  // If leader unknown, try discovery immediately
  if (!activeLeaderUrl) {
    await discoverLeader();
  }

  if (!activeLeaderUrl) {
    console.error('[Gateway] Cannot forward stroke: No active RAFT leader found!');
    return;
  }

  try {
    const res = await axios.post(`${activeLeaderUrl}/submit-stroke`, { stroke }, { timeout: 1000 });
    if (!res.data.success && res.data.error === 'Not leader') {
      console.log('[Gateway] Leader changed! Re-discovering leader...');
      await discoverLeader();
      if (activeLeaderUrl) {
        await axios.post(`${activeLeaderUrl}/submit-stroke`, { stroke }, { timeout: 1000 });
      }
    }
  } catch (err) {
    console.error(`[Gateway] Failed to send stroke to leader at ${activeLeaderUrl}:`, err.message);
    activeLeaderUrl = null;
    await discoverLeader();
  }
}

async function syncClientHistory(ws) {
  if (!activeLeaderUrl) await discoverLeader();
  if (!activeLeaderUrl) return;

  try {
    const res = await axios.get(`${activeLeaderUrl}/log`, { timeout: 600 });
    if (res.data && res.data.log) {
      const committedStrokes = res.data.log
        .filter(entry => entry.index <= res.data.commitIndex && entry.stroke)
        .map(entry => entry.stroke);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'init_history',
          strokes: committedStrokes,
          commitIndex: res.data.commitIndex,
          leaderId: res.data.id
        }));
      }
    }
  } catch (err) {
    console.error('[Gateway] Failed to fetch log history from leader:', err.message);
  }
}

server.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`[Gateway] Server running at http://localhost:${PORT}`);
  console.log(`[Gateway] WebSocket server listening on ws://localhost:${PORT}`);
  console.log(`=================================================\n`);
});
