# Frontend — Business FAQ Assistant

Next.js chat UI for the FAQ RAG demo. It only calls the FastAPI backend — never Gemini.

## Requirements

- Node.js 20+ (22 recommended)
- Backend running on `http://localhost:8000` (or the URL you set)

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local
```

`.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Run

```bash
npm run dev
```

Open `http://localhost:3000`. Start the backend first so `/status`, `/chat`, and `/upload` work.

## What the UI does

- Shows the active FAQ filename and source from `GET /status`
- Sends chat with at most the last three prior messages to `POST /chat`
- Shows source excerpts under supported answers
- Uploads a `.txt` or `.md` FAQ via `POST /upload` and clears the chat on success
- Surfaces 400 validation errors and 503 “Answer service unavailable”

## Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm run start    # serve production build
npm run lint     # ESLint
```

## Layout

```
frontend/
  src/app/       Chat page and layout
  src/lib/api.ts Backend client helpers
  .env.example
```

See the root [README](../README.md) for full-stack setup and known limitations.
