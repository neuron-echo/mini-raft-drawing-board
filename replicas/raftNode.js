const axios = require('axios');

class RaftNode {
  constructor({ id, port, peers, gatewayUrl }) {
    this.id = id; // e.g., "replica1"
    this.port = port;
    this.peers = peers; // Array of peer base URLs e.g. ["http://localhost:5002", "http://localhost:5003"]
    this.gatewayUrl = gatewayUrl; // e.g. "http://localhost:4000"

    // RAFT State
    this.state = 'FOLLOWER'; // FOLLOWER, CANDIDATE, LEADER
    this.currentTerm = 0;
    this.votedFor = null;
    this.log = []; // Array of log entries: { term, index, stroke }
    this.commitIndex = -1;
    this.leaderId = null;

    // Leader volatile tracking per follower
    this.nextIndex = {};
    this.matchIndex = {};

    // Timers
    this.electionTimeout = null;
    this.heartbeatTimer = null;
    this.isOffline = false;

    // Callbacks
    this.onCommitCallback = null;

    console.log(`[${this.id}] Initialized on port ${this.port}. Peers:`, this.peers);
    this.resetElectionTimer();
  }

  // --- TIMER MANAGEMENT ---

  getRandomElectionTimeout() {
    // 500ms to 800ms random timeout as required by spec
    return Math.floor(Math.random() * 300) + 500;
  }

  resetElectionTimer() {
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    if (this.isOffline) return;

    const timeout = this.getRandomElectionTimeout();
    this.electionTimeout = setTimeout(() => {
      this.handleElectionTimeout();
    }, timeout);
  }

  handleElectionTimeout() {
    if (this.isOffline || this.state === 'LEADER') return;
    console.log(`[${this.id}] Election timeout reached! Initiating election for term ${this.currentTerm + 1}...`);
    this.startElection();
  }

