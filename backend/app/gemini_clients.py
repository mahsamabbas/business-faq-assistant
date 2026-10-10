import logging
import os
import time

from app.config import CHAT_MODEL, EMBED_MODEL, REFUSAL_MESSAGE
from app.models import ChatMessage

logger = logging.getLogger(__name__)


def get_api_key() -> str | None:
    key = os.getenv("GOOGLE_API_KEY", "").strip()
    return key or None


def _embedding_values(result) -> list[float]:
    embeddings = getattr(result, "embeddings", None) or []
    if not embeddings:
        raise RuntimeError("Gemini embedding response had no vectors.")
    values = getattr(embeddings[0], "values", None)
    if not values:
        raise RuntimeError("Gemini embedding vector was empty.")
    return list(values)


def _response_text(response) -> str:
    try:
        text = (response.text or "").strip()
    except Exception as exc:  # noqa: BLE001 — blocked/empty candidates
        logger.warning("Gemini chat returned no readable text: %s", exc)
        return REFUSAL_MESSAGE
    return text or REFUSAL_MESSAGE


def embed_texts(texts: list[str], api_key: str) -> list[list[float]]:
    """Embed texts with Gemini. Called only with a non-empty api_key."""
    from google import genai

    client = genai.Client(api_key=api_key)
    vectors: list[list[float]] = []
    for text in texts:
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                result = client.models.embed_content(model=EMBED_MODEL, contents=text)
                vectors.append(_embedding_values(result))
                last_error = None
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.warning(
                    "Gemini embed attempt %s failed: %s",
                    attempt + 1,
                    exc,
                )
                if attempt == 0:
                    time.sleep(0.6)
        if last_error is not None:
            raise last_error
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
        "Do not invent policies, dates, or fees.\n"
        "The question may be in English, Urdu, or Roman Urdu. "
        "Answer in clear English unless the excerpts require another language.\n\n"
        f"Excerpts:\n{joined}\n\n"
        f"Recent messages:\n{history_lines}\n\n"
        f"Question: {question}\n"
        "Answer:"
    )
    client = genai.Client(api_key=api_key)
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            response = client.models.generate_content(
                model=CHAT_MODEL,
                contents=prompt,
            )
            return _response_text(response)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            logger.warning(
                "Gemini chat attempt %s failed: %s",
                attempt + 1,
                exc,
            )
            if attempt == 0:
                time.sleep(0.6)
    assert last_error is not None
    raise last_error
