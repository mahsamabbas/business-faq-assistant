from __future__ import annotations

import threading
import uuid

import chromadb
from llama_index.core.node_parser import SentenceSplitter

from app.config import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    SAMPLE_FAQ_PATH,
    SAMPLE_FILENAME,
    TOP_K,
)
from app.gemini_clients import embed_texts
from app.models import StatusResponse


class IndexBuildError(Exception):
    """Raised when a new FAQ index cannot be built; the previous index stays active."""


class IndexStore:
    def __init__(self) -> None:
        self._client = chromadb.EphemeralClient()
        # Ephemeral clients share one backing store per process, so namespace collection names per instance.
        self._prefix = f"faq_{uuid.uuid4().hex[:8]}"
        self._active_name = f"{self._prefix}_active"
        self._next_name = f"{self._prefix}_next"
        self._collection = None
        self._filename: str | None = None
        self._source: str | None = None
        self._lock = threading.Lock()

    def status(self) -> StatusResponse:
        if self._collection is None or self._filename is None or self._source is None:
            raise IndexBuildError("No FAQ index is loaded.")
        return StatusResponse(filename=self._filename, source=self._source)

    def load_sample(self, api_key: str) -> None:
        text = SAMPLE_FAQ_PATH.read_text(encoding="utf-8")
        self._build_and_swap(SAMPLE_FILENAME, "sample", text, api_key)

    def replace_with_text(self, filename: str, text: str, api_key: str) -> StatusResponse:
        return self._build_and_swap(filename, "upload", text, api_key)

    def retrieve(self, query: str, api_key: str) -> list[tuple[str, float]]:
        collection = self._collection
        if collection is None:
            return []
        query_vec = embed_texts([query], api_key)[0]
        result = collection.query(
            query_embeddings=[query_vec],
            n_results=min(TOP_K, collection.count()) or 1,
        )
        docs = result["documents"][0]
        distances = result["distances"][0]
        # Cosine distance d is in [0, 2]; similarity = 1 - d, clamped to [0, 1].
        return [(doc, max(0.0, min(1.0, 1.0 - dist))) for doc, dist in zip(docs, distances)]

    def _build_and_swap(self, filename: str, source: str, text: str, api_key: str) -> StatusResponse:
        with self._lock:
            self._drop(self._next_name)
            try:
                splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
                chunks = [c for c in splitter.split_text(text) if c.strip()]
                if not chunks:
                    raise ValueError("No text chunks to index.")
                vectors = embed_texts(chunks, api_key)
                if len(vectors) != len(chunks):
                    raise ValueError("Embedding count does not match chunk count.")
                nxt = self._client.create_collection(
                    name=self._next_name, metadata={"hnsw:space": "cosine"}
                )
                nxt.add(
                    ids=[str(i) for i in range(len(chunks))],
                    documents=chunks,
                    embeddings=vectors,
                )
            except Exception as exc:
                self._drop(self._next_name)
                raise IndexBuildError(f"Could not build FAQ index: {exc}") from exc

            # Swap only after the new collection is fully built.
            self._drop(self._active_name)
            nxt.modify(name=self._active_name)
            self._collection = nxt
            self._filename = filename
            self._source = source
            return StatusResponse(filename=filename, source=source)

    def _drop(self, name: str) -> None:
        try:
            self._client.delete_collection(name)
        except Exception:
            pass
