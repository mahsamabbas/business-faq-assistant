from typing import Literal

from pydantic import BaseModel, Field


class StatusResponse(BaseModel):
    filename: str
    source: Literal["sample", "upload"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)


class Excerpt(BaseModel):
    text: str


class ChatResponse(BaseModel):
    answer: str
    refused: bool
    excerpts: list[Excerpt]
