from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.answer import (
    BlankMessageError,
    ServiceUnavailableError,
    answer_question,
)
from app.gemini_clients import get_api_key
from app.index_store import IndexBuildError, IndexStore
from app.models import ChatRequest, ChatResponse, StatusResponse
from app.validation import ValidationError, validate_faq_bytes

load_dotenv()

UNAVAILABLE_DETAIL = "Answer service unavailable."


def create_app(store: IndexStore | None = None) -> FastAPI:
    index = store or IndexStore()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        key = get_api_key()
        if key:
            index.load_sample(key)
        app.state.index = index
        yield

    app = FastAPI(title="Business FAQ Assistant", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/status", response_model=StatusResponse)
    def status() -> StatusResponse:
        try:
            return index.status()
        except IndexBuildError as exc:
            raise HTTPException(status_code=503, detail=UNAVAILABLE_DETAIL) from exc

    @app.post("/upload", response_model=StatusResponse)
    async def upload(file: UploadFile = File(...)) -> StatusResponse:
        raw = await file.read()
        try:
            text = validate_faq_bytes(file.filename or "", raw)
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=exc.message) from exc

        key = get_api_key()
        if not key:
            raise HTTPException(status_code=503, detail=UNAVAILABLE_DETAIL)
        try:
            return index.replace_with_text(file.filename or "upload.txt", text, key)
        except IndexBuildError as exc:
            raise HTTPException(status_code=503, detail=UNAVAILABLE_DETAIL) from exc

    @app.post("/chat", response_model=ChatResponse)
    def chat(body: ChatRequest) -> ChatResponse:
        try:
            return answer_question(index, body.message, body.history)
        except BlankMessageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except ServiceUnavailableError as exc:
            raise HTTPException(status_code=503, detail=UNAVAILABLE_DETAIL) from exc

    return app


app = create_app()
