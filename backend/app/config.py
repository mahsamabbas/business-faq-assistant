import os
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
EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "gemini-embedding-001")
CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL", "gemini-3.6-flash")
