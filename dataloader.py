import hashlib
import math
import os
import re

from openai import OpenAI, OpenAIError
from llama_index.readers.file import PDFReader
from llama_index.core.node_parser import SentenceSplitter
from dotenv import load_dotenv

load_dotenv()

client=OpenAI(max_retries=0)

EMBED_MODEL="text-embedding-3-large"
EMBED_DIM=3072
EMBED_PROVIDER=os.getenv("EMBED_PROVIDER", "auto").lower()

splitter=SentenceSplitter(chunk_size=450,chunk_overlap=80)

def load_and_chunk_pdf(path:str):
    docs=PDFReader().load_data(file=path)
    text=[d.text for d in docs if getattr(d,"text",None)]
    chunks=[]

    for t in text:
        chunks.extend(splitter.split_text(t))
    return chunks 



def embed_text(texts:list[str])->list[list[float]]:
    if EMBED_PROVIDER == "local":
        return [_local_embedding(text) for text in texts]

    try:
        response=client.embeddings.create(
            model=EMBED_MODEL,
            input=texts,
        )
        return [item.embedding for item in response.data]
    except OpenAIError:
        if EMBED_PROVIDER == "openai":
            raise
        return [_local_embedding(text) for text in texts]


def _local_embedding(text:str)->list[float]:
    vector=[0.0] * EMBED_DIM
    tokens=re.findall(r"[a-zA-Z0-9]+", text.lower())

    for token in tokens:
        digest=hashlib.sha256(token.encode("utf-8")).digest()
        index=int.from_bytes(digest[:4], "big") % EMBED_DIM
        sign=1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign

    norm=math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector

    return [value / norm for value in vector]
