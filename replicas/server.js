const express = require('express');
const cors = require('cors');
const RaftNode = require('./raftNode');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const NODE_ID = process.env.NODE_ID || 'replica1';
const PORT = parseInt(process.env.PORT || '5001', 10);
const PEERS = (process.env.PEERS || 'http://localhost:5002,http://localhost:5003')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';

const node = new RaftNode({
  id: NODE_ID,
  port: PORT,
  peers: PEERS,
  gatewayUrl: GATEWAY_URL
});

// --- RAFT RPC ENDPOINTS ---

app.post('/request-vote', (req, res) => {
  const result = node.handleRequestVote(req.body);
  res.json(result);
});

app.post('/append-entries', (req, res) => {
  const result = node.handleAppendEntries(req.body);
  res.json(result);
});

app.post('/heartbeat', (req, res) => {
  const result = node.handleAppendEntries(req.body);
  res.json(result);
});

app.post('/sync-log', (req, res) => {
  const result = node.handleSyncLog(req.body);
  res.json(result);
});

app.post('/submit-stroke', async (req, res) => {
  const result = await node.submitStroke(req.body.stroke);
  res.json(result);
});

app.get('/status', (req, res) => {
  res.json(node.getStatus());
});

app.get('/log', (req, res) => {
  res.json({
    id: node.id,
    commitIndex: node.commitIndex,
    log: node.log
  });
});

// --- FAULT INJECTION CONTROLS FOR DEMO / RESUME DASHBOARD ---

app.post('/sim-crash', (req, res) => {
  node.simCrash();
  res.json({ success: true, message: `Node ${node.id} simulated crash` });
});

app.post('/sim-restart', (req, res) => {
  node.simRestart();
  res.json({ success: true, message: `Node ${node.id} restarted` });
});

app.listen(PORT, () => {
  console.log(`[${NODE_ID}] Server listening on port ${PORT}`);
});
