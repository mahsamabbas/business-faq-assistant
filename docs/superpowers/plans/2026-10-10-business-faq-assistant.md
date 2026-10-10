# Business FAQ Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small RAG chat demo that answers from one FAQ file, shows supporting excerpts, and refuses when the answer is not in that file.

**Architecture:** Next.js talks only to FastAPI. FastAPI owns one in-memory Chroma collection built with LlamaIndex, Gemini embeddings, and Gemini chat. Upload replaces the whole collection after a successful rebuild. Chat history (last three messages) lives in the browser and is sent with each question.

**Tech Stack:** Python 3.11+, FastAPI, LlamaIndex, Chroma, Gemini (Google AI Studio), pytest, Next.js, TypeScript, Tailwind CSS, shadcn/ui

## Global Constraints

- Refusal sentence (exact): `I couldn't find that in the current FAQ file.`
- Similarity cutoff: best cosine similarity below `0.45` skips Gemini and refuses.
- Retrieve top `3` chunks. Similarity is cosine similarity from `0` to `1`, where `1` is an exact match.
- History: keep at most the latest `3` messages from the client payload.
- Upload rules: `.txt` / `.md` only, UTF-8, reject empty, reject under `200` characters, reject over `12,000` characters. No LLM upload classification.
- Chunking: sentence splitter, chunk size `400` tokens, overlap `40` tokens.
- Env var name: `GOOGLE_API_KEY`. Missing key or Gemini failure → HTTP `503`. Never invent an answer.
- Browser never calls Gemini. Secrets only in `backend/.env`. Parent `.github_key` is never copied into this repo.
- Tests: pytest with Gemini chat and embeddings mocked. No network calls in tests.
- Sample FAQ facts: returns within 30 days; standard shipping 3 to 5 business days; hours Monday to Friday 9:00 to 17:00.

## File map

```
business-faq-assistant/
  backend/
    .env.example
    requirements.txt
    data/sample_faq.md
    app/
      __init__.py
      config.py          # constants + env
      models.py          # Pydantic request/response types
      validation.py      # upload file rules (no Gemini)
      gemini_clients.py  # thin embed + chat wrappers (mockable)
      index_store.py     # in-memory Chroma lifecycle
      answer.py          # retrieve → cutoff → Gemini → response
      main.py            # FastAPI routes + lifespan
    tests/
      conftest.py
      test_validation.py
      test_answer.py
      test_api.py
  frontend/
    (Next.js app: chat UI, upload, status)
  docs/superpowers/specs/2026-10-10-business-faq-assistant-design.md
  docs/superpowers/plans/2026-10-10-business-faq-assistant.md
```

---

### Task 1: Upload validation (pure rules)

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/validation.py`
- Create: `backend/tests/test_validation.py`

**Interfaces:**
- Consumes: none
- Produces: `validate_faq_bytes(filename: str, raw: bytes) -> str` (decoded UTF-8 text). Raises `ValidationError` with `.message: str` on failure. Constants `MIN_CHARS = 200`, `MAX_CHARS = 12000`, `ALLOWED_EXTENSIONS = {".txt", ".md"}`.

- [ ] **Step 1: Create backend package skeleton and requirements**

```text
# backend/requirements.txt
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-multipart>=0.0.9
python-dotenv>=1.0.0
pydantic>=2.0.0
llama-index-core>=0.12.0
llama-index-embeddings-google-genai>=0.1.0
llama-index-llms-google-genai>=0.1.0
llama-index-vector-stores-chroma>=0.4.0
chromadb>=0.5.0
google-genai>=1.0.0
pytest>=8.0.0
httpx>=0.27.0
```

```python
# backend/app/__init__.py
```

```python
# backend/app/config.py
from pathlib import Path

REFUSAL_MESSAGE = "I couldn't find that in the current FAQ file."
SIMILARITY_CUTOFF = 0.45
TOP_K = 3
MAX_HISTORY = 3
MIN_CHARS = 200
MAX_CHARS = 12_000
ALLOWED_EXTENSIONS = {".txt", ".md"}
CHUNK_SIZE = 400
CHUNK_OVERLAP = 40
SAMPLE_FAQ_PATH = Path(__file__).resolve().parent.parent / "data" / "sample_faq.md"
SAMPLE_FILENAME = "sample_faq.md"
```

- [ ] **Step 2: Write the failing validation tests**

```python
# backend/tests/test_validation.py
import pytest

