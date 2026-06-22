import pydantic

class ragChunkAndSrc(pydantic.BaseModel):
    chunks:list[str]
    source_id:str=None

class ragUpsertresult(pydantic.BaseModel):
    ingested:int

class ragSearchresult(pydantic.BaseModel):
    context:list[str]
    sources:list[str]

class ragQueryAndresult(pydantic.BaseModel):
    answer:str
    sources:list[str]
    num_contexts:int
