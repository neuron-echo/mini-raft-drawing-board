# Distributed Real-Time Drawing Board with Mini-RAFT

A real-time collaborative drawing application built around a custom Mini-RAFT consensus protocol. The system uses a WebSocket gateway and a three-node replica cluster to replicate drawing events, handle leader failures, and maintain a consistent canvas state across connected clients.

## Overview

The project combines real-time communication with distributed systems concepts. Drawing strokes from clients are sent through the gateway to the current RAFT leader. The leader replicates each stroke to the other replicas and commits it once a majority of nodes acknowledge it. Committed strokes are then broadcast to connected clients.

The replica cluster supports leader election, heartbeats, log replication, node recovery, and log synchronization when a failed replica rejoins the cluster.

## Key Features

- **Mini-RAFT Consensus**
  - Follower, Candidate, and Leader states
  - Randomized election timeout of 500–800 ms
  - Periodic leader heartbeats
  - Term-based leader election
  - Majority-based log commitment

- **Log Replication**
  - Drawing strokes are stored in an append-only log
  - The leader replicates entries to follower nodes
  - An entry is committed after acknowledgment from a majority of replicas
  - Committed entries are not overwritten

- **Fault Tolerance**
  - Detects leader failures through missed heartbeats
  - Automatically starts a new election
  - Gateway redirects new strokes to the current leader
  - WebSocket clients remain connected during failover

- **Replica Recovery**
  - A restarted replica joins as a follower
  - Missing committed entries are requested from the leader through `/sync-log`
  - The replica catches up before continuing normal operation

- **Real-Time Collaboration**
  - Browser clients connect through WebSockets
  - Drawing strokes are propagated to connected clients in real time
  - Multiple browser tabs can collaborate on the same canvas

- **Cluster Monitoring & Failure Testing**
  - View the current leader, term, replica state, log size, and commit index
  - Simulate replica crashes and restarts from the dashboard
  - Observe leader elections and replica recovery

## Architecture

```text
                         Browser Clients
                               |
                               | WebSocket
                               v
                    +-----------------------+
                    |    Gateway Service    |
                    |       Port 4000       |
                    +-----------+-----------+
                                |
                    +-----------+-----------+
                    |                       |
             Forward strokes          Broadcast commits
                    |                       |
                    v                       v
        +---------------+     +---------------+     +---------------+
        |   Replica 1   |<--->|   Replica 2   |<--->|   Replica 3   |
        |   Port 5001   |     |   Port 5002   |     |   Port 5003   |
        +---------------+     +---------------+     +---------------+
                 \_________________ RAFT __________________/
