# Business FAQ Assistant

A small retrieval-augmented chat demo: ask questions about one FAQ file at a time, see the supporting excerpts when the model answers from the file, and get a clear refusal when the answer is not in that file. Upload a `.txt` or `.md` FAQ to replace the bundled sample, or use the sample after startup.

## Stack

- **Backend:** Python 3.11+, FastAPI, LlamaIndex, Chroma (in-memory), Google Gemini (embeddings: `gemini-embedding-001`, chat: `gemini-3.6-flash`; override with `GEMINI_EMBED_MODEL` / `GEMINI_CHAT_MODEL`), pytest
- **Frontend:** Next.js, TypeScript, Tailwind CSS
- The browser talks only to FastAPI; it never calls Gemini directly.

## Backend setup

Requires **Python 3.11 or newer** (3.12 is fine). Tests were run with 3.12.

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

## Tests

From the repo root:

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

## Design and plan

- [Design spec](docs/superpowers/specs/2026-10-10-business-faq-assistant-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-10-business-faq-assistant.md)
