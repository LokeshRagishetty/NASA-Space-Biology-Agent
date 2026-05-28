🚀 NASA Space Biology Research Agent

AI-Powered Research Assistant using Retrieval-Augmented Generation (RAG)

📌 Problem Statement

Space biology research is scattered across multiple scientific databases, making it time-consuming for researchers and students to:

Search relevant research papers

Understand complex scientific abstracts

Get summarized insights quickly

Compare findings across multiple sources

Traditional search engines return raw papers but do not provide contextual summaries or intelligent analysis.

This project aims to build an AI-powered research assistant that retrieves scientific data from trusted sources and generates structured, summarized insights using modern LLM-based reasoning.

🎯 Objective

To develop a multi-source AI research assistant that:

Retrieves scientific papers from NASA ADS

Fetches contextual information from web search

Uses a Large Language Model for reasoning

Generates structured, easy-to-understand summaries

Reduces literature review time

🏗️ System Architecture
User
  │
  ▼
FastAPI Backend
  │
  ▼
LangChain Agent
  │
  ├── NASA ADS API (Scientific Papers)
  ├── DuckDuckGo Search (Web Context)
  │
  ▼
Groq LLM (Reasoning + Summarization)
  │
  ▼
Structured Research Response
  │
  ▼
Web Interface
Architecture Flow

User submits a research question.

FastAPI receives the request.

LangChain Agent activates tools.

NASA ADS API retrieves scientific abstracts.

DuckDuckGo fetches additional context.

Groq LLM processes retrieved data.

Structured summary is returned to user.

🛠️ Tools & Technologies Used
Backend

FastAPI

Uvicorn

Python 3.10+

AI & Agent Framework

LangChain

LangChain Groq Integration

Retrieval-Augmented Generation (RAG)

APIs

NASA Astrophysics Data System (ADS)

DuckDuckGo Search API

Groq LLM API

Frontend

HTML

CSS

JavaScript (Static UI)

DevOps

Docker

Environment Variables (.env)

Google OAuth Backend Exchange

The React frontend uses Firebase popup sign-in. After Firebase authenticates the
Google user, the frontend sends the Firebase ID token to FastAPI:

POST /google-login

FastAPI verifies that token with Firebase Admin SDK, creates or links a local
user, and returns the normal platform JWT used by protected routes.

Required backend environment variables:

FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

Alternative supported credential formats:

FIREBASE_SERVICE_ACCOUNT_FILE=/secure/path/service-account.json
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

For multiline private keys stored in .env, keep newline escapes as \n. The
backend converts them before initializing Firebase Admin.

🔍 Data Sources
1. NASA ADS

Primary scientific source for:

Peer-reviewed space biology papers

Microgravity research

Radiation exposure studies

ISS experiments

2. DuckDuckGo Search

Used for:

Recent updates

Public scientific explanations

Additional context

💡 Key Features

Multi-tool AI Agent

Scientific literature retrieval

Real-time web search integration

Structured research summaries

Markdown formatted responses

REST API endpoint (/ask)

Health check endpoint (/health)

📊 Results

Example Query:

How does microgravity affect human bone density?

System Output:

Retrieves NASA research abstracts

Extracts key findings

Summarizes physiological effects

Provides structured explanation

Observed Benefits:

Faster literature review

Reduced manual paper scanning

Scientifically grounded responses

Lower hallucination risk due to RAG approach

📷 Screenshots

In screenshots folder
