# RAG Service

A PDF-based RAG workspace built with FastAPI, Qdrant, OpenAI, and a modern HTML/CSS/JavaScript frontend.

Live app: [https://rag-service-1lbq.onrender.com/](https://rag-service-1lbq.onrender.com/)

GitHub repo: [https://github.com/swayamkr03/RAG_SERVICE](https://github.com/swayamkr03/RAG_SERVICE)

## Features

- Upload PDF documents from the browser
- Extract and chunk PDF text
- Store document chunks and vectors in Qdrant
- Ask questions about uploaded documents
- Uses OpenAI when available
- Automatically falls back to local embeddings/answers when OpenAI quota is exhausted
- Modern static frontend served by FastAPI
- Inngest functions for workflow-based ingest/query execution
- Qdrant Cloud compatible for production deployment

## Tech Stack

- Backend: FastAPI
- Frontend: HTML, CSS, JavaScript
- Vector database: Qdrant
- Workflow orchestration: Inngest
- AI provider: OpenAI with local fallback
- Package manager: uv
- Deployment: Render

## Project Structure

```text
.
├── main.py              # FastAPI app, API routes, Inngest functions
├── dataloader.py        # PDF loading, chunking, embeddings
├── vector_db.py         # Qdrant storage/search wrapper
├── custom_types.py      # Pydantic models
├── static/
│   ├── index.html       # Frontend markup
│   ├── styles.css       # Frontend styling
│   └── app.js           # Frontend behavior
├── uploads/             # Local uploaded PDFs, ignored by Git
├── qdrant_storage/      # Local Qdrant data, ignored by Git
├── .env.example         # Environment variable template
├── pyproject.toml
└── uv.lock
```

## Environment Variables

Create a local `.env` file from `.env.example`:

```env
OPENAI_API_KEY=
EMBED_PROVIDER=auto
ANSWER_PROVIDER=auto
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=docs
```

Provider modes:

- `auto`: try OpenAI first, then use local fallback if OpenAI fails
- `openai`: require OpenAI and raise errors if unavailable
- `local`: use local fallback only

## Run Locally

Start Qdrant with Docker:

```powershell
docker start qdrant
```

If the container does not exist yet:

```powershell
docker run -d --name qdrant -p 6333:6333 -v "${PWD}/qdrant_storage:/qdrant/storage" qdrant/qdrant
```

Run the FastAPI app:

```powershell
cd C:\Users\swaya\OneDrive\Documents\rag_project
uv run uvicorn main:app --reload
```

Open:

```text
http://127.0.0.1:8000
```

If port `8000` is busy:

```powershell
uv run uvicorn main:app --reload --port 8010
```

## API Endpoints

```text
GET  /
POST /api/ingest
POST /api/query
GET  /docs
POST /api/inngest
```

Upload a PDF:

```bash
curl -F "file=@document.pdf" http://127.0.0.1:8000/api/ingest
```

Ask a question:

```bash
curl -X POST http://127.0.0.1:8000/api/query \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"What is this document about?\",\"top_k\":5}"
```

## Production Deployment

The live app is deployed on Render:

[https://rag-service-1lbq.onrender.com/](https://rag-service-1lbq.onrender.com/)

For production, use Qdrant Cloud instead of local Docker Qdrant.

Render start command:

```bash
uv run uvicorn main:app --host 0.0.0.0 --port $PORT
```

Required production environment variables:

```env
OPENAI_API_KEY=your_openai_key
EMBED_PROVIDER=auto
ANSWER_PROVIDER=auto
QDRANT_URL=your_qdrant_cloud_url
QDRANT_API_KEY=your_qdrant_cloud_api_key
QDRANT_COLLECTION=docs
```

## Notes

- `.env` is ignored by Git and should never be committed.
- `uploads/` is local runtime data and ignored by Git.
- `qdrant_storage/` is local Docker Qdrant storage and ignored by Git.
- If OpenAI quota is exhausted, the app still works using local fallback mode.
- If switching from local embeddings to OpenAI embeddings, re-upload documents so vectors are regenerated consistently.
