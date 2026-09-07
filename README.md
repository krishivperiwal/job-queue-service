# 🛠 Job Queue Service
A distributed backend system for submitting, queueing, retrying, and monitoring asynchronous background jobs — built around AWS SQS, PostgreSQL, and Redis.

---

## Live Demo
Not deployed yet — runs locally via Docker Compose (see **Run Locally** below).

---

## ❗ Problem
Processing work synchronously inside an API request doesn't scale — slow or failure-prone tasks (like image processing) block the request thread and have no retry mechanism if they fail.
This system decouples job submission from job execution: the API accepts a job and returns immediately, while a separate worker processes it in the background with automatic retries and failure tracking.

---

## 🔗 Key Features
* 📥 REST API for submitting jobs, validated with Zod before persistence
* 🆔 UUID-based job identifiers, durable in PostgreSQL
* 🔄 Full job lifecycle tracking (`pending → processing → completed/failed`)
* 📨 AWS SQS-based queueing with long polling
* 🔁 Automatic retry via SQS visibility timeout and redelivery
* ☠️ Failure detection using `ApproximateReceiveCount`, with DLQ-compatible retry limits
* ♻️ Manual replay of failed jobs via API
* ✅ Idempotent job claiming — atomic DB update prevents duplicate SQS delivery from double-processing a job
* 🩺 Background reconciler that recovers jobs orphaned by a failed SQS publish (`SELECT ... FOR UPDATE SKIP LOCKED`)
* 📊 Live queue-depth tracking via Redis
* 🖥 React dashboard polling job status in real time
* 🛠 Independently runnable API, worker, and dashboard services
* 🐳 Fully Dockerized with multi-stage builds

---

## ⚙️ Tech Stack
* Node.js
* Express.js
* TypeScript
* PostgreSQL (`pg`)
* Redis (`ioredis`)
* AWS SQS (`@aws-sdk/client-sqs`)
* Zod
* React + Vite
* Docker / Docker Compose

---

## 🏗 Architecture
Follows a distributed, service-per-responsibility architecture:
* **api/** → Accepts and validates job submissions, writes to Postgres, publishes to SQS
* **worker/** → Polls SQS, claims and processes jobs, updates job state, runs the orphan-job reconciler
* **dashboard/** → React UI for monitoring job status and replaying failures
* **schema.sql** → Shared PostgreSQL schema (single source of truth for job state)

---

## 📡 API Endpoints
### Jobs
* POST `/jobs`
* GET `/jobs`
* GET `/jobs/:id`
* POST `/jobs/:id/replay`

### Monitoring
* GET `/queue-depth`

---

## 📦 Sample Response
GET /jobs/:id
```json
{
  "id": "b3f1c9e2-df44-4a2b-9b7a-1c2d3e4f5a6b",
  "job_type": "image_thumbnail",
  "status": "completed",
  "attempts": 1,
  "payload": { "imageUrl": "https://example.com/photo.jpg" },
  "result": { "thumbnailUrl": "https://example.com/thumb.jpg" },
  "created_at": "2026-09-01T10:22:00Z"
}
```

---

## 🛠 Run Locally
```bash
git clone https://github.com/krishivperiwal/job-queue-service.git
cd job-queue-service
docker compose up            # starts Postgres + Redis
psql postgresql://jobqueue:jobqueue@localhost:5432/jobqueue -f schema.sql

cd api && npm install && npm run dev       # http://localhost:3000
cd worker && npm install && npm run dev
cd dashboard && npm install && npm run dev # http://localhost:5173
```
Create `.env` files in `api/` and `worker/` using the variables below. Requires an AWS SQS queue (URL, region, and credentials via the standard AWS SDK credential chain).

```
DATABASE_URL=postgresql://jobqueue:jobqueue@localhost:5432/jobqueue
AWS_REGION=us-east-1
SQS_QUEUE_URL=<your-sqs-queue-url>
REDIS_URL=redis://localhost:6379
PORT=3000
```

---

## 📸 Preview
### Dashboard
![Dashboard Page](preview/dashboard.png)
### Job Detail
![Job Detail Page](preview/job-detail.png)
### Replay Flow
![Replay Flow](preview/replay.png)

---

## 📌 API Base URL
http://localhost:3000

---

## 👨‍💻 Author
Krishiv
