# Issue Ledger

A small support-ticket dashboard and REST API built with React, TypeScript, Express, Mongoose and MongoDB. Create tickets, filter the queue, update priorities and track workload through an aggregation report.

This is a personal project. It uses a real MongoDB database; the dashboard does not substitute browser storage or mock responses for persistence.

## Features

- Ticket CRUD with validated Mongoose schemas, timestamps and whitelisted updates.
- Status and priority filters with bounded pagination.
- A MongoDB aggregation pipeline for totals by status and priority.
- Compound indexes supporting the filtered, newest-first queue.
- An access key for writes, with public read endpoints for non-sensitive demo data.
- A responsive dashboard with forms, error states and confirmation before deletion.

## Run locally

Requirements: Node.js 24 or later, npm and Docker with Compose.

```sh
npm ci --registry=https://registry.npmjs.org
cp .env.example .env
docker compose up -d
npm run seed
npm run dev
```

In another terminal:

```sh
npm run dev:web
```

Open [http://localhost:5173](http://localhost:5173). The API runs on port 3001. Enter the development write key from `.env.example` in the dashboard to create, edit or delete tickets. The key stays in the page's memory; it is not stored in the URL or browser storage.

The seed command adds fictional tickets for the dashboard. It is intended for the dedicated development database, never customer data.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database readiness |
| GET | `/api/tickets` | List tickets; filter with `status`, `priority`, `page` and `limit` |
| GET | `/api/tickets/:id` | Read one ticket |
| POST | `/api/tickets` | Create a ticket |
| PATCH | `/api/tickets/:id` | Update allowed ticket fields |
| DELETE | `/api/tickets/:id` | Delete a ticket |
| GET | `/api/reports/summary` | Aggregated totals by status and priority |

Writes require the `X-API-Key` header. Production writes are disabled if `WRITE_API_KEY` is missing; replace the development key before exposing the API.

```sh
curl 'http://localhost:3001/api/tickets?status=open'
curl http://localhost:3001/api/reports/summary
curl -X POST http://localhost:3001/api/tickets \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: dev-only-key' \
  -d '{"title":"Investigate a slow report","priority":"high","tags":["performance"]}'
```

The list response contains `items`, `total`, `page` and `limit`. Single-ticket responses contain `item`. API errors use `{ "error": { "message": "..." } }`.

## Checks

```sh
npm run typecheck
npm run build
TEST_MONGODB_URI=mongodb://127.0.0.1:27107/issue_ledger_test npm test
```

Integration tests connect to a real MongoDB instance and use a guarded test database. They cover persistence, validation, authorization, filters, pagination, report totals and index creation. No timing-based performance improvement is claimed.

## Deployment

The application needs a reachable MongoDB instance and `MONGODB_URI`. Local Docker is suitable for development; a public deployment requires a separate MongoDB service and a private `WRITE_API_KEY`. Credentials belong in environment variables, never in Git or the frontend bundle.

Read endpoints expose the ticket contents. Use fictional data for a public demo. The write key is a simple administrative control, not a multi-user authentication system. This project does not claim production usage or an enterprise deployment.
