# Backend — Business FAQ Assistant

FastAPI service that owns FAQ validation, in-memory Chroma indexing, retrieval, and Gemini calls. The browser never talks to Gemini.

## Requirements

- Python 3.11+ (3.12 recommended)
- A Google AI Studio key in `GOOGLE_API_KEY`

## Setup

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Set GOOGLE_API_KEY in .env
```

Optional in `.env`:

- `GEMINI_EMBED_MODEL` (default `gemini-embedding-001`)
- `GEMINI_CHAT_MODEL` (default `gemini-3.6-flash`)

## Run

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

API: `http://localhost:8000`

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/status` | Active FAQ filename and source (`sample` \| `upload`) |
| `GET` | `/document` | Active FAQ filename, source, and full text for preview |
| `POST` | `/upload` | Multipart field `file` (`.txt` / `.md`); replaces the index |
| `POST` | `/chat` | JSON `{ "message", "history" }` → answer, refused flag, excerpts |

Upload rules: UTF-8, at least 200 characters, at most 12,000 characters. Chat refuses with a fixed sentence when the answer is not in the FAQ (similarity below 0.45, or the model finds no support).

## Tests

```bash
cd backend
source .venv/bin/activate
PYTHONPATH=. pytest -v
```

Gemini is mocked. Tests do not call the network.

## Layout

```
backend/
  app/           FastAPI app, validation, index, answer, Gemini wrappers
  data/          Bundled sample_faq.md
  tests/         pytest
  .env.example
  requirements.txt
```

See the root [README](../README.md) and [design spec](../docs/superpowers/specs/2026-10-10-business-faq-assistant-design.md) for product behavior and limits.