from app.validation import ValidationError, validate_faq_bytes


def test_accepts_utf8_markdown():
    text = "Q: What is your return window?\nA: " + ("Returns accepted within 30 days. " * 10)
    result = validate_faq_bytes("shop.md", text.encode("utf-8"))
    assert "return window" in result.lower()


def test_rejects_pdf_extension():
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.pdf", b"x" * 300)
    assert "extension" in exc.value.message.lower()


def test_rejects_empty_file():
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.txt", b"")
    assert "empty" in exc.value.message.lower()


def test_rejects_too_short():
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.txt", b"short")
    assert "200" in exc.value.message


def test_rejects_too_long():
    payload = ("word " * 3000).encode("utf-8")  # > 12000 chars
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.txt", payload)
    assert "12000" in exc.value.message.replace(",", "")


def test_rejects_invalid_utf8():
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.txt", b"\xff\xfe" + b"a" * 300)
    assert "utf-8" in exc.value.message.lower()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -q pytest && PYTHONPATH=. pytest tests/test_validation.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.validation'` (or similar).

- [ ] **Step 4: Implement validation**

```python
# backend/app/validation.py
from pathlib import PurePosixPath

from app.config import ALLOWED_EXTENSIONS, MAX_CHARS, MIN_CHARS


class ValidationError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def validate_faq_bytes(filename: str, raw: bytes) -> str:
    if not raw:
        raise ValidationError("File is empty.")

    suffix = PurePosixPath(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValidationError("File extension must be .txt or .md.")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValidationError("File must be valid UTF-8 text.") from exc

    length = len(text)
    if length < MIN_CHARS:
        raise ValidationError(f"File must be at least {MIN_CHARS} characters.")
    if length > MAX_CHARS:
        raise ValidationError(f"File must be at most {MAX_CHARS} characters.")

    return text
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && PYTHONPATH=. pytest tests/test_validation.py -v`

Expected: PASS (all 6 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app/__init__.py backend/app/config.py backend/app/validation.py backend/tests/test_validation.py
git commit -m "$(cat <<'EOF'
Add FAQ upload validation rules.

Pure checks reject empty, short, long, non-UTF-8, and wrong extensions before any indexing.
EOF
)"
```

---

### Task 2: Sample FAQ, models, and Gemini client wrappers

**Files:**
- Create: `backend/data/sample_faq.md`
- Create: `backend/app/models.py`
- Create: `backend/app/gemini_clients.py`
- Create: `backend/.env.example`
- Create: `backend/tests/conftest.py`

**Interfaces:**
- Consumes: `app.config` constants
- Produces:
  - Pydantic models: `StatusResponse`, `ChatMessage`, `ChatRequest`, `Excerpt`, `ChatResponse`
  - `get_api_key() -> str | None`
  - `embed_texts(texts: list[str], api_key: str) -> list[list[float]]`
  - `generate_answer(question: str, history: list[ChatMessage], excerpts: list[str], api_key: str) -> str` — returns answer text, or exactly `REFUSAL_MESSAGE` when unsupported

- [ ] **Step 1: Write sample FAQ and models**

```markdown
# backend/data/sample_faq.md
# Acme Shop FAQ

## Returns
You may return unused items within 30 days of delivery for a full refund.
Items must include the original packaging. Sale items are final sale.

## Shipping
Standard shipping takes 3 to 5 business days within the contiguous United States.
Express shipping takes 1 to 2 business days. We do not ship to PO boxes for Express orders.

## Order tracking
After your order ships, you receive a tracking email with a carrier link.
Tracking updates can take up to 24 hours to appear after the shipment label is created.

## Hours
Our support team is available Monday to Friday, 9:00 to 17:00 Eastern Time.
We are closed on weekends and major US holidays.
```

```python
# backend/app/models.py
from typing import Literal

from pydantic import BaseModel, Field


