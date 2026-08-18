# Distributed Real-Time Drawing Board with Mini-RAFT Consensus

A fault-tolerant, high-performance distributed real-time collaborative drawing board powered by a custom **Mini-RAFT consensus protocol**, a **WebSocket Gateway**, and a **Real-Time Interactive Canvas with Live Cluster Observability Dashboard**.

---

## 🌟 Resume Highlights & Core Engineering Concepts

- **Distributed Consensus (Mini-RAFT)**: Implemented leader election, term maintenance, heartbeat broadcasting, log replication, and majority quorum validation ($\ge 2/3$ replicas).
- **Fault Tolerance & Zero-Downtime Failover**: System handles replica node crashes seamlessly. If a Leader fails, remaining followers detect missed heartbeats and elect a new Leader within 500–800ms while maintaining active WebSocket client sessions.
- **Log Catch-Up & Rejoin Protocol**: Restarted nodes start in `FOLLOWER` state with empty logs, automatically trigger `/sync-log` catch-up RPCs with the active Leader, and backfill all missing committed entries.
- **WebSocket Gateway Architecture**: Single entry point for clients (Port 4000) that auto-discovers and routes canvas stroke events to the active RAFT Leader, and broadcasts committed strokes to all connected clients.
- **Live Cluster Observability & Chaos Dashboard**: Features interactive buttons to crash (`/sim-crash`) or restart (`/sim-restart`) individual nodes live in the browser, showing real-time election shifts and metrics.

---

## 🏗️ System Architecture

```
                                  +-------------------+
                                  |  Browser Clients  |
                                  +---------+---------+
                                            |
                                            | WebSockets (ws://localhost:4000)
                                            v
                                  +-------------------+
                                  |  Gateway Service  |
                                  |    (Port 4000)    |
                                  +----+--------+-----+
                                       |        |
         Sends Incoming Strokes to     |        | Broadcasts Committed
             Active Leader ONLY        |        |      Strokes
                                       v        v
         +-----------------------------+--------+-----------------------------+
         |                             |                                      |
         v                             v                                      v
  +--------------+              +--------------+               +--------------+
  |  Replica 1   | <== HTTP ==> |  Replica 2   |  <== HTTP ==> |  Replica 3   |
  | (Port 5001)  |   (RAFT)     | (Port 5002)  |    (RAFT)     | (Port 5003)  |
  +--------------+              +--------------+               +--------------+
```

---

## 🚀 How to Run

### Option 1: Native Local Execution (Single Command)

```bash
# 1. Install dependencies
npm install

# 2. Launch the entire cluster (3 Replicas + Gateway + Frontend UI)
npm start
```

Once started:
- Open **`http://localhost:3000`** in your browser to view the **Drawing Canvas & Live RAFT Cluster Dashboard**.
- Open multiple tabs at `http://localhost:3000` to test real-time collaborative drawing across clients!

---

### Option 2: Docker Compose (Multi-Container)

```bash
docker-compose up --build
```

---

## 🔌 API Endpoints Summary

### Replica RPC Endpoints (Ports 5001, 5002, 5003)
- `POST /request-vote` - Candidate vote request
- `POST /append-entries` - Leader heartbeat & log replication
- `POST /sync-log` - Catch-up log sync for rejoining nodes
- `POST /submit-stroke` - Stroke submission to active Leader
- `GET /status` - Node status (role, term, log size, commitIndex, leaderId)
- `POST /sim-crash` - Simulates node crash for testing
- `POST /sim-restart` - Simulates node restart & catch-up sync

### Gateway Endpoints (Port 4000)
- `ws://localhost:4000` - WebSocket client endpoint
- `GET /cluster-status` - Aggregated status of all 3 replicas
- `POST /broadcast-stroke` - Leader notification for committed strokes
