# main.py
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Optional

import markdown
import requests
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_groq import ChatGroq
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    authenticate_user,
    create_access_token,
    get_current_user,
    get_password_hash,
    verify_firebase_id_token,
)
from database import Base, SessionLocal, engine, get_db
from models import ChatHistory, Conversation, KnowledgeDocument, Message, User, utc_now
from schemas import (
    ChatHistoryResponse,
    ChatRequest,
    ChatResponse,
    ConversationCreate,
    ConversationMessageCreate,
    ConversationResponse,
    ConversationSendResponse,
    ConversationUpdate,
    DocumentChunksResponse,
    DocumentChunkStatsResponse,
    GoogleLoginRequest,
    KnowledgeDocumentResponse,
    KnowledgeDocumentTextResponse,
    MessageResponse,
    TokenResponse,
    UserCreate,
    UserLogin,
    UserProfile,
)
from services.chunking_service import get_document_chunk_statistics, list_document_chunks
from services.document_processor import (
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_PROCESSING,
    process_document,
    reset_document_processing_state,
)

load_dotenv()

# Validate keys at startup so deployment issues fail loudly.
assert os.getenv("GROQ_API_KEY"), "Missing GROQ_API_KEY in .env"
assert os.getenv("NASA_ADS_TOKEN"), "Missing NASA_ADS_TOKEN in .env"

UPLOAD_ROOT = Path(os.getenv("KNOWLEDGE_UPLOAD_DIR", "uploads/knowledge_library")).resolve()
MAX_UPLOAD_BYTES = int(os.getenv("KNOWLEDGE_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
ALLOWED_UPLOADS = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def ensure_user_auth_columns() -> None:
    """Lightweight SQLite-friendly migration for OAuth profile fields."""
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("users")}
    statements = []

    if "google_id" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN google_id VARCHAR(255)")
    if "avatar_url" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(1024)")
    if "auth_provider" not in columns:
        statements.append(
            "ALTER TABLE users ADD COLUMN auth_provider VARCHAR(30) NOT NULL DEFAULT 'password'"
        )

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        connection.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_id ON users (google_id)")
        )


def ensure_knowledge_document_processing_columns() -> None:
    """Lightweight migration for document extraction metadata."""
    inspector = inspect(engine)
    if "knowledge_documents" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("knowledge_documents")}
    dialect = engine.dialect.name
    datetime_type = "TIMESTAMP WITH TIME ZONE" if dialect == "postgresql" else "DATETIME"
    statements = []

    if "extracted_text" not in columns:
        statements.append("ALTER TABLE knowledge_documents ADD COLUMN extracted_text TEXT")
    if "processing_status" not in columns:
        statements.append(
            "ALTER TABLE knowledge_documents ADD COLUMN processing_status VARCHAR(20) NOT NULL DEFAULT 'pending'"
        )
    if "processed_at" not in columns:
        statements.append(f"ALTER TABLE knowledge_documents ADD COLUMN processed_at {datetime_type}")
    if "extraction_error" not in columns:
        statements.append("ALTER TABLE knowledge_documents ADD COLUMN extraction_error TEXT")

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        connection.execute(
            text(
                """
                UPDATE knowledge_documents
                SET processing_status = 'pending'
                WHERE processing_status IS NULL OR processing_status = ''
                """
            )
        )


def ensure_document_chunk_table() -> None:
    """Create the chunk table for existing SQLite/simple deployments."""
    from models import DocumentChunk

    DocumentChunk.__table__.create(bind=engine, checkfirst=True)


def generate_conversation_title(prompt: str) -> str:
    """Create a short, readable title from the first user prompt."""
    cleaned = re.sub(r"<[^>]+>", " ", prompt or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return "New chat"

    words = cleaned.split()
    title = " ".join(words[:8])
    if len(words) > 8 or len(title) > 64:
        title = title[:64].rstrip(" ,.;:-") + "..."
    return title[:140]


def ensure_upload_root() -> None:
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def clean_upload_filename(filename: str) -> str:
    name = Path(filename or "document").name
    cleaned = re.sub(r"[^A-Za-z0-9_. -]+", "_", name).strip(" .")
    return cleaned or "document"


def validate_upload_file(upload: UploadFile) -> tuple[str, str]:
    original_name = clean_upload_filename(upload.filename or "")
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_UPLOADS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF, PNG, JPG, and JPEG files are supported.",
        )

    expected_content_type = ALLOWED_UPLOADS[extension]
    if upload.content_type and upload.content_type not in {expected_content_type, "application/octet-stream"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file type does not match the selected file extension.",
        )

    return original_name, extension