class StatusResponse(BaseModel):
    filename: str
    source: Literal["sample", "upload"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)


class Excerpt(BaseModel):
    text: str


class ChatResponse(BaseModel):
    answer: str
    refused: bool
    excerpts: list[Excerpt]
```

```text
# backend/.env.example
GOOGLE_API_KEY=
```

- [ ] **Step 2: Implement thin Gemini wrappers**

Keep these functions small so tests can monkeypatch them. Use the Google GenAI SDK (or LlamaIndex Gemini wrappers) behind these names — do not call Gemini from routes directly.

```python
# backend/app/gemini_clients.py
import os

from app.config import REFUSAL_MESSAGE
from app.models import ChatMessage


def get_api_key() -> str | None:
    key = os.getenv("GOOGLE_API_KEY", "").strip()
    return key or None


def embed_texts(texts: list[str], api_key: str) -> list[list[float]]:
    """Embed texts with Gemini. Called only with a non-empty api_key."""
    from google import genai

    client = genai.Client(api_key=api_key)
    vectors: list[list[float]] = []
    for text in texts:
        result = client.models.embed_content(model="text-embedding-004", contents=text)
        vectors.append(list(result.embeddings[0].values))
    return vectors


def generate_answer(
    question: str,
    history: list[ChatMessage],
    excerpts: list[str],
    api_key: str,
) -> str:
    """Answer only from excerpts. Return REFUSAL_MESSAGE when unsupported."""
    from google import genai

    joined = "\n\n---\n\n".join(excerpts)
    history_lines = "\n".join(f"{m.role}: {m.content}" for m in history)
    prompt = (
        "You answer business FAQ questions using ONLY the excerpts below.\n"
        "If the excerpts do not contain the answer, reply with exactly this sentence:\n"
        f"{REFUSAL_MESSAGE}\n"
        "Do not invent policies, dates, or fees.\n\n"
        f"Excerpts:\n{joined}\n\n"
        f"Recent messages:\n{history_lines}\n\n"
        f"Question: {question}\n"
        "Answer:"
    )
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(model="gemini-2.0-flash", contents=prompt)
    text = (response.text or "").strip()
    return text or REFUSAL_MESSAGE
```

```python
# backend/tests/conftest.py
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
```

- [ ] **Step 3: Commit**

```bash
git add backend/data/sample_faq.md backend/app/models.py backend/app/gemini_clients.py backend/.env.example backend/tests/conftest.py
git commit -m "$(cat <<'EOF'
Add sample shop FAQ, API models, and Gemini wrappers.

Wrappers stay thin so later chat and upload tests can mock embeddings and answers.
EOF
)"
```

---

### Task 3: In-memory index store

**Files:**
- Create: `backend/app/index_store.py`
- Create: `backend/tests/test_index_store.py`

**Interfaces:**
- Consumes: `embed_texts`, `SAMPLE_FAQ_PATH`, chunk constants
- Produces: class `IndexStore` with:
  - `status() -> StatusResponse`
  - `load_sample(api_key: str) -> None`
  - `replace_with_text(filename: str, text: str, api_key: str) -> StatusResponse` — build new collection first; on embed failure leave previous active and raise `IndexBuildError`
  - `retrieve(query: str, api_key: str) -> list[tuple[str, float]]` — list of `(excerpt_text, similarity)` length ≤ `TOP_K`, similarity in `[0, 1]`

Use LlamaIndex `SentenceSplitter(chunk_size=400, chunk_overlap=40)`, an in-memory Chroma collection (or LlamaIndex `VectorStoreIndex` backed by ephemeral Chroma), and the `embed_texts` wrapper for vectors. Convert distances to cosine similarity in `[0, 1]` consistently (document the conversion in a one-line comment beside the code).

- [ ] **Step 1: Write failing index tests with a fake embedder**

```python
# backend/tests/test_index_store.py
import pytest

from app.index_store import IndexBuildError, IndexStore


