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

## Current Scope

The worker currently simulates thumbnail processing with a short delay and stores a placeholder result. Real image downloading, resizing, storage, authentication, automated tests, and production observability are not yet implemented.