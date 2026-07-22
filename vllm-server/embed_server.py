#!/usr/bin/env python3
"""
embed_server.py — Minimal OpenAI-compatible EMBEDDING server (runs on CPU).

Why CPU? Your H100 is already full with the Qwen2.5-VL-32B chat model, so there
is no room for an embedding model on the GPU. Embeddings are small and run fine
on CPU. This lets the calorie app do SEMANTIC RAG without touching the GPU.

Endpoints (OpenAI-compatible — works with the app's `openai` client):
  GET  /health
  GET  /v1/models
  POST /v1/embeddings   body: {"input": "text"|["t1","t2"], "model": "bge-m3",
                               "encoding_format": "float"|"base64"}

IMPORTANT (relates to the "resp.data is not iterable" fix in the app):
  The app pins `encoding_format:"float"` on every request, so this server can
  simply return float arrays. We ALSO honor `encoding_format:"base64"` here so
  ANY OpenAI-compatible client works against this server without surprises.

Env:
  EMBED_MODEL        HF model id        (default BAAI/bge-m3, 1024-dim, multilingual incl. Vietnamese)
  EMBED_SERVED_NAME  name the app sends (default bge-m3 -> set EMBEDDING_MODEL=bge-m3 in the app)
  EMBED_API_KEY      optional bearer token ("" = no auth)
  EMBED_PORT         port               (default 3333)
"""
import base64
import os
import struct
import time
from typing import List, Optional, Union

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
_DIM = _model.get_sentence_embedding_dimension()
print(f"[embed] ready. model={SERVED} dim={_DIM}", flush=True)

app = FastAPI()


class EmbeddingRequest(BaseModel):
    input: Union[str, List[str]]
    model: str = SERVED
    # Accept (and honor) encoding_format so every OpenAI-compatible client works.
    encoding_format: Optional[str] = "float"


def _check_auth(authorization: str):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="invalid api key")


def _to_base64(vec: List[float]) -> str:
    # little-endian float32, exactly what the OpenAI client decodes.
    return base64.b64encode(struct.pack(f"<{len(vec)}f", *vec)).decode("ascii")


@app.get("/health")
def health():
    return {"status": "ok", "model": SERVED, "dim": _DIM}


@app.get("/v1/models")
def list_models(authorization: str = Header(default="")):
    _check_auth(authorization)
    return {"object": "list", "data": [{"id": SERVED, "object": "model", "owned_by": "local"}]}


@app.post("/v1/embeddings")
def create_embeddings(req: EmbeddingRequest, authorization: str = Header(default="")):
    _check_auth(authorization)
    t0 = time.time()
    texts = req.input if isinstance(req.input, list) else [req.input]
    vectors = _model.encode(texts, normalize_embeddings=True, batch_size=16).tolist()
    as_b64 = (req.encoding_format or "float").lower() == "base64"
    data = [
        {"object": "embedding", "index": i, "embedding": (_to_base64(v) if as_b64 else v)}
        for i, v in enumerate(vectors)
    ]
    print(
        f"[embed] {len(texts)} text(s) → {len(data)} vec(s) dim={len(vectors[0]) if vectors else 0} "
        f"fmt={'base64' if as_b64 else 'float'} {int((time.time()-t0)*1000)}ms",
        flush=True,
    )
    return {
        "object": "list",
        "data": data,
        "model": SERVED,
        "usage": {"prompt_tokens": 0, "total_tokens": 0},
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