def migrate_legacy_chat_history() -> None:
    """Convert old one-row chats into conversation/message pairs once."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if not {"chat_history", "conversations", "messages"}.issubset(tables):
        return

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS chat_history_migrations (
                    chat_history_id INTEGER PRIMARY KEY,
                    conversation_id INTEGER NOT NULL
                )
                """
            )
        )

    db = SessionLocal()
    try:
        migrated_ids = {
            row[0]
            for row in db.execute(text("SELECT chat_history_id FROM chat_history_migrations")).all()
        }
        legacy_chats = db.query(ChatHistory).order_by(ChatHistory.timestamp.asc()).all()

        for chat in legacy_chats:
            if chat.id in migrated_ids:
                continue

            conversation = Conversation(
                user_id=chat.user_id,
                title=generate_conversation_title(chat.question),
                created_at=chat.timestamp,
                updated_at=chat.timestamp,
            )
            db.add(conversation)
            db.flush()
            db.add_all(
                [
                    Message(
                        conversation_id=conversation.id,
                        role="user",
                        content=chat.question,
                        created_at=chat.timestamp,
                    ),
                    Message(
                        conversation_id=conversation.id,
                        role="assistant",
                        content=chat.answer,
                        created_at=chat.timestamp,
                    ),
                ]
            )
            db.execute(
                text(
                    """
                    INSERT OR IGNORE INTO chat_history_migrations
                    (chat_history_id, conversation_id)
                    VALUES (:chat_history_id, :conversation_id)
                    """
                ),
                {"chat_history_id": chat.id, "conversation_id": conversation.id},
            )

        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # For SQLite/simple deployments. Use Alembic migrations before a large production launch.
    ensure_upload_root()
    Base.metadata.create_all(bind=engine)
    ensure_user_auth_columns()
    ensure_knowledge_document_processing_columns()
    ensure_document_chunk_table()
    migrate_legacy_chat_history()
    yield


app = FastAPI(
    title="NASA Space Biology Knowledge Engine",
    description=(
        "A multi-user AI platform for NASA Space Apps Challenge, powered by Groq, "
        "NASA ADS, DuckDuckGo search, LangChain, JWT auth, and SQLite."
    ),
    version="2.0",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory="static"), name="static")

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# In-memory LangChain session store. The session id now includes user id to avoid cross-user memory.
store: dict[str, ChatMessageHistory] = {}


def get_session_history(session_id: str) -> BaseChatMessageHistory:
    if session_id not in store:
        store[session_id] = ChatMessageHistory()
    return store[session_id]


def build_token_response(user: User) -> TokenResponse:
    expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "user_id": user.id},
        expires_delta=expires_delta,
    )
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserProfile.model_validate(user),
    )


def authenticate_and_build_token(db: Session, username: str, password: str) -> TokenResponse:
    user = authenticate_user(db, username, password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username/email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return build_token_response(user)


def normalize_google_username(name: Optional[str], email: str) -> str:
    raw_username = (name or email.split("@")[0]).strip().lower()
    username = re.sub(r"[^a-z0-9_.-]+", ".", raw_username).strip("._-")
    if len(username) < 3:
        username = f"user.{username or 'google'}"
    return username[:50]


def get_unique_username(db: Session, base_username: str) -> str:
    candidate = base_username
    counter = 1

    while db.query(User).filter(User.username == candidate).first():
        suffix = f"-{counter}"
        candidate = f"{base_username[: 50 - len(suffix)]}{suffix}"
        counter += 1

    return candidate


def apply_google_profile(
    user: User,
    firebase_uid: str,
    name: Optional[str],
    picture: Optional[str],
) -> None:
    user.google_id = firebase_uid
    user.avatar_url = picture or user.avatar_url

    if user.auth_provider == "password":
        user.auth_provider = "password_google"
    elif not user.auth_provider:
        user.auth_provider = "google"


def get_or_create_google_user(db: Session, claims: dict) -> User:
    firebase_uid = claims.get("uid") or claims.get("user_id") or claims.get("sub")
    email = (claims.get("email") or "").strip().lower()
    name = claims.get("name")
    picture = claims.get("picture")
    email_verified = claims.get("email_verified")

    if not firebase_uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Firebase token is missing uid.")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google account has no email address.")
    if email_verified is False:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is not verified.")

    user = db.query(User).filter(User.google_id == firebase_uid).first()
    email_user = db.query(User).filter(User.email == email).first()

    if user and email_user and user.id != email_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Google account is already linked to another email.",
        )

    if user:
        if user.email != email:
            user.email = email
        apply_google_profile(user, firebase_uid, name, picture)
        db.commit()
        db.refresh(user)
        return user

    if email_user:
        apply_google_profile(email_user, firebase_uid, name, picture)
        db.commit()
        db.refresh(email_user)
        return email_user

    user = User(
        username=get_unique_username(db, normalize_google_username(name, email)),
        email=email,
        hashed_password=get_password_hash(secrets.token_urlsafe(48)),
        google_id=firebase_uid,
        avatar_url=picture,
        auth_provider="google",
    )

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/signup", response_model=UserProfile, status_code=status.HTTP_201_CREATED, tags=["auth"])
def signup(user_in: UserCreate, db: Session = Depends(get_db)):
    existing_user = (
        db.query(User)
        .filter((User.username == user_in.username) | (User.email == user_in.email))
        .first()
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that username or email already exists.",
        )

    user = User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
    )

    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that username or email already exists.",
        ) from exc

    return user