class FakeEmbed:
    def __init__(self):
        self.calls = 0

    def __call__(self, texts, api_key):
        self.calls += 1
        if api_key == "fail":
            raise RuntimeError("embed failed")
        # Deterministic unit vectors keyed by first word
        out = []
        for t in texts:
            seed = (sum(ord(c) for c in t[:20]) % 97) + 1
            vec = [float(seed), 1.0, 0.0]
            out.append(vec)
        return out


def test_load_sample_sets_status(monkeypatch):
    fake = FakeEmbed()
    monkeypatch.setattr("app.index_store.embed_texts", fake)
    store = IndexStore()
    store.load_sample("key")
    status = store.status()
    assert status.source == "sample"
    assert status.filename == "sample_faq.md"
    assert fake.calls >= 1


def test_replace_keeps_old_index_on_embed_failure(monkeypatch):
    fake = FakeEmbed()
    monkeypatch.setattr("app.index_store.embed_texts", fake)
    store = IndexStore()
    store.load_sample("key")
    with pytest.raises(IndexBuildError):
        store.replace_with_text("new.md", "Q: Hello?\nA: " + ("world " * 40), "fail")
    assert store.status().filename == "sample_faq.md"


def test_replace_swaps_active_filename(monkeypatch):
    fake = FakeEmbed()
    monkeypatch.setattr("app.index_store.embed_texts", fake)
    store = IndexStore()
    store.load_sample("key")
    status = store.replace_with_text("returns.md", "Q: Returns?\nA: " + ("thirty days " * 40), "key")
    assert status.filename == "returns.md"
    assert status.source == "upload"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && pip install -q -r requirements.txt && PYTHONPATH=. pytest tests/test_index_store.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.index_store'`.

- [ ] **Step 3: Implement `IndexStore`**

Implement `backend/app/index_store.py` so that:

1. `load_sample` reads `SAMPLE_FAQ_PATH`, chunks, embeds via `embed_texts`, stores in an in-memory collection named like `faq_active`.
2. `replace_with_text` builds a temporary collection name (`faq_next`), embeds, and only then deletes/swaps away the old collection. On any exception during build, delete the partial next collection if it exists, raise `IndexBuildError`, and leave the previous active collection untouched.
3. `retrieve` embeds the query with the same `embed_texts`, queries top `TOP_K`, and returns `(text, similarity)` pairs.

Keep LlamaIndex usage inside this file. Do not put FastAPI imports here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && PYTHONPATH=. pytest tests/test_index_store.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/index_store.py backend/tests/test_index_store.py
git commit -m "$(cat <<'EOF'
Add in-memory FAQ index with safe replace.

Upload builds a new collection before swapping so a failed embed leaves the previous FAQ active.
EOF
)"
```

---

### Task 4: Answer service (cutoff + Gemini)

**Files:**
- Create: `backend/app/answer.py`
- Create: `backend/tests/test_answer.py`

**Interfaces:**
- Consumes: `IndexStore.retrieve`, `generate_answer`, `get_api_key`, config constants, models
- Produces: `answer_question(store: IndexStore, message: str, history: list[ChatMessage]) -> ChatResponse` and raises `BlankMessageError` or `ServiceUnavailableError`

Behavior:

1. Strip `message`. If empty → `BlankMessageError`.
2. Keep only the last `MAX_HISTORY` items from `history`.
3. Build search text = recent history contents joined with newlines + the new message.
4. `api_key = get_api_key()`. If missing → `ServiceUnavailableError`.
5. `hits = store.retrieve(search_text, api_key)`.
6. If no hits or `hits[0][1] < SIMILARITY_CUTOFF` → return `ChatResponse(answer=REFUSAL_MESSAGE, refused=True, excerpts=[])` and **do not** call `generate_answer`.
7. Otherwise call `generate_answer(...)`. If the returned text equals `REFUSAL_MESSAGE` (strip/compare), return refused with empty excerpts. Else return `refused=False` and `excerpts=[Excerpt(text=t) for t, _ in hits]` (the excerpts that were sent to the model).
8. If `generate_answer` raises → `ServiceUnavailableError`.

- [ ] **Step 1: Write failing answer tests**

```python
# backend/tests/test_answer.py
import pytest

from app.answer import BlankMessageError, ServiceUnavailableError, answer_question
from app.config import REFUSAL_MESSAGE
from app.models import ChatMessage


