# Business FAQ Assistant

A small RAG demo. The chat answers from one FAQ file, shows the supporting excerpt, and says when the answer is not in the file.

The design is in [docs/superpowers/specs/2026-10-10-business-faq-assistant-design.md](docs/superpowers/specs/2026-10-10-business-faq-assistant-design.md).

`backend/` is FastAPI. `frontend/` is Next.js. The browser does not call Gemini.
