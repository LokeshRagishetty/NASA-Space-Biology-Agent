# main.py
import os
import re
from contextlib import asynccontextmanager
from datetime import timedelta

import markdown
import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_groq import ChatGroq
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    authenticate_user,
    create_access_token,
    get_current_user,
    get_password_hash,
)
from database import Base, engine, get_db
from models import ChatHistory, User
from schemas import (
    ChatHistoryResponse,
    ChatRequest,
    ChatResponse,
    MessageResponse,
    TokenResponse,
    UserCreate,
    UserLogin,
    UserProfile,
)

load_dotenv()

# Validate keys at startup so deployment issues fail loudly.
assert os.getenv("GROQ_API_KEY"), "Missing GROQ_API_KEY in .env"
assert os.getenv("NASA_ADS_TOKEN"), "Missing NASA_ADS_TOKEN in .env"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # For SQLite/simple deployments. Use Alembic migrations before a large production launch.
    Base.metadata.create_all(bind=engine)
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
        '<blockquote style="border-left: 4px solid #0b5394; padding-left: 16px; margin: 16px 0; color: #2c3e50;">',
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


@app.post("/ask", response_model=ChatResponse, tags=["chat"])
async def ask(
    chat_request: ChatRequest,
    req: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session_suffix = req.headers.get("X-Session-ID", "default")
    session_id = f"user:{current_user.id}:{session_suffix}"

    try:
        answer = generate_ai_answer(chat_request.question, session_id)
        save_chat(db, current_user.id, chat_request.question, answer)
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
