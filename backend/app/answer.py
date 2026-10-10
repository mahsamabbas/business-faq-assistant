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
