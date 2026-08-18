process.env.NODE_ID = process.env.NODE_ID || 'replica2';
process.env.PORT = process.env.PORT || '5002';
process.env.PEERS = process.env.PEERS || 'http://localhost:5001,http://localhost:5003';
process.env.GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';

require('../replicas/server.js');
