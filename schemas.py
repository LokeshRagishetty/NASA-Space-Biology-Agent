import re
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


def validate_bcrypt_password_size(value: str) -> str:
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password must be 72 bytes or fewer for bcrypt.")
    return value


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=8, max_length=72)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        username = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", username):
            raise ValueError("Username may contain letters, numbers, dots, underscores, and hyphens only.")
        return username

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ValueError("Enter a valid email address.")
        return email

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_bcrypt_password_size(value)


class UserLogin(BaseModel):
    # The same field accepts either a username or an email address.
    username: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=72)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_bcrypt_password_size(value)


class UserProfile(BaseModel):
    id: int
    username: str
    email: str
    google_id: Optional[str] = None
    avatar_url: Optional[str] = None
    auth_provider: str = "password"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserProfile


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(..., min_length=20)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    answer: str


class ChatHistoryResponse(BaseModel):
    id: int
    question: str
    answer: str
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str


class ConversationCreate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=140)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        title = re.sub(r"\s+", " ", value).strip()
        return title or None


class ConversationUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=140)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        title = re.sub(r"\s+", " ", value).strip()
        if not title:
            raise ValueError("Conversation title cannot be empty.")
        return title


class ConversationMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def clean_content(cls, value: str) -> str:
        content = value.strip()
        if not content:
            raise ValueError("Message cannot be empty.")
        return content


class ConversationMessageResponse(BaseModel):
    id: int
    conversation_id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ConversationResponse(BaseModel):
    id: int
    user_id: int
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ConversationMessageResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ConversationSendResponse(BaseModel):
    conversation: ConversationResponse
    user_message: ConversationMessageResponse
    assistant_message: ConversationMessageResponse


KnowledgeProcessingStatus = Literal["pending", "processing", "completed", "failed"]


class KnowledgeDocumentResponse(BaseModel):
    id: int
    user_id: int
    original_filename: str
    content_type: str
    file_extension: str
    file_size: int
    uploaded_at: datetime
    processing_status: KnowledgeProcessingStatus = "pending"
    processed_at: Optional[datetime] = None
    extraction_error: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class KnowledgeDocumentTextResponse(BaseModel):
    id: int
    filename: str
    type: str
    status: KnowledgeProcessingStatus
    text: str = ""
    processed_at: Optional[datetime] = None
    extraction_error: Optional[str] = None


class DocumentChunkResponse(BaseModel):
    id: int
    document_id: int
    chunk_index: int
    content: str
    char_count: int
    token_estimate: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentChunksResponse(BaseModel):
    document_id: int
    chunk_count: int
    chunks: list[DocumentChunkResponse] = Field(default_factory=list)


class DocumentChunkStatsResponse(BaseModel):
    document_id: int
    page_count: int = 0
    extracted_characters: int = 0
    chunk_count: int
    total_characters: int
    chunked_characters: int = 0
    average_chunk_size: int
    estimated_tokens: int


class DocumentEmbeddingStatsResponse(BaseModel):
    document_id: int
    embedding_model: str
    chunk_count: int
    embedding_count: int
    embedding_dimension: int


class VectorStoreStatsResponse(BaseModel):
    collection_name: str
    total_vectors: int
    total_documents: int


class DocumentVectorStatsResponse(BaseModel):
    document_id: int
    chunk_count: int
    embedding_count: int
    stored_vectors: int


class VectorStoreHealthResponse(BaseModel):
    status: str
    collection: str
    detail: Optional[str] = None


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    top_k: Optional[int] = Field(default=None, ge=1, le=20)

    @field_validator("query")
    @classmethod
    def clean_query(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Search query cannot be empty or whitespace only.")
        return cleaned


class SearchResultItem(BaseModel):
    document_id: int
    chunk_id: int
    filename: str
    chunk_text: str
    similarity_score: float = Field(..., ge=0.0, le=1.0)
    chunk_index: int

    model_config = ConfigDict(from_attributes=True)


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultItem] = Field(default_factory=list)
    total_results: int
    search_time_ms: float
    highest_similarity_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class SearchStatisticsResponse(BaseModel):
    documents_count: int
    chunks_count: int
    embeddings_count: int
    searchable: bool


class RagQueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    top_k: Optional[int] = Field(default=None, ge=1, le=20)
    model: Optional[str] = Field(default=None, min_length=1, max_length=120)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=8192)

    @field_validator("query")
    @classmethod
    def clean_query(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("RAG query cannot be empty or whitespace only.")
        return cleaned


class RagCitation(BaseModel):
    document_id: int
    filename: str
    chunk_index: int
    chunk_id: int


class RagQueryResponse(BaseModel):
    answer: str
    retrieved_chunks: int
    context_length: int
    response_time_ms: float
    citations: list[RagCitation] = Field(default_factory=list)
    semantic_matches: int = 0
    keyword_matches: int = 0
    merged_results: int = 0
    final_context_count: int = 0
