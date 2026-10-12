# Business FAQ Assistant

Small retrieval-augmented (RAG) chat demo for one business FAQ file at a time. Ask a question, get an answer grounded in that file (with supporting excerpts), or a clear refusal when the answer is not in the document.

Upload a `.txt` or `.md` FAQ to replace the bundled sample, or keep using the sample after startup. Demo / portfolio use — not a multi-tenant knowledge base.

**Live idea:** chat UI talks only to FastAPI. The API embeds chunks, retrieves nearest excerpts from an in-memory Chroma index, then asks Gemini to answer strictly from those excerpts.

## What’s included

- Chat against a sample FAQ out of the box
- Upload `.txt` / `.md` to replace the active FAQ
- Document preview modal (read the active file without leaving chat)
- Supporting excerpts when the model answers from the file
- Explicit refusal when the question is not covered
- Gemini retries so transient provider failures are less noisy in the UI

## Tech stack

| Layer | Choices |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 (`@tailwindcss/turbopack`), custom CSS |
| Backend | Python 3.11+ (3.12 recommended), FastAPI, Uvicorn |
| Validation | Pydantic v2 |
| RAG orchestration | LlamaIndex (`llama-index-core`) sentence splitting |
| Vector store | Chroma (`chromadb` EphemeralClient — in-memory) |
| Embeddings | Gemini via `llama-index-embeddings-google-genai` / `google-genai` (`gemini-embedding-001`) |
| Chat LLM | Gemini via `llama-index-llms-google-genai` / `google-genai` (default `gemini-3.6-flash`) |
| Uploads | `python-multipart` for FAQ file upload |
| Config | `python-dotenv` + `backend/.env` |
| Delivery | Docker Compose (frontend + backend) |
| Tests | `pytest`, `httpx` (Gemini mocked — no live network in tests) |

### Libraries & smaller pieces

**Backend**

- `fastapi` / `uvicorn[standard]` — status, document, upload, chat routes
- `pydantic` — request/response models (status, chat, excerpts, document)
- `python-multipart` — multipart FAQ upload
- `llama-index-core` — `SentenceSplitter` for chunking (`chunk_size` / `chunk_overlap`)
- `chromadb` — ephemeral collection; swap index on upload
- `llama-index-embeddings-google-genai` + `google-genai` — embed chunks / queries
- `llama-index-llms-google-genai` + `google-genai` — answer only from retrieved excerpts
- `python-dotenv` — API key and optional model overrides
- Refusal string enforced when retrieval/support is insufficient

**Frontend**

- `next` / `react` / `react-dom` — chat UI, upload control, document modal
- `typescript` — typed fetch helpers for FastAPI
- `tailwindcss` — layout and chat styling
- `eslint` / `eslint-config-next` — lint

**API surface (browser → FastAPI only)**

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/status` | Ready flag, active source (`sample` / `upload`), filename |
| `GET` | `/document` | Active FAQ text for the preview modal |
| `POST` | `/upload` | Replace index with a new `.txt` / `.md` file |
| `POST` | `/chat` | Retrieve excerpts + grounded answer (or refusal) |

The browser never calls Gemini directly.

## Run with Docker

Needs Docker Desktop running, plus `backend/.env` with `GOOGLE_API_KEY`.

```bash
# from the repo root
docker compose up --build
```

Then open:

- App: http://localhost:3000
- API: http://localhost:8000

If port 3000 is already used (for example by another app):

```bash
FRONTEND_PORT=3001 docker compose up --build
```

Stop with `Ctrl+C`, or: `docker compose down`.

On macOS, if `docker` is not found after installing Docker Desktop:

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

## Backend setup

Requires **Python 3.11 or newer** (3.12 is fine).

```bash
cd backend
python3.12 -m venv .venv    # or: python3.11 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set GOOGLE_API_KEY (Google AI Studio); model env vars are optional
uvicorn app.main:app --reload --port 8000
```

API base URL: `http://localhost:8000`

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env.local
# Default NEXT_PUBLIC_API_URL=http://localhost:8000 — change if the API runs elsewhere
npm run dev
```

Open `http://localhost:3000` with the backend running.

## Environment

| Variable | Where | Notes |
| --- | --- | --- |
| `GOOGLE_API_KEY` | `backend/.env` | Required for embeddings + chat |
| `GEMINI_EMBED_MODEL` | `backend/.env` | Default `gemini-embedding-001` |
| `GEMINI_CHAT_MODEL` | `backend/.env` | Default `gemini-3.6-flash` |
| `NEXT_PUBLIC_API_URL` | frontend `.env.local` / Compose | Default `http://localhost:8000` |
| `FRONTEND_PORT` | Compose | Host port for the UI (default `3000`) |

## Tests

```bash
cd backend && PYTHONPATH=. pytest -v
```

Gemini chat and embeddings are mocked in tests; no network calls.

## Known limitations

- **In-memory index** — vectors live in process memory; there is no disk database.
- **Restart resets to sample** — restarting the API reloads the bundled sample FAQ; uploaded content is lost.
- **One file at a time** — a valid upload replaces the entire active FAQ index.
- **Text-only uploads** — only `.txt` and `.md`, UTF-8, with size rules enforced by the API.
- **Gemini required for real use** — embeddings at startup/upload and chat answers need a valid `GOOGLE_API_KEY`; without it, status/chat/upload embedding paths return 503.

## Docs

- [Design spec](docs/superpowers/specs/2026-10-10-business-faq-assistant-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-10-business-faq-assistant.md)
