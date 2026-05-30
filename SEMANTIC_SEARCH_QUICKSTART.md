## SEMANTIC SEARCH - QUICK START GUIDE

### ⚡ 5-Minute Setup

#### 1. Backend Requirements (Already Installed)
```
sentence-transformers
chromadb
sqlalchemy
pydantic
fastapi
```

#### 2. Test the Implementation

**Start Backend:**
```bash
cd /Users/lokesh/NASA-Space-Biology-Agent---ultimate
python -m uvicorn main:app --reload --port 8000
```

**Start Frontend:**
```bash
cd frontend
npm run dev
```

**Open Browser:**
```
http://localhost:5173/app/knowledge
```

#### 3. Minimal Test Flow

1. **Upload Document:**
   - Click "Upload file"
   - Select a PDF about space biology
   - Wait for "Processing" badge to disappear

2. **Generate Embeddings:**
   - Click on document to select it
   - Scroll to "Embedding" section
   - Wait for status to show "Ready"

3. **Search:**
   - Find "Semantic Search" panel at top
   - Type: "plant growth"
   - Set top_k: 5
   - Click Search
   - View results in modal

### 📋 API Quick Reference

**Global Search:**
```bash
curl -X POST http://localhost:8000/search \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "plant growth in space",
    "top_k": 5
  }'
```

**Document Search:**
```bash
curl -X POST http://localhost:8000/documents/1/search \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "cellular response",
    "top_k": 3
  }'
```

**Search Stats:**
```bash
curl -X GET http://localhost:8000/search-statistics \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 🎯 Key Features

| Feature | Status | Details |
|---------|--------|---------|
| Semantic Search | ✅ | Query embedding → ChromaDB → Results |
| User Isolation | ✅ | User ID filter in ChromaDB queries |
| Document Filter | ✅ | Search within specific document |
| Score Display | ✅ | Similarity as percentage |
| Analytics | ✅ | Time, count, best match |
| Error Handling | ✅ | Validation + helpful messages |
| Performance | ✅ | ~100-150ms typical |

### 🧪 Test Cases

**Basic Search:**
```
Query: "microgravity effects"
Expected: 3-5 relevant chunks with scores >0.7
```

**Similar Queries:**
```
Query 1: "plant growth in space"
Query 2: "plants grow without gravity"
Query 3: "microgravity plant development"
Expected: Same or very similar results
```

**Document Search:**
```
1. Select document A
2. Search: "topic X"
3. Expected: Results only from A
4. Select document B
5. Same search
6. Expected: Results only from B
```

**Top K Variation:**
```
Query: "same text"
top_k: 1 → 1 result
top_k: 5 → 5 results
top_k: 20 → up to 20 results
```

**User Isolation:**
```
User A: Upload doc1.pdf, search finds own results ✅
User B: Cannot search doc1.pdf ❌
```

### 🐛 Troubleshooting

**"Search is not available yet"**
- Generate embeddings for at least one document
- Check "Embedding" status is "Ready"

**No results found**
- Try a different/more specific query
- Check document was processed successfully
- Verify embeddings were generated

**"Your session expired"**
- Log out and log back in
- Refresh page if browser showed error

**"Could not load search statistics"**
- Backend service might be down
- Check Flask/FastAPI server logs
- Restart backend

### 📊 Response Format

```json
{
  "query": "your query",
  "results": [
    {
      "document_id": 1,
      "chunk_id": 42,
      "filename": "document.pdf",
      "chunk_text": "relevant text excerpt...",
      "similarity_score": 0.85,
      "chunk_index": 41
    }
  ],
  "total_results": 1,
  "search_time_ms": 98.5,
  "highest_similarity_score": 0.85
}
```

### 🔍 Code Structure

```
services/semantic_search.py
├── search_documents()           # Main search logic
├── validate_search_query()      # Query validation
├── validate_top_k()             # Parameter validation
└── get_search_statistics()      # Availability check

main.py
├── POST /search                 # Global search
├── POST /documents/{id}/search  # Document search
└── GET /search-statistics       # Availability

frontend/
├── SearchPanel                  # Search UI
├── SearchResultsModal           # Results display
└── API calls in KnowledgeLibraryPage
```

### 🚀 What's Next

After semantic search is tested and working:

**Phase-2 Step-7: RAG Implementation**
- Retrieve chunks using semantic search
- Inject into LLM prompts
- Generate AI responses
- Add citations

**Integration Example:**
```python
# Step 1: Search for relevant chunks
results = search_documents(db, "how do plants grow?", user_id)

# Step 2: Extract chunk texts
context = "\n".join([r.chunk_text for r in results.results])

# Step 3: Create RAG prompt
prompt = f"Context: {context}\n\nQuestion: ?"

# Step 4: Call Groq API
response = llm(prompt)

# Step 5: Add citations
cited_response = add_citations(response, results)
```

### 📚 Documentation

- **Full Details:** See `SEMANTIC_SEARCH.md`
- **Test Script:** Run `python test_semantic_search.py`
- **API Docs:** FastAPI interactive docs at `/docs`

### ⚙️ Configuration

Environment variables (in `.env`):
```
CHROMA_VECTOR_STORE_DIR=vector_store
KNOWLEDGE_EMBEDDING_BATCH_SIZE=32
KNOWLEDGE_VECTOR_BATCH_SIZE=128
```

Query limits (in `semantic_search.py`):
```python
MAX_TOP_K = 20               # Hard limit
DEFAULT_TOP_K = 5            # Default
MAX_QUERY_LENGTH = 4000      # Characters
```

### 💡 Tips

1. **Better Search Results:**
   - Use complete sentences
   - Include context words
   - Avoid very short queries

2. **Performance:**
   - Scores are fast even with 10k+ chunks
   - First search slower (model load)
   - Subsequent searches cached

3. **Debugging:**
   - Check browser console for API errors
   - Check backend logs for exceptions
   - Verify documents are uploaded/processed
   - Confirm embeddings generated

### ✅ Verification Checklist

- [ ] Backend starts without errors
- [ ] Frontend loads Knowledge Library page
- [ ] Can upload a document
- [ ] Document processing completes
- [ ] Embedding generation succeeds
- [ ] Search panel appears
- [ ] Search button works
- [ ] Results display with scores
- [ ] Statistics show correctly
- [ ] Different queries give different results
- [ ] Similar queries give similar results
- [ ] User isolation working
- [ ] Error messages display correctly
- [ ] App works after restart

### 🎓 Learning Resources

**Understanding Embeddings:**
- all-MiniLM-L6-v2 uses 384-dimensional vectors
- Similarity = cosine distance between vectors
- Higher score = more similar meaning

**ChromaDB:**
- Vector database for ML embeddings
- Stores vectors + metadata
- Supports filtering and similarity search

**Semantic vs Keyword:**
- Keyword: "plant" matches "plant" exactly
- Semantic: "vegetation" matches "plants" conceptually
- Semantic search more powerful but slower

### 📞 Support

If stuck:
1. Check logs for error messages
2. Review test_semantic_search.py examples
3. Read SEMANTIC_SEARCH.md full documentation
4. Verify all prerequisites met
5. Try restarting services

---

**Ready to search!** 🚀