class StubStore:
    def __init__(self, hits):
        self.hits = hits
        self.queries = []

    def retrieve(self, query, api_key):
        self.queries.append(query)
        return self.hits


def test_blank_message_raises(monkeypatch):
    monkeypatch.setattr("app.answer.get_api_key", lambda: "k")
    with pytest.raises(BlankMessageError):
        answer_question(StubStore([]), "   ", [])


def test_low_similarity_refuses_without_gemini(monkeypatch):
    called = {"n": 0}

    def boom(*args, **kwargs):
        called["n"] += 1
        raise AssertionError("generate_answer should not run")

    monkeypatch.setattr("app.answer.get_api_key", lambda: "k")
    monkeypatch.setattr("app.answer.generate_answer", boom)
    store = StubStore([("unrelated chunk", 0.2)])
    result = answer_question(store, "What is the capital of Mars?", [])
    assert result.refused is True
    assert result.answer == REFUSAL_MESSAGE
    assert result.excerpts == []
    assert called["n"] == 0


def test_high_similarity_returns_excerpts(monkeypatch):
    excerpt = "You may return unused items within 30 days of delivery."

    def fake_generate(question, history, excerpts, api_key):
        assert excerpt in excerpts[0]
        return "Returns are accepted within 30 days."

    monkeypatch.setattr("app.answer.get_api_key", lambda: "k")
    monkeypatch.setattr("app.answer.generate_answer", fake_generate)
    store = StubStore([(excerpt, 0.8)])
    result = answer_question(store, "What is your return window?", [])
    assert result.refused is False
    assert "30 days" in result.answer
    assert result.excerpts[0].text == excerpt


def test_model_refusal_clears_excerpts(monkeypatch):
    monkeypatch.setattr("app.answer.get_api_key", lambda: "k")
    monkeypatch.setattr(
        "app.answer.generate_answer",
        lambda *a, **k: REFUSAL_MESSAGE,
    )
    store = StubStore([("shipping takes 3 to 5 business days", 0.7)])
    result = answer_question(store, "Do you sell telescopes?", [])
    assert result.refused is True
    assert result.excerpts == []


def test_missing_api_key(monkeypatch):
    monkeypatch.setattr("app.answer.get_api_key", lambda: None)
    with pytest.raises(ServiceUnavailableError):
        answer_question(StubStore([("x", 0.9)]), "returns?", [])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && PYTHONPATH=. pytest tests/test_answer.py -v`

Expected: FAIL with missing `app.answer`.

- [ ] **Step 3: Implement `answer.py`**

```python
# backend/app/answer.py
from app.config import MAX_HISTORY, REFUSAL_MESSAGE, SIMILARITY_CUTOFF
from app.gemini_clients import generate_answer, get_api_key
from app.index_store import IndexStore
from app.models import ChatMessage, ChatResponse, Excerpt


class BlankMessageError(Exception):
    pass


class ServiceUnavailableError(Exception):
    pass


def answer_question(
    store: IndexStore,
    message: str,
    history: list[ChatMessage],
) -> ChatResponse:
    cleaned = message.strip()
    if not cleaned:
        raise BlankMessageError("Message must not be blank.")

    recent = history[-MAX_HISTORY:]
    search_text = "\n".join([m.content for m in recent] + [cleaned])

    api_key = get_api_key()
    if not api_key:
        raise ServiceUnavailableError("Answer service unavailable.")

    hits = store.retrieve(search_text, api_key)
    best = hits[0][1] if hits else 0.0
    if best < SIMILARITY_CUTOFF:
        return ChatResponse(answer=REFUSAL_MESSAGE, refused=True, excerpts=[])

    excerpt_texts = [text for text, _ in hits]
    try:
        answer = generate_answer(cleaned, recent, excerpt_texts, api_key).strip()
    except Exception as exc:  # noqa: BLE001 — surface provider failures as 503
        raise ServiceUnavailableError("Answer service unavailable.") from exc

    if answer == REFUSAL_MESSAGE:
        return ChatResponse(answer=REFUSAL_MESSAGE, refused=True, excerpts=[])

    return ChatResponse(
        answer=answer,
        refused=False,
        excerpts=[Excerpt(text=t) for t in excerpt_texts],
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && PYTHONPATH=. pytest tests/test_answer.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/answer.py backend/tests/test_answer.py
git commit -m "$(cat <<'EOF'
Add FAQ answer path with similarity cutoff.

Low-score questions refuse without calling Gemini; supported answers return the excerpts used.
EOF
)"
```

---

### Task 5: FastAPI routes and API tests

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: `IndexStore`, `validate_faq_bytes`, `answer_question`, models
- Produces: FastAPI app with:
  - `GET /status` → `StatusResponse`
  - `POST /upload` multipart field `file`
  - `POST /chat` JSON `ChatRequest` → `ChatResponse`
  - Lifespan: if `GOOGLE_API_KEY` present, `load_sample`; if missing, still start but chat/upload that need embeddings return 503

- [ ] **Step 1: Write failing API tests**

```python
# backend/tests/test_api.py
from fastapi.testclient import TestClient

