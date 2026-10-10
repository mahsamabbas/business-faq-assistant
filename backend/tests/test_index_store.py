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


def test_retrieve_returns_bounded_similarity(monkeypatch):
    fake = FakeEmbed()
    monkeypatch.setattr("app.index_store.embed_texts", fake)
    store = IndexStore()
    store.load_sample("key")
    results = store.retrieve("What is the return policy?", "key")
    assert 1 <= len(results) <= 3
    for text, sim in results:
        assert isinstance(text, str) and text
        assert 0.0 <= sim <= 1.0


def test_retrieve_without_index_returns_empty(monkeypatch):
    monkeypatch.setattr("app.index_store.embed_texts", FakeEmbed())
    assert IndexStore().retrieve("anything", "key") == []
