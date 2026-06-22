import os
from urllib.parse import urlparse

from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams,Distance,PointStruct


load_dotenv()


def _validate_qdrant_url(url:str)->str:
    url=url.strip().strip("\"'")
    parsed=urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(
            "Invalid QDRANT_URL. Use only the Qdrant cluster URL, for example "
            "https://your-cluster.region.cloud.qdrant.io"
        )

    for label in parsed.hostname.split("."):
        if len(label) > 63:
            raise ValueError(
                "Invalid QDRANT_URL. A hostname part is too long. Do not paste "
                "the Qdrant API key into QDRANT_URL. Put the cluster URL in "
                "QDRANT_URL and the key in QDRANT_API_KEY."
            )

    return url.rstrip("/")


class QdrantStorage:
    def __init__(
        self,
        url: str | None = None,
        collection: str | None = None,
        dim: int = 3072,
    ):
        url = url or os.getenv("QDRANT_URL", "http://localhost:6333")
        url = _validate_qdrant_url(url)
        api_key = os.getenv("QDRANT_API_KEY")
        collection = collection or os.getenv("QDRANT_COLLECTION", "docs")
        self.client=QdrantClient(url=url,api_key=api_key,timeout=30)
        self.collection=collection
        if not self.client.collection_exists(self.collection):
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=VectorParams(size=dim,distance=Distance.COSINE),

            )
    
    def upsert(self,ids,vectors,payloads):
        points=[PointStruct(id=ids[i],vector=vectors[i],payload=payloads[i]) for i in range(len(ids))]
        self.client.upsert(self.collection,points=points)


    def search(self,query_vector,top_k : int=5):
        result=self.client.query_points(
            collection_name=self.collection,
            query=query_vector,
            with_payload=True,
            limit=top_k
        )

        contexts=[]
        sources=set()

        for r in result.points:
            payload=getattr(r,"payload",None) or {}
            text=payload.get("text", "")
            source=payload.get("source","")
            if text:
                contexts.append(text)
            if source:
                sources.add(source)
        return {"contexts":contexts,"sources":list(sources)}