@app.post("/login", response_model=TokenResponse, tags=["auth"])
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    return authenticate_and_build_token(db, credentials.username, credentials.password)


@app.post("/token", response_model=TokenResponse, tags=["auth"])
def login_with_oauth2_form(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    return authenticate_and_build_token(db, form_data.username, form_data.password)


@app.post("/google-login", response_model=TokenResponse, tags=["auth"])
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    claims = verify_firebase_id_token(payload.id_token)

    try:
        user = get_or_create_google_user(db, claims)
        return build_token_response(user)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not link Google account because another account already uses those details.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while signing in with Google.",
        ) from exc


@app.post("/logout", response_model=MessageResponse, tags=["auth"])
def logout(current_user: User = Depends(get_current_user)):
    # JWTs are stateless. A production revocation list can be added if hard logout is required.
    return {"message": f"Logged out {current_user.username}. Remove the token on the client."}


@app.get("/me", response_model=UserProfile, tags=["auth"])
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user


# NASA-aware web search
def nasa_search(query: str) -> str:
    nasa_query = f"{query} site:nasa.gov OR site:data.nasa.gov OR site:adsabs.harvard.edu"
    wrapper = DuckDuckGoSearchAPIWrapper(region="wt-wt", max_results=2)
    results = wrapper.results(nasa_query, 2)
    if results:
        return "\n".join([f"**{r['title']}**\n🔗 {r['link']}" for r in results])
    return "No NASA sources found."


# NASA ADS paper search
def nasa_ads_search(query: str) -> str:
    url = "https://api.adsabs.harvard.edu/v1/search/query"
    headers = {"Authorization": f"Bearer {os.getenv('NASA_ADS_TOKEN')}"}
    params = {
        "q": f"abstract:({query}) AND (database:astronomy OR database:physics)",
        "fl": "title,bibcode",
        "rows": 2,
    }
    try:
        res = requests.get(url, headers=headers, params=params, timeout=10)
        if res.status_code == 200:
            docs = res.json().get("response", {}).get("docs", [])
            if docs:
                return "\n\n".join(
                    [
                        f"📄 **{d['title'][0]}**\n🔗 https://ui.adsabs.harvard.edu/abs/{d['bibcode']}"
                        for d in docs
                    ]
                )
        return "No relevant NASA papers found."
    except Exception as e:
        return f"NASA ADS search failed: {str(e)}"


# Safe math evaluator
def safe_math(expr: str) -> str:
    cleaned = re.sub(r"[^\d+\-*/().\s]", "", expr)
    if re.match(r"^[\d+\-*/().\s]+$", cleaned):
        try:
            result = eval(cleaned, {"__builtins__": {}}, {})
            return str(result)
        except Exception:
            return "Invalid math expression"
    return "Only basic math allowed: +, -, *, /, (), numbers"


