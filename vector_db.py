import os

from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams,Distance,PointStruct


load_dotenv()


class QdrantStorage:
    def __init__(
        self,
        url: str | None = None,
        collection: str | None = None,
        dim: int = 3072,
    ):
        url = url or os.getenv("QDRANT_URL", "http://localhost:6333")
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

