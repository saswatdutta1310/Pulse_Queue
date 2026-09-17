# PulseQueue ⚡
### Distributed Task Scheduler & Worker Execution Engine

> **High-Throughput Asynchronous Task Processing with Autonomous Failover, Distributed Leases, and Real-Time Telemetry**

Built for the **Synora Hackathon — Distributed Systems Track**.

---

## 📌 Problem Statement & Architecture

Modern microservice architectures process millions of background workloads (financial reconciliations, webhooks, analytics, data pipelines). When a worker node crashes mid-execution (Out-Of-Memory, network partition, or unhandled exception), standard queue implementations often leave tasks orphaned, locked, or cause double execution.

**PulseQueue** provides an autonomous, self-healing distributed task execution engine built on:
- **At-Least-Once Execution Semantics** with atomic fencing tokens and monotonic lease epochs.
- **Autonomous Heartbeat Reaper Daemon** detecting node failure in $\le 5.5$ seconds and re-balancing tasks to healthy nodes.
- **Dead-Letter Queue (DLQ)** with exponential backoff to isolate poison pills and prevent queue starvation.
- **Chaos Engineering "Kill Switch"** to demonstrate live failover on demand.
- **Sub-100ms WebSocket Telemetry** streaming queue depths, worker PIDs, memory, and audit trails to a React operations dashboard.
- **Google Identity OAuth 2.0 & Role-Based Access Control (Admin / Viewer)**.

---

## 🏗️ System Flow Diagram

```
                             ┌───────────────────────────────────┐
                             │       PulseQueue Client / UI      │
                             └─────────────────┬─────────────────┘
                                               │ (Enqueue Task: Priority 1-10, Delay, Payload)
                                               ▼
                             ┌───────────────────────────────────┐
                             │      Express API & Controller     │
                             │ (JWT Auth / Google Identity RBAC) │
                             └─────────────────┬─────────────────┘
                                               │
                                               ▼
                             ┌───────────────────────────────────┐
                             │      Redis Distributed State      │
                             │  - Priority Queues (BullMQ)       │
                             │  - Delayed Tasks (Sorted Set)     │
                             │  - Time-to-Live Leases (TTL 2s)   │
                             └────────┬─────────────────┬────────┘
                                      │                 │
              ┌───────────────────────┴──────┐   ┌──────┴───────────────────────┐
              ▼                              ▼   ▼                              ▼
      [ Worker Node 1 ]              [ Worker Node 2 ]                  [ Worker Node 3 ]
    (PID: 12450 | Memory: 42MB)    (PID: 14890 | Memory: 38MB)        (PID: 15320 | Memory: 40MB)
    Claims Lease (TTL 2s)          Claims Lease (TTL 2s)              Claims Lease (TTL 2s)
    Sends Heartbeat (every 2s)     Sends Heartbeat (every 2s)         Sends Heartbeat (every 2s)
              │                              │                                  │
              └──────────────────────────────┼──────────────────────────────────┘
                                             │
                                             ▼
                             ┌───────────────────────────────────┐
                             │      Heartbeat Reaper Daemon      │
                             │     (Scans Cluster every 2.5s)    │
                             └───────────────┬───────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
             [ Heartbeat < 5.5s ]                        [ Heartbeat > 5.5s ]
           Node Healthy / Online                        Node Declared DEAD ⚡
                                                        - Revoke Expired Lease
                                                        - Bump Fencing Epoch
                                                        - Re-queue to healthy node
                                                                   │
                                                                   ▼ (If attempts > maxAttempts)
                                                        ┌───────────────────────────────────┐
                                                        │      Dead-Letter Queue (DLQ)      │
                                                        │  - Poison pill quarantined        │
                                                        │  - 1-click operator replay        │
                                                        └───────────────────────────────────┘
```

---

## 🚀 Key Features

| Feature | Distributed Systems Mechanism | Value |
| :--- | :--- | :--- |
| **Monotonic Lease Epochs** | Redis atomic Lua script (`complete_job.lua`) | Eliminates zombie worker writes after lease recovery |
| **Autonomous Heartbeat Reaper** | 2.5s cluster sweeps, 5.5s missed heartbeat threshold | $\le 6$ second automatic failover without human intervention |
| **Priority & Delayed Queues** | BullMQ priority buckets & Redis timestamp-scored sorted sets | Prevents queue starvation for high-priority workflows |
| **Exponential Backoff & DLQ** | $\text{delay} = \text{backoff\_ms} \times 2^{(\text{attempt} - 1)}$ | Quarantines repeatedly failing tasks without blocking main queue |
| **Chaos "Kill Worker" Trigger** | OS-level `taskkill /F /PID` & `SIGKILL` | Live testable failover directly from UI |
| **Event-Driven Telemetry** | Socket.IO bi-directional WebSocket push | Zero HTTP polling; sub-100ms cluster metrics updates |
| **Google Identity & RBAC** | Google OAuth 2.0 with stateless JWT tokens | Admin (kill workers, replay DLQ) vs Viewer (read-only) |
| **Automated Test Suite** | 8/8 automated distributed invariant tests | Deterministic verification of lease fencing and failovers |

---

## 🛠️ Technology Stack

- **Backend:** Node.js 18+, TypeScript, Express, BullMQ, Redis, Socket.IO, JWT
- **Frontend:** React 18, Vite, TailwindCSS, Recharts, Lucide Icons
- **Infrastructure:** Docker, Docker Compose, Redis 7 (AOF persistence)

---

## ⚡ Quick Start

### Option 1: Using Docker Compose (Recommended)
```bash
docker compose up --build
```
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000`
- Health Probe: `http://localhost:4000/health/liveness`

### Option 2: Local Development

#### 1. Start Redis Server
```powershell
redis-server
```

#### 2. Start Backend & Worker Fleet
```powershell
cd backend
npm install
npm run dev
```

#### 3. Run Automated Tests
```powershell
cd backend
npm test
```

#### 4. Start Frontend Dashboard
```powershell
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser.

---

## 📜 License
MIT License
