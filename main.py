from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import logging
import inngest
import inngest.fast_api
from dotenv import load_dotenv
import uuid
import os 
from pathlib import Path
import shutil
import re
from openai import OpenAI, OpenAIError
from dataloader import load_and_chunk_pdf,embed_text
from vector_db import QdrantStorage
from custom_types import ragChunkAndSrc,ragQueryAndresult,ragSearchresult,ragUpsertresult
from pydantic import BaseModel



load_dotenv()
openai_client = OpenAI(max_retries=0)
ANSWER_PROVIDER = os.getenv("ANSWER_PROVIDER", "auto").lower()
BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)


class QueryRequest(BaseModel):
    question: str
    top_k: int = 5


STOP_WORDS={
    "about","after","again","also","and","any","are","can","could","details",
    "document","does","for","from","give","has","have","how","into","main",
    "more","pdf","please","question","show","summary","tell","that","the",
    "this","what","when","where","which","with","would","your"
}
DETAIL_TERMS={
    "internship","duration","date","dates","stipend","compensation",
    "remunerative","voluntary","eligibility","criteria","leave","offer",
    "terms","organization","project","guide"
}


def _clean_text(text:str)->str:
    return re.sub(r"\s+", " ", text).strip()


def _sentence_split(text:str)->list[str]:
    normalized=_clean_text(text)
    return [item.strip() for item in re.split(r"(?<=[.!?])\s+", normalized) if item.strip()]


def _question_terms(question:str)->set[str]:
    return {
        term
        for term in re.findall(r"[a-zA-Z0-9]+", question.lower())
        if len(term) > 2 and term not in STOP_WORDS
    }


def _rank_sentences(question:str, contexts:list[str])->list[str]:
    terms=_question_terms(question)
    lowered_question=question.lower()
    if any(word in lowered_question for word in ["detail","internship","terms"]):
        terms=terms | DETAIL_TERMS

    seen=set()
    ranked=[]
    for context_index,context in enumerate(contexts):
        for sentence_index,sentence in enumerate(_sentence_split(context)):
            cleaned=_clean_text(sentence)
            if not cleaned or cleaned.lower() in seen:
                continue
            seen.add(cleaned.lower())
            sentence_lower=cleaned.lower()
            score=sum(3 for term in terms if term in sentence_lower)
            score+=sum(1 for term in terms if term in _clean_text(context).lower())
            score-=context_index * 0.05
            score-=sentence_index * 0.01
            ranked.append((score,cleaned))

    ranked.sort(key=lambda item:item[0],reverse=True)
    return [sentence for score,sentence in ranked if score > 0]


def _merge_contexts(*context_groups:list[str])->list[str]:
    merged=[]
    seen=set()
    for contexts in context_groups:
        for context in contexts:
            key=_clean_text(context).lower()
            if key and key not in seen:
                seen.add(key)
                merged.append(context)
    return merged


def _fallback_answer(question:str, contexts:list[str])->str:
    if not contexts:
        return "I could not find matching context in the indexed document."

    sentences=[]
    for context in contexts:
        sentences.extend(_sentence_split(context))

    if not sentences:
        preview=_clean_text(contexts[0])
        return preview[:500] + ("..." if len(preview) > 500 else "")

    lowered_question=question.lower()
    ranked=_rank_sentences(question,contexts)

    if any(word in lowered_question for word in ["detail","details","terms","internship"]):
        best=ranked[:5] or sentences[:5]
        return "\n".join(f"- {sentence}" for sentence in best)[:1000]

    if any(word in lowered_question for word in ["summary","summarize","topic","about"]):
        first_context=_clean_text(contexts[0])
        first_sentences=_sentence_split(first_context)
        answer=" ".join((ranked[:2] or first_sentences[:2])) if first_sentences else first_context
        return answer[:650] + ("..." if len(answer) > 650 else "")

    best=ranked[:3] or sentences[:3]
    answer=" ".join(best) or _clean_text(contexts[0])
    return answer[:750] + ("..." if len(answer) > 750 else "")


def ingest_pdf(pdf_path:str, source_id:str | None = None)->ragUpsertresult:
    if not Path(pdf_path).exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    chunks=load_and_chunk_pdf(pdf_path)
    if not chunks:
        raise ValueError("No readable text was found in this PDF.")

    source_id=source_id or pdf_path
    vecs=embed_text(chunks)
    ids=[str(uuid.uuid5(uuid.NAMESPACE_URL,f"{source_id}:{i}"))for i in range(len(chunks))]
    payloads=[{"source":source_id,"text":chunks[i]}for i in range(len(chunks))]
    QdrantStorage().upsert(ids,vecs,payloads)
    return ragUpsertresult(ingested=len(chunks))