from app.config import REFUSAL_MESSAGE
from app.main import create_app


def _client(monkeypatch, hits=None):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    class FakeStore:
        def __init__(self):
            self._filename = "sample_faq.md"
            self._source = "sample"

        def status(self):
            from app.models import StatusResponse

            return StatusResponse(filename=self._filename, source=self._source)

        def load_sample(self, api_key):
            return None

        def replace_with_text(self, filename, text, api_key):
            from app.models import StatusResponse

            self._filename = filename
            self._source = "upload"
            return StatusResponse(filename=filename, source="upload")

        def retrieve(self, query, api_key):
            return hits if hits is not None else [("You may return unused items within 30 days.", 0.8)]

    store = FakeStore()
    app = create_app(store=store)
    monkeypatch.setattr(
        "app.answer.generate_answer",
        lambda question, history, excerpts, api_key: "Returns are accepted within 30 days.",
    )
    return TestClient(app), store


def test_status_sample(monkeypatch):
    client, _ = _client(monkeypatch)
    res = client.get("/status")
    assert res.status_code == 200
    assert res.json()["filename"] == "sample_faq.md"


def test_chat_normal(monkeypatch):
    client, _ = _client(monkeypatch)
    res = client.post("/chat", json={"message": "What is your return window?", "history": []})
    assert res.status_code == 200
    body = res.json()
    assert body["refused"] is False
    assert "30 days" in body["answer"]
    assert body["excerpts"][0]["text"]


def test_chat_not_in_file(monkeypatch):
    client, _ = _client(monkeypatch, hits=[("noise", 0.2)])
    called = {"n": 0}

    def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("should not call gemini")

    monkeypatch.setattr("app.answer.generate_answer", boom)
    res = client.post("/chat", json={"message": "Who won the 2014 World Cup?", "history": []})
    assert res.status_code == 200
    body = res.json()
    assert body["refused"] is True
    assert body["answer"] == REFUSAL_MESSAGE
    assert body["excerpts"] == []
    assert called["n"] == 0


def test_chat_blank(monkeypatch):
    client, _ = _client(monkeypatch)
    res = client.post("/chat", json={"message": "  ", "history": []})
    assert res.status_code == 400


def test_upload_rejects_pdf_keeps_status(monkeypatch):
    client, store = _client(monkeypatch)
    res = client.post(
        "/upload",
        files={"file": ("policy.pdf", b"x" * 500, "application/pdf")},
    )
    assert res.status_code == 400
    assert client.get("/status").json()["filename"] == "sample_faq.md"


