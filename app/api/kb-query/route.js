/**
 * app/api/kb-query/route.js — replaces api/kb-query.js. Same STRICT
 * Knowledge-Base question answering (Full Text Search only, no embeddings).
 */
import { NextResponse } from 'next/server';
import { authenticateToken } from '../../../lib/auth-middleware.js';
import { answerFromKnowledgeBase } from '../../../lib/rag/kb-answer.js';
import { adminStoreReady, countAdminChunks, countAdminPdfs, searchAdminChunks } from '../../../lib/rag/store.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 30;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function GET(request) {
  const user = await authenticateToken(request);
  if (!user) return corsJson(NextResponse, { success: false, error: 'Unauthorized' }, { status: 401 });

  const action = new URL(request.url).searchParams.get('action')?.toLowerCase() || '';

  if (action === 'ping') {
    try {
      await searchAdminChunks('test', 1);
      return corsJson(NextResponse, {
        success: true,
        ping: { ok: true, engine: 'postgres-fulltext-search (tsvector + GIN + ts_rank)' },
      });
    } catch (err) {
      return corsJson(
        NextResponse,
        { success: false, ping: { ok: false, error: err.message, hint: 'Run migrations/fulltext_search.sql on Supabase.' } },
        { status: 502 }
      );
    }
  }

  if (action === 'status') {
    const ready = await adminStoreReady();
    return corsJson(NextResponse, {
      success: true,
      store: { ready, pdfs: ready ? await countAdminPdfs() : 0, chunks: ready ? await countAdminChunks() : 0 },
      search: { engine: 'postgres-fulltext-search', index: 'tsvector + GIN + ts_rank' },
    });
  }

  return corsJson(NextResponse, { success: false, error: 'Unknown GET action. Use ?action=ping or ?action=status.' }, { status: 400 });
}

export async function POST(request) {
  const user = await authenticateToken(request);
  if (!user) return corsJson(NextResponse, { success: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const question = String(body.question || body.q || '').trim();
    const lang = body.lang === 'en' ? 'en' : 'vi';

    if (!question) return corsJson(NextResponse, { success: false, error: "Thiếu 'question'." }, { status: 400 });

    const t0 = Date.now();
    const result = await answerFromKnowledgeBase({ question, lang });
    const took = Date.now() - t0;

    console.log(`📖 [kb-query] user=${user.id} found=${result.found} took=${took}ms mode=${result.mode} rank=${result.confidence.bestRank}`);

    return corsJson(NextResponse, {
      success: true,
      found: result.found,
      answer: result.answer,
      trace: {
        mode: result.mode,
        chunks_used: result.chunks.length,
        confidence: result.confidence,
        search: { engine: 'postgres-fulltext-search', index: 'tsvector + GIN + ts_rank' },
        took_ms: took,
        sources: result.chunks.slice(0, 10).map((c, i) => ({
          n: i + 1,
          section: c.section || null,
          rank: typeof c._rank === 'number' ? Number(c._rank.toFixed(4)) : null,
          preview: String(c.text || '').slice(0, 160),
        })),
      },
    });
  } catch (err) {
    console.error('❌ [kb-query] error:', err.message);
    return corsJson(NextResponse, { success: false, error: 'Lỗi hệ thống khi truy vấn Knowledge Base.', details: err.message }, { status: 500 });
  }
}