# Format raw LLM output into structured, readable response
def format_nasa_response(raw: str) -> str:
    """Converts raw LLM output into structured HTML for the UI."""
    raw = raw.strip()
    if not raw:
        return "<p>No answer generated.</p>"

    # Ensure proper paragraph breaks.
    formatted = re.sub(r"(\. )", r".\n\n", raw)

    # Handle numbered lists.
    formatted = re.sub(r"^(\d+)\.", r"### \1.", formatted, flags=re.MULTILINE)

    # Wrap in professional framing if not already present.
    if not formatted.startswith("> **"):
        formatted = "> **Based on NASA's open data and research, here is a structured overview:**\n\n" + formatted

    if not formatted.endswith("lunar sustainability."):
        formatted += (
            "\n\n> 🌕 *This insight is synthesized from NASA missions, peer-reviewed research, "
            "and open data portals to support space biology innovation.*"
        )

    html = markdown.markdown(formatted, extensions=["nl2br"])
    html = html.replace(
        "<blockquote>",
        '<blockquote style="border-left: 4px solid #0b5394; padding-left: 16px; margin: 16px 0;">',
    )

    return html


# Build the NASA-specialized agent
def get_agent():
    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        temperature=0.1,
        api_key=os.getenv("GROQ_API_KEY"),
    )

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                """You are the NASA Space Biology Knowledge Assistant.
Your role is to provide accurate, well-structured, and source-backed answers about space biology, lunar missions, and NASA research.

Guidelines:
- Always prioritize information from nasa.gov, data.nasa.gov, or adsabs.harvard.edu
- Structure answers with clear headings, bullet points, and paragraphs
- Cite specific missions (e.g., Artemis II, ISS) or experiments when possible
- If asked for calculations (e.g., radiation dose, growth rates), compute them precisely
- Never hallucinate. If unsure, say "NASA has not published data on this yet."
- Format output in clean markdown with bold headings and source links""",
            ),
            ("placeholder", "{chat_history}"),
            ("human", "{input}"),
        ]
    )

    chain = prompt | llm | StrOutputParser()
    return RunnableWithMessageHistory(
        chain,
        get_session_history,
        input_messages_key="input",
        history_messages_key="chat_history",
    )


agent = get_agent()


def generate_ai_answer(question: str, session_id: str) -> str:
    # 1. Handle math.
    if re.search(r"\d+[\+\-\*\/]\d+", question):
        result = safe_math(question)
        return f"🧮 **Calculation Result**\n\nThe result of `{question}` is **{result}**."

    # 2. Detect NASA/space topics.
    nasa_keywords = [
        "nasa",
        "space",
        "moon",
        "mars",
        "artemis",
        "iss",
        "astronaut",
        "biology",
        "radiation",
        "microgravity",
        "lunar",
        "orbit",
        "cosmic",
        "spacecraft",
        "orion",
        "sls",
        "rocket",
        "mission",
    ]
    question_lower = question.lower()
    is_nasa_topic = any(kw in question_lower for kw in nasa_keywords)

    # 3. Route NASA questions through NASA ADS and NASA-biased search.
    if is_nasa_topic:
        if any(kw in question_lower for kw in ["paper", "study", "research", "experiment", "publication"]):
            papers = nasa_ads_search(question)
            if "failed" not in papers and "No relevant" not in papers:
                enriched = f"User: {question}\n\nNASA Papers:\n{papers}\n\nProvide a structured answer with citations."
                raw = agent.invoke({"input": enriched}, config={"configurable": {"session_id": session_id}})
                return format_nasa_response(raw)

        nasa_results = nasa_search(question)
        if "No NASA sources" not in nasa_results:
            enriched = f"User: {question}\n\nNASA Sources:\n{nasa_results}\n\nAnswer using these sources."
            raw = agent.invoke({"input": enriched}, config={"configurable": {"session_id": session_id}})
            return format_nasa_response(raw)

    # 4. For non-NASA questions, use general search as the existing app did.
    general_wrapper = DuckDuckGoSearchAPIWrapper(region="wt-wt", max_results=3)
    general_results = general_wrapper.results(question, 3)

    if general_results:
        general_text = "\n\n".join(
            [
                f"**{r['title']}**\n🔗 {r['link']}\n{r.get('snippet', '')}"
                for r in general_results
            ]
        )
        enriched = f"User: {question}\n\nWeb Search Results:\n{general_text}\n\nProvide a concise, factual summary."
        raw = agent.invoke({"input": enriched}, config={"configurable": {"session_id": session_id}})
        return format_nasa_response(raw)

    # 5. Last resort: honest "I don't know".
    return format_nasa_response(
        "I cannot provide real-time news or financial updates without live web search results. "
        "Please check a trusted news source like Reuters, Bloomberg, or CNBC for the latest Wall Street updates."
    )