def test_chat_missing_key(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    from app.main import create_app

    class FakeStore:
        def status(self):
            from app.models import StatusResponse

            return StatusResponse(filename="sample_faq.md", source="sample")

        def load_sample(self, api_key):
            return None

        def retrieve(self, query, api_key):
            return [("x", 0.9)]

    app = create_app(store=FakeStore())
    client = TestClient(app)
    res = client.post("/chat", json={"message": "returns?", "history": []})
    assert res.status_code == 503
    assert "30 days" not in res.text.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && PYTHONPATH=. pytest tests/test_api.py -v`

Expected: FAIL with missing `create_app`.

- [ ] **Step 3: Implement `main.py`**

```python
# backend/app/main.py
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.answer import (
    BlankMessageError,
    ServiceUnavailableError,
    answer_question,
)
from app.gemini_clients import get_api_key
from app.index_store import IndexBuildError, IndexStore
from app.models import ChatRequest, ChatResponse, StatusResponse
from app.validation import ValidationError, validate_faq_bytes

load_dotenv()


def create_app(store: IndexStore | None = None) -> FastAPI:
    index = store or IndexStore()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        key = get_api_key()
        if key:
            index.load_sample(key)
        app.state.index = index
        yield

    app = FastAPI(title="Business FAQ Assistant", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/status", response_model=StatusResponse)
    def status() -> StatusResponse:
        return index.status()

    @app.post("/upload", response_model=StatusResponse)
    async def upload(file: UploadFile = File(...)) -> StatusResponse:
        raw = await file.read()
        try:
            text = validate_faq_bytes(file.filename or "", raw)
        except ValidationError as exc:
            return JSONResponse(status_code=400, content={"detail": exc.message})  # type: ignore[return-value]

        key = get_api_key()
        if not key:
            return JSONResponse(status_code=503, content={"detail": "Answer service unavailable."})  # type: ignore[return-value]
        try:
            return index.replace_with_text(file.filename or "upload.txt", text, key)
        except IndexBuildError:
            return JSONResponse(status_code=503, content={"detail": "Answer service unavailable."})  # type: ignore[return-value]

    @app.post("/chat", response_model=ChatResponse)
    def chat(body: ChatRequest) -> ChatResponse:
        try:
            return answer_question(index, body.message, body.history)
        except BlankMessageError as exc:
            return JSONResponse(status_code=400, content={"detail": str(exc)})  # type: ignore[return-value]
        except ServiceUnavailableError:
            return JSONResponse(status_code=503, content={"detail": "Answer service unavailable."})  # type: ignore[return-value]

    return app


app = create_app()
```

Note: If FastAPI typing complains about returning `JSONResponse` from a `response_model` route, switch those handlers to raise `HTTPException(status_code=..., detail=...)` instead — behavior must stay the same.

- [ ] **Step 4: Run the full backend suite**

Run: `cd backend && source .venv/bin/activate && PYTHONPATH=. pytest -v`

Expected: PASS for validation, index, answer, and API tests (all cases from the design Testing section covered).

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_api.py
git commit -m "$(cat <<'EOF'
Wire FastAPI status, upload, and chat routes.

API tests cover the normal answer, out-of-file refusal, blank message, bad upload, and missing key.
EOF
)"
```

---

### Task 6: Next.js chat UI

**Files:**
- Create: `frontend/` Next.js app (TypeScript, Tailwind, shadcn/ui)
- Create: `frontend/.env.example` with `NEXT_PUBLIC_API_URL=http://localhost:8000`
- Create: chat page components under `frontend/app/` (or `src/app/`)

**Interfaces:**
- Consumes: `GET /status`, `POST /upload`, `POST /chat`
- Produces: browser UI that never calls Gemini

UI requirements (keep simple, one screen):

1. On load, call `/status` and show active filename + source.
2. Chat list: user and assistant bubbles. Assistant messages show excerpts under the answer when `excerpts.length > 0`.
3. Composer sends `{ message, history }` where `history` is the last 3 prior messages (`role` + `content` only).
4. Upload control: choose `.txt`/`.md`, `POST /upload` as multipart `file`. On success, clear chat messages and refresh status. On 400/503, show the API `detail` and keep chat/index state as returned by the server.
5. Blank local submit disabled or blocked before request.
6. Show a clear error banner for 503 ("Answer service unavailable").

- [ ] **Step 1: Scaffold Next.js app**

Run from repo root:

```bash
cd frontend
# If frontend only has .gitkeep, remove it first, then:
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack=false
```

Then add shadcn/ui defaults needed for button, input, textarea (or plain Tailwind if shadcn init is slow — prefer shadcn per stack). Set `NEXT_PUBLIC_API_URL` in `.env.local` and `.env.example`.

- [ ] **Step 2: Implement API helper**

```typescript
// frontend/src/lib/api.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Status = { filename: string; source: "sample" | "upload" };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatResult = {
  answer: string;
  refused: boolean;
  excerpts: { text: string }[];
};

export async function fetchStatus(): Promise<Status> {
  const res = await fetch(`${API_URL}/status`);
  if (!res.ok) throw new Error("Failed to load status");
  return res.json();
}

export async function uploadFaq(file: File): Promise<Status> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_URL}/upload`, { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? "Upload failed");
  return data;
}

export async function sendChat(
  message: string,
  history: ChatMessage[],
): Promise<ChatResult> {
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? "Chat failed");
  return data;
}
```

- [ ] **Step 3: Implement the chat page**

Single page (`frontend/src/app/page.tsx`) with:

- header showing `Active FAQ: {filename}`
- scrollable messages
- excerpt block styled as muted secondary text under assistant replies
- file input + upload button
- text input + send button
- error string state

Keep styling readable with Tailwind; no dashboard clutter. Brand/title: **Business FAQ Assistant**.

- [ ] **Step 4: Manual smoke check**

Terminal 1:

```bash
cd backend && source .venv/bin/activate && export GOOGLE_API_KEY=... && uvicorn app.main:app --reload --port 8000
```

Terminal 2:

```bash
cd frontend && npm run dev
```

Verify in browser:

1. Status shows `sample_faq.md`
2. Ask return window → answer mentions 30 days + excerpt visible
3. Ask unrelated question → fixed refusal, no excerpts
4. Upload invalid `.pdf` → error, status unchanged
5. Upload a valid short FAQ `.md` → status filename updates, chat clears

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "$(cat <<'EOF'
Add Next.js chat UI for FAQ RAG.

The browser only talks to FastAPI for status, upload, and chat.
EOF
)"
```

