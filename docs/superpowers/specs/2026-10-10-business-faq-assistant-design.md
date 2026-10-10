# Business FAQ Assistant

Design for App 1. One chat demo answers from a single FAQ file, shows supporting excerpts, and says when the answer is not in that file.

## Decisions

- The last 2–3 messages stay in context. The answer still comes only from the current FAQ. A follow-up works only when its meaning matches a passage in that file.
- Unrelated questions stop on a similarity cutoff and never call Gemini. Questions that pass the cutoff are answered only from the retrieved excerpts. If those excerpts do not support an answer, the app refuses.
- The retrieval code is generic. The demo ships with one sample shop FAQ. A user may replace it by uploading one `.txt` or `.md` file. There is no upload-time model check for "is this an FAQ?"
- The API keeps one in-memory Chroma collection. A valid upload replaces that collection. An API restart loads the sample FAQ again.
- The browser never calls Gemini. Next.js is the UI. FastAPI owns validation, indexing, retrieval, and Gemini.

## Architecture

Two processes.

Next.js renders the chat, the excerpts, the active file name, and the upload control. It sends uploads and questions to FastAPI.

FastAPI owns one in-memory Chroma collection. On startup it chunks the bundled sample FAQ, embeds the chunks with Gemini, and stores those vectors. A valid upload deletes that collection only after a replacement collection is fully written, then swaps the active collection. Chat history lives in the browser. Each question includes at most the previous three messages.

There is no disk database. Restarting the API drops the uploaded file and indexes the sample FAQ again.

## Components

**Chat screen.** Message list, composer, upload control, and the active filename from `GET /status`. It keeps the recent messages and calls only FastAPI.

**File rules.** Accept `.txt` and `.md` only. Decode as UTF-8. Reject empty files, files under 200 characters, and files over 12,000 characters. These checks do not call Gemini. A failed check leaves the current index in place.

**Index.** One active in-memory Chroma collection, built with LlamaIndex. Startup loads `backend/data/sample_faq.md`. A valid upload replaces the whole collection. Chunks use a sentence splitter with chunk size 400 tokens and overlap 40 tokens.

**Answer.** Build the search text from the new question plus the recent messages. Search the active collection and keep the top three chunks. Similarity is cosine similarity from 0 to 1, where 1 is an exact match. If the best score is below 0.45, skip Gemini and refuse. Otherwise send those excerpts and the recent messages to Gemini, with instructions to answer only from the excerpts. The model may still refuse. A supported answer returns the excerpts that were sent to the model. A refusal returns no excerpts.

**Sample FAQ.** A short shop file covering shipping, returns, order tracking, and hours. It includes these facts: returns are accepted within 30 days, standard shipping takes 3 to 5 business days, and hours are Monday to Friday 9:00 to 17:00.

## Data flow

**Startup.** Read the sample FAQ, chunk it, embed it, store it in the active collection, and set the active name to the sample file.

**Upload.** The browser sends the file. Rule failures return 400 and keep the current collection. On success, FastAPI builds a second collection. If embedding fails, it deletes the partial collection, keeps the previous active collection, and returns 503. If embedding succeeds, it drops the old collection, makes the new one active, and returns the new filename. The UI clears the chat, because the old turns belonged to the old file.

**Question.** The browser sends the new message and at most three previous messages.

- Best similarity below 0.45: do not call Gemini. Reply that the answer is not in the current FAQ. Excerpts are empty.
- Best similarity at or above 0.45: call Gemini with the excerpts and the recent messages. A supported answer includes the excerpts used. A refusal has empty excerpts.

**Restart.** Memory is empty. The next startup indexes the sample FAQ.

## API

- `GET /status` returns `{ "filename": string, "source": "sample" | "upload" }`.
- `POST /upload` accepts one multipart field named `file`. Success returns the new status. Rule failures return 400 with a short reason. Embedding or missing-key failures return 503 and leave the previous index active.
- `POST /chat` accepts `{ "message": string, "history": [{ "role": "user" | "assistant", "content": string }] }`. History longer than three messages keeps the latest three. A blank message returns 400 and does not call Gemini. Success returns `{ "answer": string, "refused": boolean, "excerpts": [{ "text": string }] }`.

The refusal sentence is fixed: `I couldn't find that in the current FAQ file.`

Missing `GOOGLE_API_KEY`, or a Gemini failure, returns 503. The app does not invent an answer. Upload validation itself does not need Gemini. Writing vectors does, so a missing key fails upload with 503 before any swap.

## Error handling

| Case | Result | Index |
| --- | --- | --- |
| Wrong extension, empty, under 200 characters, over 12,000 characters, or not UTF-8 | 400 and the reason | Unchanged |
| Blank question | 400 | Unchanged |
| Best similarity below 0.45 | 200, refused, empty excerpts | Unchanged |
| Excerpts retrieved but they do not support an answer | 200, refused, empty excerpts | Unchanged |
| Missing API key or Gemini error | 503 | Unchanged |
| API process restart | Next `/status` shows the sample FAQ | Sample reloaded |

The app does not guess a missing fact, owner, date, or policy.

## Testing

pytest. Gemini chat and Gemini embeddings are mocked. Tests do not call the network.

- Normal: a question about the 30-day return window. The retriever returns a sample excerpt at similarity 0.8. The mocked model answers from that excerpt. The response is not refused and includes the excerpt text.
- Not in the file: an unrelated question. The retriever returns similarity 0.2. Gemini chat is not called. The response is refused, excerpts are empty, and the answer is the fixed refusal sentence.
- Blank message: 400, and Gemini chat is not called.
- Invalid upload: a `.pdf`, an empty file, or a file over 12,000 characters returns 400, and a later status call still reports the previous file.
- Missing API key on chat: 503, and the body does not contain a made-up answer.

## Out of scope

PDF and Word uploads, accounts, saving the index on disk, more than one active file, an LLM check that the upload is an FAQ, phone or messaging integrations, and any write into a live business system.

## Layout

```
business-faq-assistant/
  backend/          FastAPI, LlamaIndex, Chroma, sample FAQ, pytest
  frontend/         Next.js, TypeScript, Tailwind, shadcn/ui
  docs/superpowers/specs/   this design
```

Secrets stay in `backend/.env`, listed by name in `backend/.env.example`. The parent `.github_key` is never copied into this repo.
