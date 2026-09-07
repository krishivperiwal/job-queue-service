# Job Queue Service

Distributed TypeScript job-processing system for submitting, queueing, retrying, and monitoring asynchronous image-thumbnail jobs.

## Features

- REST API for creating, listing, inspecting, and replaying jobs
- Zod validation before jobs are persisted
- PostgreSQL-backed job lifecycle: `pending -> processing -> completed/failed`
- AWS SQS publishing and long-polling worker consumption
- Atomic job claiming to prevent duplicate SQS deliveries from double-processing a job
- SQS visibility-timeout retries with DLQ-compatible failure limits
- Background reconciler for stale pending jobs orphaned by failed SQS publishes
- Redis-based queue-depth endpoint
- React dashboard with status polling and failed-job replay

## Tech Stack

- **Backend:** Node.js, TypeScript, Express, Zod, `pg`, `ioredis`
- **Queue:** AWS SQS via `@aws-sdk/client-sqs`
- **Frontend:** React, Vite
- **Infrastructure:** PostgreSQL 16, Redis 7, Docker, Docker Compose

## Architecture

- `api/` accepts requests, validates payloads, stores jobs in PostgreSQL, and publishes job IDs to SQS.
- `worker/` claims SQS jobs atomically, simulates processing, records results or failures, and runs the stale-job reconciler.
- `dashboard/` provides a React interface for submitting jobs, viewing status, and replaying failures.

## API

- `POST /jobs` - create an `image_thumbnail` job
- `GET /jobs` - list the 50 newest jobs
- `GET /jobs/:id` - retrieve one job
- `POST /jobs/:id/replay` - replay a failed job
- `GET /queue-depth` - read the Redis queue-depth counter

## Design Notes

- Job submission is decoupled from processing via SQS — the API never blocks on background work
- PostgreSQL owns durable job state; SQS owns delivery and retry semantics
- Long polling reduces empty-receive API calls to SQS
- `ApproximateReceiveCount` distinguishes an in-progress retry from a final failure
- Job claiming is atomic (`UPDATE ... WHERE status IN (...) RETURNING *`), making duplicate SQS delivery a no-op instead of a double-processing bug
- A background reconciler sweeps for jobs stuck in `pending` (DB insert succeeded, SQS publish failed) and republishes them, using `SELECT ... FOR UPDATE SKIP LOCKED` so multiple worker instances never republish the same job twice
- Redis queue-depth counter is kept accurate via atomic `INCR`/`DECR` on every job state transition (submit, complete, fail, replay) — no read-modify-write
- Worker's poll loop wraps message handling in try/catch so a transient AWS/network failure doesn't silently kill the polling process
- Malformed SQS message bodies are caught, logged, and deleted rather than crashing message handling
- Both services validate required environment variables at startup and exit immediately with a clear error if any are missing, instead of failing silently on first use

## Run Locally

Start PostgreSQL and Redis:

```bash
docker compose up
```

Initialize the database:

```bash
psql postgresql://jobqueue:jobqueue@localhost:5432/jobqueue -f schema.sql
```

Create `api/.env` from `api/.env.example` and `worker/.env` from `worker/.env.example`. Configure an AWS SQS queue and credentials through the standard AWS SDK credential chain.

Run each service in a separate terminal:

```bash
cd api && npm install && npm run dev
cd worker && npm install && npm run dev
cd dashboard && npm install && npm run dev
```

The dashboard runs at `http://localhost:5173` and the API runs at `http://localhost:3000`.

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `AWS_REGION` - AWS region for SQS
- `SQS_QUEUE_URL` - SQS queue URL
- `PORT` - API port; defaults to `3000`

## Known Limitations

- Thumbnail generation is currently simulated (no real image downloading, resizing, or storage yet)
- No authentication, authorization, or rate limiting
- No automated tests
- No production observability (metrics, structured logging, alerting)
