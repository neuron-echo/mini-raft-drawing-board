const { spawn } = require('child_process');
const path = require('path');
const express = require('express');

console.log(`
========================================================================
   🚀 DISTRIBUTED REAL-TIME DRAWING BOARD WITH MINI-RAFT CONSENSUS
========================================================================
`);

// 1. Start Frontend Static Web Server on Port 3000
const app = express();
app.use(express.static(path.join(__dirname, 'frontend')));
app.listen(3000, () => {
  console.log(`[Frontend UI] Dashboard & Canvas running at: http://localhost:3000`);
});

// Helper to spawn sub-processes cleanly
function runService(name, entryFile, envVars = {}) {
  const childEnv = { ...process.env, ...envVars };
  const child = spawn('node', [entryFile], {
    cwd: __dirname,
    env: childEnv,
    stdio: 'pipe'
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) console.log(`[${name}] ${line}`);
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) console.error(`[${name} ERROR] ${line}`);
    });
  });

  child.on('close', (code) => {
    console.log(`[${name}] Process exited with code ${code}`);
  });

  return child;
}

// 2. Start Gateway Service (Port 4000)
runService('Gateway', 'gateway/server.js', {
  PORT: '4000',
  REPLICAS: 'http://localhost:5001,http://localhost:5002,http://localhost:5003'
});

// 3. Start Replica 1 (Port 5001)
runService('Replica-1', 'replica1/index.js', {
  NODE_ID: 'replica1',
  PORT: '5001',
  PEERS: 'http://localhost:5002,http://localhost:5003',
  GATEWAY_URL: 'http://localhost:4000'
});

// 4. Start Replica 2 (Port 5002)
runService('Replica-2', 'replica2/index.js', {
  NODE_ID: 'replica2',
  PORT: '5002',
  PEERS: 'http://localhost:5001,http://localhost:5003',
  GATEWAY_URL: 'http://localhost:4000'
});

// 5. Start Replica 3 (Port 5003)
runService('Replica-3', 'replica3/index.js', {
  NODE_ID: 'replica3',
  PORT: '5003',
  PEERS: 'http://localhost:5001,http://localhost:5002',
  GATEWAY_URL: 'http://localhost:4000'
});

console.log(`\n[Cluster Status] Launching 3 Replicas + Gateway. Open http://localhost:3000 in your browser!\n`);