  startHeartbeats() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.isOffline || this.state !== 'LEADER') return;

    // Heartbeat every 150ms as required by spec
    this.heartbeatTimer = setInterval(() => {
      this.sendAppendEntries();
    }, 150);
  }

  stopHeartbeats() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // --- ELECTION LOGIC ---

  async startElection() {
    if (this.isOffline) return;

    this.state = 'CANDIDATE';
    this.currentTerm += 1;
    this.votedFor = this.id;
    this.leaderId = null;
    let votesReceived = 1; // Vote for self

    this.resetElectionTimer();

    const lastLogIndex = this.log.length - 1;
    const lastLogTerm = lastLogIndex >= 0 ? this.log[lastLogIndex].term : 0;

    console.log(`[${this.id}] Started election for term ${this.currentTerm}`);

    const votePromises = this.peers.map(async (peerUrl) => {
      try {
        const res = await axios.post(`${peerUrl}/request-vote`, {
          term: this.currentTerm,
          candidateId: this.id,
          lastLogIndex,
          lastLogTerm
        }, { timeout: 300 });

        if (res.data.term > this.currentTerm) {
          this.stepDown(res.data.term);
          return false;
        }

        if (res.data.voteGranted && this.state === 'CANDIDATE') {
          return true;
        }
      } catch (err) {
        // Peer unreachable or offline
      }
      return false;
    });

    const results = await Promise.all(votePromises);
    votesReceived += results.filter(Boolean).length;

    console.log(`[${this.id}] Election result for term ${this.currentTerm}: ${votesReceived}/${this.peers.length + 1} votes`);

    // Majority quorum requirement (>= 2 out of 3)
    const majority = Math.floor((this.peers.length + 1) / 2) + 1;
    if (this.state === 'CANDIDATE' && votesReceived >= majority) {
      this.becomeLeader();
    }
  }

  becomeLeader() {
    if (this.isOffline) return;
    this.state = 'LEADER';
    this.leaderId = this.id;
    if (this.electionTimeout) clearTimeout(this.electionTimeout);

    console.log(`\n==============================================`);
    console.log(`[${this.id}] *** ELECTED LEADER FOR TERM ${this.currentTerm} ***`);
    console.log(`==============================================\n`);

    this.peers.forEach(peer => {
      this.nextIndex[peer] = this.log.length;
      this.matchIndex[peer] = -1;
    });

    this.startHeartbeats();
    this.sendAppendEntries(); // Send immediate heartbeat
  }

  stepDown(newTerm) {
    console.log(`[${this.id}] Stepping down to FOLLOWER for term ${newTerm}`);
    this.state = 'FOLLOWER';
    this.currentTerm = newTerm;
    this.votedFor = null;
    this.leaderId = null;
    this.stopHeartbeats();
    this.resetElectionTimer();
  }

  // --- RPC HANDLERS ---

  handleRequestVote({ term, candidateId, lastLogIndex, lastLogTerm }) {
    if (this.isOffline) return { term: this.currentTerm, voteGranted: false };

    if (term > this.currentTerm) {
      this.stepDown(term);
    }

    let voteGranted = false;
    const isTermOk = (term === this.currentTerm);
    const isVoteOk = (this.votedFor === null || this.votedFor === candidateId);

    const myLastLogIndex = this.log.length - 1;
    const myLastLogTerm = myLastLogIndex >= 0 ? this.log[myLastLogIndex].term : 0;

    const isLogUpToDate = (lastLogTerm > myLastLogTerm) ||
      (lastLogTerm === myLastLogTerm && lastLogIndex >= myLastLogIndex);

    if (isTermOk && isVoteOk && isLogUpToDate) {
      voteGranted = true;
      this.votedFor = candidateId;
      this.resetElectionTimer();
      console.log(`[${this.id}] Granted vote to ${candidateId} for term ${term}`);
    } else {
      console.log(`[${this.id}] Denied vote to ${candidateId} for term ${term} (termOk:${isTermOk}, voteOk:${isVoteOk}, logOk:${isLogUpToDate})`);
    }

    return { term: this.currentTerm, voteGranted };
  }

  handleAppendEntries({ term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit }) {
    if (this.isOffline) return { term: this.currentTerm, success: false, logLength: this.log.length };

    if (term < this.currentTerm) {
      return { term: this.currentTerm, success: false, logLength: this.log.length };
    }

    if (term > this.currentTerm || this.state !== 'FOLLOWER') {
      this.stepDown(term);
    }

    this.leaderId = leaderId;
    this.resetElectionTimer();

    // Check log consistency at prevLogIndex
    if (prevLogIndex >= 0) {
      if (prevLogIndex >= this.log.length) {
        // Follower log is shorter than leader's prevLogIndex -> request catch-up sync
        console.log(`[${this.id}] AppendEntries mismatch: prevLogIndex ${prevLogIndex} exceeds my log length ${this.log.length}`);
        return { term: this.currentTerm, success: false, logLength: this.log.length, needsSync: true };
      }
      if (this.log[prevLogIndex].term !== prevLogTerm) {
        console.log(`[${this.id}] AppendEntries mismatch at index ${prevLogIndex}: my term ${this.log[prevLogIndex].term} != leader term ${prevLogTerm}`);
        // Truncate conflicting log
        this.log = this.log.slice(0, prevLogIndex);
        return { term: this.currentTerm, success: false, logLength: this.log.length };
      }
    }

    // Append new entries if any
    if (entries && entries.length > 0) {
      for (const entry of entries) {
        if (entry.index < this.log.length) {
          if (this.log[entry.index].term !== entry.term) {
            this.log = this.log.slice(0, entry.index);
            this.log.push(entry);
          }
        } else {
          this.log.push(entry);
        }
      }
      console.log(`[${this.id}] Appended ${entries.length} log entries. Total log size: ${this.log.length}`);
    }

    // Update commit index
    if (leaderCommit > this.commitIndex) {
      const oldCommit = this.commitIndex;
      this.commitIndex = Math.min(leaderCommit, this.log.length - 1);
      console.log(`[${this.id}] Updated commitIndex: ${oldCommit} -> ${this.commitIndex}`);
    }

    return { term: this.currentTerm, success: true, matchIndex: this.log.length - 1 };
  }

  async sendAppendEntries() {
    if (this.isOffline || this.state !== 'LEADER') return;

    this.peers.forEach(async (peerUrl) => {
      try {
        const pNextIndex = this.nextIndex[peerUrl] !== undefined ? this.nextIndex[peerUrl] : this.log.length;
        const prevLogIndex = pNextIndex - 1;
        const prevLogTerm = prevLogIndex >= 0 && this.log[prevLogIndex] ? this.log[prevLogIndex].term : 0;
        const entries = this.log.slice(pNextIndex);

        const res = await axios.post(`${peerUrl}/append-entries`, {
          term: this.currentTerm,
          leaderId: this.id,
          prevLogIndex,
          prevLogTerm,
          entries,
          leaderCommit: this.commitIndex
        }, { timeout: 300 });

        if (res.data.term > this.currentTerm) {
          this.stepDown(res.data.term);
          return;
        }

        if (res.data.success) {
          this.nextIndex[peerUrl] = pNextIndex + entries.length;
          this.matchIndex[peerUrl] = this.nextIndex[peerUrl] - 1;
          this.checkAndCommitLog();
        } else if (res.data.needsSync) {
          // Trigger catch-up sync protocol for lagging/restarted node
          console.log(`[${this.id}] Peer ${peerUrl} requires catch-up sync from index ${res.data.logLength}`);
          this.triggerCatchUpSync(peerUrl, res.data.logLength);
        } else {
          // Decrement nextIndex and retry on next heartbeat cycle
          this.nextIndex[peerUrl] = Math.max(0, pNextIndex - 1);
        }
      } catch (err) {
        // Peer unreachable
      }
    });
  }

  // --- LOG COMMIT & CATCH-UP SYNC ---

  checkAndCommitLog() {
    if (this.state !== 'LEADER') return;

    for (let N = this.log.length - 1; N > this.commitIndex; N--) {
      if (this.log[N].term === this.currentTerm) {
        let count = 1; // Count self
        this.peers.forEach(peerUrl => {
          if (this.matchIndex[peerUrl] >= N) count++;
        });

        const majority = Math.floor((this.peers.length + 1) / 2) + 1;
        if (count >= majority) {
          const oldCommit = this.commitIndex;
          this.commitIndex = N;
          console.log(`[${this.id}] *** COMMITTED LOG ENTRY ${N} (Majority ${count}/${this.peers.length + 1}) ***`);

          // Notify Gateway of committed stroke
          this.notifyGatewayCommittedStrokes(oldCommit + 1, N);
          break;
        }
      }
    }
  }

  async notifyGatewayCommittedStrokes(fromIndex, toIndex) {
    if (!this.gatewayUrl) return;
    for (let i = fromIndex; i <= toIndex; i++) {
      const entry = this.log[i];
      if (entry && entry.stroke) {
        try {
          await axios.post(`${this.gatewayUrl}/broadcast-stroke`, {
            stroke: entry.stroke,
            index: entry.index,
            leaderId: this.id
          }, { timeout: 500 });
        } catch (err) {
          console.error(`[${this.id}] Failed to notify gateway of stroke ${i}:`, err.message);
        }
      }
    }
  }

  // Catch-Up Protocol (Restarted / Lagging Nodes)
  // Per Section 4.3 of PDF Spec:
  // Leader calls /sync-log on follower sending all committed entries from index N onward
  async triggerCatchUpSync(peerUrl, followerLogLength) {
    const fromIndex = followerLogLength;
    const committedEntries = this.log.filter((entry, idx) => idx >= fromIndex && idx <= this.commitIndex);

    try {
      console.log(`[${this.id}] Sending /sync-log to ${peerUrl} with ${committedEntries.length} entries starting from index ${fromIndex}`);
      const res = await axios.post(`${peerUrl}/sync-log`, {
        leaderId: this.id,
        term: this.currentTerm,
        fromIndex,
        entries: committedEntries,
        leaderCommit: this.commitIndex
      }, { timeout: 1000 });

      if (res.data.success) {
        this.nextIndex[peerUrl] = res.data.logLength;
        this.matchIndex[peerUrl] = res.data.logLength - 1;
        console.log(`[${this.id}] Catch-up sync complete for ${peerUrl}! Node now has log length ${res.data.logLength}`);
      }
    } catch (err) {
      console.error(`[${this.id}] Catch-up sync failed for ${peerUrl}:`, err.message);
    }
  }

  handleSyncLog({ leaderId, term, fromIndex, entries, leaderCommit }) {
    if (this.isOffline) return { success: false, logLength: this.log.length };

    if (term >= this.currentTerm) {
      this.stepDown(term);
      this.leaderId = leaderId;
    }

    console.log(`[${this.id}] Executing /sync-log: receiving ${entries.length} missing committed entries from index ${fromIndex}`);

    // Slice log up to fromIndex and append committed entries
    this.log = this.log.slice(0, fromIndex);
    for (const entry of entries) {
      this.log.push(entry);
    }

    this.commitIndex = Math.min(leaderCommit, this.log.length - 1);
    this.resetElectionTimer();

    console.log(`[${this.id}] Catch-up sync applied successfully! Log size: ${this.log.length}, commitIndex: ${this.commitIndex}`);

    return { success: true, logLength: this.log.length };
  }

  // --- STROKE SUBMISSION HANDLER ---

  async submitStroke(strokeData) {
    if (this.isOffline) {
      return { success: false, error: 'Node is offline' };
    }

    if (this.state !== 'LEADER') {
      return {
        success: false,
        error: 'Not leader',
        leaderId: this.leaderId
      };
    }

    const newIndex = this.log.length;
    const entry = {
      term: this.currentTerm,
      index: newIndex,
      stroke: strokeData
    };

    this.log.push(entry);
    console.log(`[${this.id}] Leader accepted new stroke. Local log index: ${newIndex}. Replicating to followers...`);

    // Initiate immediate replication round
    this.sendAppendEntries();

    return {
      success: true,
      status: 'pending_consensus',
      index: newIndex,
      term: this.currentTerm
    };
  }

  // --- SIMULATION & FAULT INJECTION CONTROLS ---

  simCrash() {
    console.log(`\n[${this.id}] !!! SIMULATING NODE CRASH / SHUTDOWN !!!`);
    this.isOffline = true;
    this.state = 'FOLLOWER';
    this.stopHeartbeats();
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
  }

  simRestart() {
    console.log(`\n[${this.id}] !!! RESTARTING NODE (Zero-Downtime Rejoin) !!!`);
    this.isOffline = false;
    // Per PDF spec: restarted node starts in Follower state with empty log
    this.state = 'FOLLOWER';
    this.log = [];
    this.commitIndex = -1;
    this.votedFor = null;
    this.leaderId = null;
    this.resetElectionTimer();
  }

  getStatus() {
    return {
      id: this.id,
      port: this.port,
      state: this.state,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      logLength: this.log.length,
      commitIndex: this.commitIndex,
      leaderId: this.leaderId,
      isOffline: this.isOffline
    };
  }
}

module.exports = RaftNode;
