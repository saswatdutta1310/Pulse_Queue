# PulseQueue ⚡
### Distributed Task Scheduler & Worker Execution Engine

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://react.dev/)
[![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&badgeColor=010101)](https://socket.io/)

> **High-Throughput Asynchronous Task Processing with Autonomous Failover, Distributed Leases, and Real-Time Telemetry**  
> *Engineered for the Synora Hackathon — Distributed Systems Track*

---

## 📌 1. Executive Summary & Problem Statement

Modern microservice architectures rely heavily on background asynchronous job execution for critical paths: payment processing, compliance reports, data synchronization (ETL), and webhook delivery.

### The Distributed Failure Dilemma
In high-throughput environments, worker machines crash unpredictably due to:
- **Out-of-Memory (OOM) Errors:** Large payloads causing silent process death.
- **Transient Network Partitions:** Slow responses misidentified as dead nodes.
- **Zombie Workers:** Frozen processes waking up late and writing stale results.
- **Poison Pill Tasks:** Malformed tasks that cause repeated crashes and queue starvation.

### The Solution: PulseQueue
**PulseQueue** is a resilient background job engine built on **Zero-Data-Loss Architecture**. It guarantees **At-Least-Once execution**, revokes zombie worker locks via **monotonic lease epochs**, isolates poison pills in a **Dead-Letter Queue (DLQ)** with exponential backoff, and provides **sub-100ms real-time telemetry** to an operations dashboard with a live Chaos Kill Switch.

---

## 🏗️ 2. Distributed System Architecture

The following diagram illustrates the complete end-to-end topology and lifecycle across the client, API gateway, Redis state layer, worker fleet, autonomous watchdog, and telemetry stream.

```mermaid
flowchart TD
    subgraph ClientLayer["🖥️ Presentation & Client Layer"]
        A["React 18 SPA (Vite + Tailwind)"]
        Landing["Public Landing Page & Sandbox"]
        Login["Google OAuth & RBAC Login"]
    end

    subgraph APILayer["🌐 Orchestration Plane (Express + WebSockets)"]
        Gateway["Express Gateway (Port 4000)"]
        AuthMiddleware["JWT / Role Guard (Admin / Viewer)"]
        SocketServer["Socket.IO Event Hub"]
        ProcMgr["Process Manager (Fleet Controller)"]
        DBStore[("Durable JSON Store & Audit Log")]
    end

    subgraph StateLayer["⚡ Distributed State (Redis 7)"]
        BullQueue["BullMQ Priority FIFO Queue"]
        DelayedSet["Timestamp Sorted Set (Delayed Jobs)"]
        LeaseEpochs["Key: job:epoch:<id> (Fencing Tokens)"]
        HeartbeatKeys["Key: worker:heartbeat:<id> (TTL 2s)"]
    end

    subgraph WorkerFleet["⚙️ Distributed Worker Fleet"]
        W1["Worker Node 1 (PID 1420)"]
        W2["Worker Node 2 (PID 1890)"]
        W3["Worker Node 3 (PID 2104)"]
    end

    subgraph Watchdog["🛡️ Autonomous Failover Engine"]
        Reaper["Heartbeat Reaper Daemon (Every 2.5s)"]
        DLQ["Dead-Letter Queue (DLQ)"]
    end

    %% Client Interactions
    A <-->|Sub-100ms Telemetry Stream| SocketServer
    A -->|REST API Requests| Gateway
    Landing --> Login
    Login -->|Bearer JWT| Gateway

    %% Gateway to State
    Gateway --> AuthMiddleware
    AuthMiddleware --> BullQueue
    AuthMiddleware --> ProcMgr
    Gateway --> DBStore

    %% Workers consuming
    BullQueue -->|Dequeue Job| W1
    BullQueue -->|Dequeue Job| W2
    BullQueue -->|Dequeue Job| W3

    %% Leases & Heartbeats
    W1 -->|Renew Lease every 2s| HeartbeatKeys
    W2 -->|Renew Lease every 2s| HeartbeatKeys
    W3 -->|Renew Lease every 2s| HeartbeatKeys

    W1 -.->|Check Fencing Epoch via Lua| LeaseEpochs
    W2 -.->|Check Fencing Epoch via Lua| LeaseEpochs
    W3 -.->|Check Fencing Epoch via Lua| LeaseEpochs

    %% Reaper Monitoring
    Reaper -->|Check missed beats > 5.5s| HeartbeatKeys
    Reaper -->|Worker Dead: INCR Epoch & Re-queue| LeaseEpochs
    Reaper -->|Max Retries Exceeded| DLQ
    Reaper -->|Alert Event| SocketServer

    %% Worker Process Lifecycle
    ProcMgr -->|Fork & taskkill / SIGKILL| W1
    ProcMgr -->|Fork & taskkill / SIGKILL| W2
    ProcMgr -->|Fork & taskkill / SIGKILL| W3
```

---

## 🔄 3. Failure & Recovery Lifecycle (State Machine)

The state machine below demonstrates how PulseQueue recovers orphaned tasks when a worker process crashes mid-execution:

```mermaid
stateDiagram-v2
    [*] --> Pending: Enqueued with Priority & Delay
    Pending --> Active: Worker claims lease (TTL 2s, Epoch N)
    
    state Active {
        [*] --> Processing
        Processing --> Heartbeating: Ping every 2s
        Heartbeating --> Processing
    }

    Active --> Completed: Processing Succeeded (Epoch matches N)
    Active --> Failed: Error thrown (attempts < maxAttempts)
    Failed --> Pending: Exponential Backoff (delay = 2^attempt * backoffMs)
    Failed --> DLQ: attempts >= maxAttempts (Quarantined)

    Active --> Crashed: Worker Process Killed (Chaos / OOM)
    
    state Crashed {
        [*] --> SilentHeartbeat
        SilentHeartbeat --> ReaperDetect: 5.5s Elapsed (> 3 missed beats)
        ReaperDetect --> MarkDead: Worker Status = 'dead'
        MarkDead --> EpochBump: INCR job:epoch:<id> (N -> N+1)
        EpochBump --> Requeue: Prepend to Queue with Attempt+1
    }

    Crashed --> Pending: Reassigned to Healthy Worker
    DLQ --> Pending: Operator Manual Replay (1-Click)
    Completed --> [*]
```

---

## 🛡️ 4. Solving Core Distributed Systems Challenges

### 1. Zombie Worker Prevention (Monotonic Fencing Tokens)
* **The Vulnerability:** A worker experiences a prolonged Garbage Collection (GC) pause. The Reaper assumes it is dead, revokes its task, and gives it to Worker 2. Worker 1 wakes up and commits stale data to the database, causing split-brain writes.
* **Our Solution:** Every job has a Redis integer key `job:epoch:<jobId>`.
  When the Reaper reclaims a task, it executes an atomic Lua script that increments the epoch ($N \to N+1$). When Worker 1 wakes up, its completion script is rejected with:
  ```lua
  local currentEpoch = redis.call('GET', KEYS[1])
  if tonumber(currentEpoch) == tonumber(ARGV[1]) then
      redis.call('DEL', KEYS[2])
      return 1
  else
      return 0 -- REJECT STALE COMMIT
  end
  ```

### 2. Autonomous Heartbeat Reaper Daemon
* Runs every **2.5 seconds** independently of worker processes.
* Threshold: **5.5 seconds** ($\sim 3$ missed heartbeats).
* Total Failover Latency: **$< 6.0$ seconds** from instant of worker crash to task re-queuing.

### 3. Starvation Prevention & Priority Buckets
* High-priority jobs (Priority 10) are scheduled ahead of bulk jobs.
* Re-queued failover jobs are prepended to the head of their respective priority bucket to ensure timely recovery.

### 4. Exponential Backoff & Dead-Letter Queue (DLQ)
* Backoff formula: $\Delta t = \text{backoff\_ms} \times 2^{(\text{attempt} - 1)}$.
* After 3 failed attempts, poison pills are moved to the DLQ with complete error codes and stack traces.
* Operators can click **Replay** on the dashboard to safely re-inject fixed tasks.

---

## 📊 5. Core Feature Matrix

| Feature | Distributed Systems Mechanism | Value Delivered |
| :--- | :--- | :--- |
| **Monotonic Lease Epochs** | Redis atomic Lua scripts (`leaseManager.ts`) | Guaranteed prevention of zombie double-writes |
| **Heartbeat Reaper** | 2.5s sweeps, 5.5s expiration (`heartbeatReaper.ts`) | Autonomous sub-6s zero-data-loss failover |
| **Chaos Kill Switch** | Cross-platform OS `taskkill` & `SIGKILL` | Live deterministic evaluator demonstrations |
| **Real-time Telemetry** | Socket.IO WebSockets (`socket.ts`) | Sub-100ms updates for queue depth and worker health |
| **Google OAuth + RBAC** | Google Identity Services + JWT (`authService.ts`) | Admin (full control) vs Viewer (read-only telemetry) |
| **Liveness Supervisor Probe**| `GET /health/liveness` | Real-time watchdog health check for external monitors |
| **Automated Test Suite** | 8/8 automated distributed invariant tests | Deterministic test runner verifying lease transitions |

---

## 📂 6. Repository Layout

```text
Pulse_Queue/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── env.ts              # Configuration constants & timings
│   │   │   └── redis.ts            # Redis client singleton & connection pool
│   │   ├── db/
│   │   │   └── index.ts            # Durable JSON store with atomic file swapping
│   │   ├── middleware/
│   │   │   └── authMiddleware.ts   # JWT validation & RBAC guards
│   │   ├── services/
│   │   │   ├── authService.ts      # Google OAuth & 1-click evaluator tokens
│   │   │   ├── heartbeatReaper.ts  # Autonomous watchdog failover daemon
│   │   │   ├── leaseManager.ts     # Atomic Lua scripts & fencing tokens
│   │   │   ├── processManager.ts   # Worker process fleet controller & kill switch
│   │   │   └── queueService.ts     # BullMQ priority queue & DLQ engine
│   │   ├── worker/
│   │   │   └── workerRunner.ts     # Child process worker loop & IPC heartbeats
│   │   ├── testRunner.ts           # Distributed invariant automated test suite
│   │   └── server.ts               # Express API, liveness probe & Socket.IO server
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.tsx          # Sticky navigation, status pill & user avatar
│   │   │   ├── ProtectedRoute.tsx  # Authentication & RBAC route guard
│   │   │   └── SubmitJobModal.tsx  # Interactive job creation dialog
│   │   ├── context/
│   │   │   └── AuthContext.tsx     # Global auth state & session persistence
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx     # Public landing page with failover simulator
│   │   │   ├── LoginPage.tsx       # Google Sign-in & 1-click evaluator login
│   │   │   ├── Dashboard.tsx       # Telemetry control room & throughput charts
│   │   │   ├── WorkersFleet.tsx    # Live worker matrix & chaos kill switches
│   │   │   ├── JobsList.tsx        # Filterable jobs table with DLQ filter
│   │   │   ├── JobDetail.tsx       # Step-by-step attempt histories & stack traces
│   │   │   └── AuditLogs.tsx       # Chronological cryptographic security log
│   │   ├── services/
│   │   │   ├── api.ts              # REST client with Bearer token injection
│   │   │   └── socket.ts           # WebSocket connection manager
│   │   ├── App.tsx                 # Routing & global providers
│   │   └── main.tsx
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
├── shared/
│   └── types.ts                    # Shared TypeScript interfaces
├── infra/
│   └── redis.conf                  # Custom Redis AOF persistence config
├── README.md
└── PROJECT_OVERVIEW.md
```

---

## ⚡ 7. Quick Start & Setup Guide

### Prerequisites
1. **Node.js**: v18.0.0 or higher
2. **Redis Server**: Installed and accessible on `127.0.0.1:6379`

---

### Step 1: Start Redis Server
```powershell
redis-server
```
*(Verify Redis is listening on `127.0.0.1:6379`)*

---

### Step 2: Start Backend Server & Worker Fleet
Open a second terminal:
```powershell
cd backend
npm install
npm run dev
```
> **What happens automatically:**
> - Boots Express API and Socket.IO on `http://localhost:4000`
> - Initializes Heartbeat Reaper Daemon
> - Spawns 3 worker node processes (`worker-node-1`, `worker-node-2`, `worker-node-3`)
> - Connects to local Redis queue

---

### Step 3: Run Automated Distributed Invariant Tests
Open another terminal:
```powershell
cd backend
npm test
```
**Expected Output:**
```text
🧪 [Test Suite] Running PulseQueue Distributed Primitives Verification...
  ✅ PASS: Redis connection is operational
  ✅ PASS: Worker 1 acquired initial lease
  ✅ PASS: Initial lease epoch is 1
  ✅ PASS: Competing Worker 2 is rejected while lease is held
  ✅ PASS: Worker 1 successfully renewed active lease with current epoch
  ✅ PASS: Reaper bumped fencing epoch from 1 to 2 upon simulated failover
  ✅ PASS: Zombie worker with stale epoch 1 is REJECTED by fencing token
  ✅ PASS: Rescued worker with epoch 2 is successfully accepted and validated

📊 [Test Summary] Passed: 8, Failed: 0
```

---

### Step 4: Start Frontend Dashboard
Open another terminal:
```powershell
cd frontend
npm install
npm run dev
```
Access the application at:
👉 **[http://localhost:5173](http://localhost:5173)**

---

## 🧪 8. Live Judge Evaluation & Demo Walkthrough

When presenting to judges, follow this **3-minute live demonstration**:

1. **The Problem Showcase (Landing Page):**
   - Open `http://localhost:5173/`.
   - Scroll to the **"Live Failover & Reaper Simulator"** card.
   - Click **"Simulate Worker Crash"** to demonstrate the 3-step recovery lifecycle before entering the dashboard.

2. **Authentication & RBAC:**
   - Click **"Launch Control Plane"** $\to$ redirected to `/login`.
   - Click **"Judge / Evaluator (Admin)"** to sign in with full permissions.
   - Notice the cyan `ADMIN` badge and user profile in the top navbar.

3. **Task Ingestion:**
   - Click **"Enqueue Task"** $\to$ select **Batch Submission** $\to$ enqueue 10 tasks.
   - Watch the workers pick up tasks in parallel on the live throughput charts.

4. **The Live Chaos Kill Test:**
   - Navigate to **"Worker Fleet"** (`/workers`).
   - Find an actively processing worker node and click **"Kill Worker"**.
   - **Watch the system react in real-time:**
     - The targeted worker's PID is killed instantly via OS signal.
     - The status flips to `KILLED`.
     - In $< 5.5$ seconds, the Heartbeat Reaper logs a warning and reclaims the task.
     - The task is reassigned to another healthy worker.
     - The top counter increments: `1 recovered`.
     - The task completes with **0 data loss**.

5. **Poison Pill & Dead-Letter Queue (DLQ):**
   - Enqueue a `fault_simulation` task.
   - Observe it retry with exponential delays before safely retiring into the **Dead-Letter Queue**.
   - Navigate to `/jobs?status=dead`, inspect the exact error stack trace, and click **"Replay"** to demonstrate manual recovery.

---

## 📜 9. License
MIT License. Built for the Synora Hackathon / Distributed Systems Track.
