#!/usr/bin/env python3
"""
embed_server.py — Minimal OpenAI-compatible EMBEDDING server (runs on CPU).

Why CPU? Your H100 is already full with the Qwen2.5-VL-32B chat model, so there
is no room for an embedding model on the GPU. Embeddings are small and run fine
on CPU. This lets the calorie app do SEMANTIC RAG without touching the GPU.

Endpoints (OpenAI-compatible — works with the app's `openai` client):
  GET  /v1/models
  POST /v1/embeddings        body: {"input": "text" | ["t1","t2"], "model": "bge-m3"}

Env:
  EMBED_MODEL        HF model id        (default BAAI/bge-m3, 1024-dim, multilingual incl. Vietnamese)
  EMBED_SERVED_NAME  name the app sends (default bge-m3 -> set EMBEDDING_MODEL=bge-m3 in the app)
  EMBED_API_KEY      optional bearer token ("" = no auth)
  EMBED_PORT         port               (default 3333)
"""
import os
from typing import List, Union

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import uvicorn

MODEL_ID = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
SERVED = os.environ.get("EMBED_SERVED_NAME", "bge-m3")
API_KEY = os.environ.get("EMBED_API_KEY", "")
PORT = int(os.environ.get("EMBED_PORT", "3333"))

print(f"[embed] loading {MODEL_ID} on CPU (first run downloads ~2GB)...", flush=True)
_model = SentenceTransformer(MODEL_ID, device="cpu")
print("[embed] ready.", flush=True)

app = FastAPI()


class EmbeddingRequest(BaseModel):
    input: Union[str, List[str]]
    model: str = SERVED


def _check_auth(authorization: str):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="invalid api key")


@app.get("/v1/models")
def list_models(authorization: str = Header(default="")):
    _check_auth(authorization)
    return {"object": "list", "data": [{"id": SERVED, "object": "model", "owned_by": "local"}]}


@app.post("/v1/embeddings")
def create_embeddings(req: EmbeddingRequest, authorization: str = Header(default="")):
    _check_auth(authorization)
    texts = req.input if isinstance(req.input, list) else [req.input]
    vectors = _model.encode(texts, normalize_embeddings=True, batch_size=16).tolist()
    data = [{"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vectors)]
    return {
        "object": "list",
        "data": data,
        "model": SERVED,
        "usage": {"prompt_tokens": 0, "total_tokens": 0},
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
