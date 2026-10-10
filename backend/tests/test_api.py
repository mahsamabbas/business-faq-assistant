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