---

### Task 7: README and run docs

**Files:**
- Modify: `README.md`
- Ensure: `backend/.env.example`, `frontend/.env.example`

- [ ] **Step 1: Rewrite root README**

Include:

1. What the demo does (one paragraph)
2. Stack list
3. Backend setup: venv, `pip install -r requirements.txt`, copy `.env.example` → `.env`, set `GOOGLE_API_KEY`, `uvicorn app.main:app --reload --port 8000`
4. Frontend setup: `npm install`, copy `.env.example` → `.env.local`, `npm run dev`
5. How to run tests: `cd backend && PYTHONPATH=. pytest -v`
6. Known limitations: in-memory index, restart resets to sample, one file at a time, text-only uploads, Gemini required for embeddings/chat
7. Link to design spec and this plan

- [ ] **Step 2: Commit**

```bash
git add README.md frontend/.env.example backend/.env.example
git commit -m "$(cat <<'EOF'
Document local setup, tests, and demo limits.

Readers can run backend and frontend without digging through the design notes.
EOF
)"
```

---

## Self-review checklist (plan author)

1. **Spec coverage**
   - History 2–3 messages → Task 4 (`MAX_HISTORY`) + Task 6 (client sends last 3)
   - Cutoff 0.45 + no Gemini on miss → Task 4 / API tests
   - Model refusal clears excerpts → Task 4 test
   - Upload rules + index unchanged on 400 → Tasks 1 and 5
   - Safe replace on embed failure → Task 3
   - Sample FAQ facts → Task 2 file content
   - Endpoints/shapes → Task 5
   - pytest cases from design Testing section → Tasks 1, 4, 5
   - Next.js UI, no browser Gemini → Task 6
   - README / `.env.example` → Task 7

2. **Placeholders:** none intentionally left; package pin floors are minimums and may need a one-line adjust if PyPI names differ slightly for LlamaIndex Gemini extras — keep the public function names in `gemini_clients.py` stable even if the import path inside changes.

3. **Type consistency:** `StatusResponse`, `ChatRequest`, `ChatResponse`, `Excerpt`, `IndexStore.retrieve -> list[tuple[str, float]]`, `answer_question -> ChatResponse`, refusal string exact match across config/tests/UI expectations.