def save_chat(db: Session, user_id: int, question: str, answer: str) -> ChatHistory:
    chat = ChatHistory(user_id=user_id, question=question, answer=answer)
    db.add(chat)
    db.commit()
    db.refresh(chat)
    return chat


def save_conversation_exchange(
    db: Session,
    current_user: User,
    question: str,
    answer: str,
    conversation_id: Optional[int] = None,
) -> Conversation:
    if conversation_id is None:
        conversation = Conversation(
            user_id=current_user.id,
            title=generate_conversation_title(question),
        )
        db.add(conversation)
        db.flush()
        first_user_message = True
    else:
        conversation = get_user_conversation(db, current_user, conversation_id)
        first_user_message = not any(message.role == "user" for message in conversation.messages)

    if first_user_message or conversation.title == "New chat":
        conversation.title = generate_conversation_title(question)
    conversation.updated_at = utc_now()
    db.add_all(
        [
            Message(conversation_id=conversation.id, role="user", content=question),
            Message(conversation_id=conversation.id, role="assistant", content=answer),
        ]
    )
    return conversation


def get_user_conversation(db: Session, current_user: User, conversation_id: int) -> Conversation:
    conversation = (
        db.query(Conversation)
        .options(selectinload(Conversation.messages))
        .filter(
            Conversation.id == conversation_id,
            Conversation.user_id == current_user.id,
        )
        .first()
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    return conversation


def hydrate_agent_session(session_id: str, messages: list[Message]) -> None:
    """Restore enough chat memory for follow-up prompts after a page reload."""
    history = get_session_history(session_id)
    if history.messages:
        return

    for message in messages:
        if message.role == "user":
            history.add_user_message(message.content)
        elif message.role == "assistant":
            history.add_ai_message(message.content)


def get_user_document(db: Session, current_user: User, document_id: int) -> KnowledgeDocument:
    document = (
        db.query(KnowledgeDocument)
        .filter(
            KnowledgeDocument.id == document_id,
            KnowledgeDocument.user_id == current_user.id,
        )
        .first()
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return document


def process_knowledge_document_task(document_id: int) -> None:
    db = SessionLocal()
    try:
        process_document(db, document_id)
    finally:
        db.close()


def build_document_text_response(document: KnowledgeDocument) -> KnowledgeDocumentTextResponse:
    return KnowledgeDocumentTextResponse(
        id=document.id,
        filename=document.original_filename,
        type=document.content_type,
        status=document.processing_status or STATUS_PENDING,
        text=document.extracted_text or "",
        processed_at=document.processed_at,
        extraction_error=document.extraction_error,
    )


def ensure_document_chunks_available(document: KnowledgeDocument) -> None:
    processing_status_value = document.processing_status or STATUS_PENDING
    if processing_status_value in {STATUS_PENDING, STATUS_PROCESSING}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document is still processing. Chunks will be available after extraction completes.",
        )
    if processing_status_value == STATUS_FAILED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=document.extraction_error or "Document processing failed. Reprocess the document to try again.",
        )
    if processing_status_value != STATUS_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document chunks are not available yet.",
        )
    if document.extracted_text is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document text has not been extracted yet.",
        )


def build_document_chunks_response(db: Session, document: KnowledgeDocument) -> DocumentChunksResponse:
    ensure_document_chunks_available(document)
    chunks = list_document_chunks(db, document.id)
    return DocumentChunksResponse(
        document_id=document.id,
        chunk_count=len(chunks),
        chunks=chunks,
    )


def build_document_chunk_stats_response(db: Session, document: KnowledgeDocument) -> DocumentChunkStatsResponse:
    return DocumentChunkStatsResponse(**get_document_chunk_statistics(db, document))


