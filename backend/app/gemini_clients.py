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
