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