def answer_question(question:str, top_k:int=5)->ragQueryAndresult:
    if not question.strip():
        raise ValueError("Question cannot be empty.")

    query_vec=embed_text([question])[0]
    store=QdrantStorage()
    found=store.search(query_vec,top_k)
    payloads=store.get_payload_texts()
    reranked_contexts=_rank_sentences(question,payloads["contexts"])
    combined_contexts=_merge_contexts(found["contexts"],reranked_contexts,payloads["contexts"][:2])
    combined_sources=sorted(set(found["sources"]) | set(payloads["sources"]))
    search_result=ragSearchresult(context=combined_contexts[:max(top_k,5)],sources=combined_sources)
    trimmed_contexts=[_clean_text(context)[:1200] for context in search_result.context[:3]]
    context_block="\n\n".join(f"- {c}"for c in trimmed_contexts)

    user_content=(
        "Use the following to answer the question.\n\n"
        f"Context:\n{context_block}\n\n"
        f"Question:{question}\n"
        "answer concisely using the context above"
    )

    if ANSWER_PROVIDER == "local":
        answer=_fallback_answer(question, search_result.context)
    else:
        try:
            res=openai_client.chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=1024,
                temperature=0.2,
                messages=[
                    {"role":"system","content":"Use the provided context only."},
                    {"role":"user","content":user_content}
                ],
            )
            answer=res.choices[0].message.content.strip()
        except OpenAIError:
            if ANSWER_PROVIDER == "openai":
                raise
            answer=_fallback_answer(question, search_result.context)

    return ragQueryAndresult(
        answer=answer,
        sources=search_result.sources,
        num_contexts=len(search_result.context),
    )

inngest_client=inngest.Inngest(
    app_id="rag_app",
    logger=logging.getLogger("uvicorn"),
    is_production=False,
    serializer=inngest.PydanticSerializer()
)

@inngest_client.create_function(
    fn_id="rag: ingest PDF",
    trigger=inngest.TriggerEvent(event="rag/ingest_pdf")
)
async def rag_ingest_pdf(ctx :inngest.Context):
    def _load(ctx:inngest.Context)->ragChunkAndSrc:
        pdf_path=ctx.event.data.get("pdf_path") or ctx.event.data.get("pdf-path")
        if not pdf_path:
            raise ValueError("Missing PDF path. Send data.pdf_path in the event payload.")
        source_id=ctx.event.data.get("source_id",pdf_path)
        chunks=load_and_chunk_pdf(pdf_path)
        return ragChunkAndSrc(chunks=chunks,source_id=source_id)

    def _upsert(chunks_and_src:ragChunkAndSrc)->ragUpsertresult:
        source_id=chunks_and_src.source_id
        chunks=chunks_and_src.chunks
        vecs=embed_text(chunks)
        ids=[str(uuid.uuid5(uuid.NAMESPACE_URL,f"{source_id}:{i}"))for i in range(len(chunks))]
        payloads=[{"source":source_id,"text":chunks[i]}for i in range(len(chunks))]
        QdrantStorage().upsert(ids,vecs,payloads)
        return ragUpsertresult(ingested=len(chunks))


    chunks_and_src=await ctx.step.run("load-and-chunk",lambda:_load(ctx),output_type=ragChunkAndSrc)
    ingested=await ctx.step.run("embed-and-upsert",lambda:_upsert(chunks_and_src),output_type=ragUpsertresult)
    return ingested.model_dump()

@inngest_client.create_function(
    fn_id="rag: Query PDF",
    trigger=inngest.TriggerEvent(event="rag/query_pdf_ai")
)
async def rag_query_pdf_ai(ctx:inngest.Context):
    question=ctx.event.data["question"]
    top_k=int(ctx.event.data.get("top_k",5))
    result=await ctx.step.run("search-and-answer",lambda:answer_question(question,top_k),output_type=ragQueryAndresult)
    return result.model_dump()


app=FastAPI()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/ingest")
async def api_ingest(file:UploadFile=File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400,detail="Please upload a PDF file.")

    safe_name=Path(file.filename).name
    saved_path=UPLOAD_DIR / f"{uuid.uuid4()}-{safe_name}"

    try:
        with saved_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        result=ingest_pdf(str(saved_path), source_id=safe_name)
        return {"filename":safe_name, **result.model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        await file.close()


@app.post("/api/query")
async def api_query(request:QueryRequest):
    try:
        return answer_question(request.question, request.top_k).model_dump()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

inngest.fast_api.serve(app,inngest_client,[rag_ingest_pdf,rag_query_pdf_ai])
