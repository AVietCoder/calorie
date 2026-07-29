# Dr.Fit — Best Nutrition, Best Life

AI-powered personalized nutrition platform. Tracks daily intake, generates 7-day meal plans, analyzes meals from photos, and provides intelligent dietary recommendations based on health profiles.

## Tech Stack

- **Frontend**: Next.js 16, React 19, Chart.js
- **Backend**: Node.js serverless (Vercel)
- **Database**: Supabase (PostgreSQL + Auth)
- **LLM and Vision**: Qwen3-VL 32B via vLLM (OpenAI-compatible API)
- **Storage**: Cloudinary, Supabase Storage

## Key Features

1. **Health Profile Setup** — BMR/TDEE/macro calculation
2. **AI Meal Planner** — Dynamic 7-day meal plans with rebalancing
3. **Food Analysis** — Text/photo input → nutrition extraction (deterministic engine)
4. **AI Coach** — Contextual Q&A with multi-language support
5. **Knowledge Base (RAG)** — Disease-specific guidelines via PostgreSQL FTS (no embeddings needed)
6. **Food Diary** — Track meals with photos and history
7. **Admin Dashboard** — Upload medical PDFs to knowledge base

## Architecture

Key design choices:

- **Deterministic nutrition engine** — LLM recognizes dish, engine calculates numbers (USDA → OpenFoodFacts → reference tables → AI fallback)
- **No embeddings RAG** — PostgreSQL Full Text Search for exact, verifiable retrieval
- **Hybrid LLM routing** — Dialog queries go direct to vLLM (fast), data mutations via backend (consistent)

## Authors

**Author:** Vũ Trí Việt (Le Hong Phong High School for the Gifted)  

**Co-author:** Hồng Tú Quỳnh (Tran Dai Nghia High School for the Gifted)