@app.post(
    "/knowledge/documents",
    response_model=KnowledgeDocumentResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["knowledge-library"],
)
async def upload_knowledge_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    original_name, extension = validate_upload_file(file)
    ensure_upload_root()

    user_directory = UPLOAD_ROOT / str(current_user.id)
    user_directory.mkdir(parents=True, exist_ok=True)
    stored_filename = f"{secrets.token_hex(16)}{extension}"
    storage_path = user_directory / stored_filename
    bytes_written = 0

    try:
        with storage_path.open("wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_BYTES:
                    buffer.close()
                    storage_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File is too large. Maximum upload size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
                    )
                buffer.write(chunk)
    finally:
        await file.close()

    document = KnowledgeDocument(
        user_id=current_user.id,
        original_filename=original_name,
        stored_filename=stored_filename,
        storage_path=str(storage_path),
        content_type=ALLOWED_UPLOADS[extension],
        file_extension=extension.lstrip("."),
        file_size=bytes_written,
        processing_status=STATUS_PENDING,
    )

    try:
        db.add(document)
        db.commit()
        db.refresh(document)
        background_tasks.add_task(process_knowledge_document_task, document.id)
        return document
    except SQLAlchemyError as exc:
        db.rollback()
        storage_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save document metadata.",
        ) from exc


@app.get("/knowledge/documents", response_model=list[KnowledgeDocumentResponse], tags=["knowledge-library"])
def list_knowledge_documents(
    limit: int = Query(80, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(KnowledgeDocument)
        .filter(KnowledgeDocument.user_id == current_user.id)
        .order_by(KnowledgeDocument.uploaded_at.desc(), KnowledgeDocument.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@app.get(
    "/knowledge/documents/{document_id}",
    response_model=KnowledgeDocumentResponse,
    tags=["knowledge-library"],
)
def read_knowledge_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_document(db, current_user, document_id)


@app.get(
    "/knowledge/documents/{document_id}/text",
    response_model=KnowledgeDocumentTextResponse,
    tags=["knowledge-library"],
)
def read_knowledge_document_text(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = get_user_document(db, current_user, document_id)
    return build_document_text_response(document)


@app.get(
    "/documents/{document_id}/text",
    response_model=KnowledgeDocumentTextResponse,
    tags=["knowledge-library"],
)
def read_document_text(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = get_user_document(db, current_user, document_id)
    return build_document_text_response(document)


@app.get(
    "/knowledge/documents/{document_id}/chunks",
    response_model=DocumentChunksResponse,
    tags=["knowledge-library"],
)
def read_knowledge_document_chunks(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = get_user_document(db, current_user, document_id)
    return build_document_chunks_response(db, document)


@app.get(
    "/documents/{document_id}/chunks",
    response_model=DocumentChunksResponse,
    tags=["knowledge-library"],
)
def read_document_chunks(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = get_user_document(db, current_user, document_id)
    return build_document_chunks_response(db, document)


@app.get(
    "/knowledge/documents/{document_id}/chunk-stats",
    response_model=DocumentChunkStatsResponse,
    tags=["knowledge-library"],
)
def read_knowledge_document_chunk_stats(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = get_user_document(db, current_user, document_id)
    return build_document_chunk_stats_response(db, document)


@app.get(
    "/documents/{document_id}/chunk-stats",
    response_model=DocumentChunkStatsResponse,
    tags=["knowledge-library"],
)
def read_document_chunk_stats(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = get_user_document(db, current_user, document_id)
    return build_document_chunk_stats_response(db, document)


@app.post(
    "/knowledge/documents/{document_id}/reprocess",
    response_model=KnowledgeDocumentResponse,
    tags=["knowledge-library"],
)
def reprocess_knowledge_document(
    document_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = get_user_document(db, current_user, document_id)
    storage_path = Path(document.storage_path)
    if not storage_path.exists() or not storage_path.is_file():
        document.processing_status = "failed"
        document.extraction_error = "Extraction failed because the stored file could not be found."
        document.processed_at = utc_now()
        db.commit()
        db.refresh(document)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=document.extraction_error)

    try:
        reset_document_processing_state(db, document)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not queue document processing.",
        ) from exc

    background_tasks.add_task(process_knowledge_document_task, document.id)
    return document


@app.post(
    "/documents/{document_id}/reprocess",
    response_model=KnowledgeDocumentResponse,
    tags=["knowledge-library"],
)
def reprocess_document(
    document_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return reprocess_knowledge_document(document_id, background_tasks, current_user, db)


@app.get("/knowledge/documents/{document_id}/preview", tags=["knowledge-library"])
def preview_knowledge_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = get_user_document(db, current_user, document_id)
    path = Path(document.storage_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored file not found.")

    return FileResponse(
        path,
        media_type=document.content_type,
        filename=document.original_filename,
        content_disposition_type="inline",
    )


@app.delete("/knowledge/documents/{document_id}", response_model=MessageResponse, tags=["knowledge-library"])
def delete_knowledge_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = get_user_document(db, current_user, document_id)
    storage_path = Path(document.storage_path)

    try:
        db.delete(document)
        db.commit()
        storage_path.unlink(missing_ok=True)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete document metadata.",
        ) from exc

    return {"message": "Document deleted."}


@app.post(
    "/conversations",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["conversations"],
)
def create_conversation(
    payload: Optional[ConversationCreate] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = Conversation(
        user_id=current_user.id,
        title=payload.title if payload and payload.title else "New chat",
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@app.get("/conversations", response_model=list[ConversationResponse], tags=["conversations"])
def list_conversations(
    limit: int = Query(80, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(Conversation)
        .options(selectinload(Conversation.messages))
        .filter(Conversation.user_id == current_user.id)
        .order_by(Conversation.updated_at.desc(), Conversation.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@app.delete("/conversations", response_model=MessageResponse, tags=["conversations"])
def clear_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversations = db.query(Conversation).filter(Conversation.user_id == current_user.id).all()
    for conversation in conversations:
        db.delete(conversation)
    db.commit()
    return {"message": "All conversations cleared."}


@app.get("/conversations/{conversation_id}", response_model=ConversationResponse, tags=["conversations"])
def read_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_conversation(db, current_user, conversation_id)


@app.patch("/conversations/{conversation_id}", response_model=ConversationResponse, tags=["conversations"])
def update_conversation(
    conversation_id: int,
    payload: ConversationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = get_user_conversation(db, current_user, conversation_id)
    conversation.title = payload.title
    conversation.updated_at = utc_now()
    db.commit()
    db.refresh(conversation)
    return get_user_conversation(db, current_user, conversation_id)


@app.delete("/conversations/{conversation_id}", response_model=MessageResponse, tags=["conversations"])
def delete_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = get_user_conversation(db, current_user, conversation_id)
    db.delete(conversation)
    db.commit()
    return {"message": "Conversation deleted."}


@app.post(
    "/conversations/{conversation_id}/messages",
    response_model=ConversationSendResponse,
    tags=["conversations"],
)
def send_conversation_message(
    conversation_id: int,
    payload: ConversationMessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = get_user_conversation(db, current_user, conversation_id)
    existing_messages = list(conversation.messages)
    first_user_message = not any(message.role == "user" for message in existing_messages)
    session_id = f"user:{current_user.id}:conversation:{conversation.id}"
    hydrate_agent_session(session_id, existing_messages)

    try:
        user_message = Message(
            conversation_id=conversation.id,
            role="user",
            content=payload.content,
        )
        db.add(user_message)
        db.flush()

        if first_user_message or conversation.title == "New chat":
            conversation.title = generate_conversation_title(payload.content)
        conversation.updated_at = utc_now()

        answer = generate_ai_answer(payload.content, session_id)
        assistant_message = Message(
            conversation_id=conversation.id,
            role="assistant",
            content=answer,
        )
        db.add(assistant_message)
        conversation.updated_at = utc_now()
        db.commit()
        db.refresh(user_message)
        db.refresh(assistant_message)

        updated_conversation = get_user_conversation(db, current_user, conversation.id)
        return {
            "conversation": updated_conversation,
            "user_message": user_message,
            "assistant_message": assistant_message,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed message send: {str(e)}",
        ) from e


@app.post("/ask", response_model=ChatResponse, tags=["chat"])
async def ask(
    chat_request: ChatRequest,
    req: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session_suffix = req.headers.get("X-Session-ID", "default")
    session_id = f"user:{current_user.id}:{session_suffix}"
    conversation_header = req.headers.get("X-Conversation-ID")
    conversation_id = int(conversation_header) if conversation_header and conversation_header.isdigit() else None

    try:
        answer = generate_ai_answer(chat_request.question, session_id)
        save_chat(db, current_user.id, chat_request.question, answer)
        save_conversation_exchange(db, current_user, chat_request.question, answer, conversation_id)
        db.commit()
        return {"answer": answer}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}") from e


@app.get("/history", response_model=list[ChatHistoryResponse], tags=["chat"])
def get_history(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(ChatHistory)
        .filter(ChatHistory.user_id == current_user.id)
        .order_by(ChatHistory.timestamp.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")


@app.get("/health", tags=["system"])
async def health():
    return {
        "status": "LIVE",
        "model": "llama-3.3-70b-versatile",
        "challenge": "NASA Space Biology Knowledge Engine",
        "auth": "enabled",
        "database": "sqlite",
    }
