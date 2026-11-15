/**
 * Tiny backend with no dependencies:
 *   POST /api/generate  -> calls the LLM (API key stays here, never in the browser)
 *   GET  /api/health    -> tells the UI whether we're in mock mode
 *   everything else     -> serves the built React app from /dist
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { callLLM, llmConfig, UpstreamError } from './llm.js';
import { buildGenerateMessages, buildRefineMessages } from './prompt.js';
import { buildMockSet, simulate, SIMULATIONS } from './mock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const DIST = path.join(ROOT, 'dist');
const MAX_BODY_BYTES = 100_000;
const MAX_NOTES_CHARS = 15_000;
const MAX_INSTRUCTION_CHARS = 500;

// ---------- helpers ----------

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code, message, retryable = false) {
  sendJson(res, status, { error: { code, message, retryable } });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new UpstreamError('too-large', 'Request is too large.', 413, false));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new UpstreamError('bad-json', 'Request body must be JSON.', 400, false));
      }
    });
    req.on('error', reject);
  });
}

const clamp = (n, lo, hi, fallback) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : fallback);

// Very small per-IP rate limit so a stuck retry loop can't burn the free tier.
const hits = new Map();
function rateLimited(ip, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > limit;
}

// ---------- /api/generate ----------

async function handleGenerate(req, res) {
  if (rateLimited(req.socket.remoteAddress)) {
    return sendError(res, 429, 'rate-limited', 'Too many requests. Wait a minute and try again.', true);
  }

  const body = await readJsonBody(req);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length < 3) return sendError(res, 400, 'notes-too-short', 'Enter some notes or a topic first.');
  if (notes.length > MAX_NOTES_CHARS) {
    return sendError(res, 400, 'notes-too-long', `Notes are limited to ${MAX_NOTES_CHARS.toLocaleString()} characters.`);
  }

  const cardCount = clamp(body.cardCount, 3, 20, 8);
  const quizCount = clamp(body.quizCount, 2, 15, 5);
  const sim = SIMULATIONS.includes(body.simulate) ? body.simulate : 'none';

  let refine = null;
  if (body.refine) {
    const instruction = typeof body.refine.instruction === 'string' ? body.refine.instruction.trim() : '';
    if (!instruction) return sendError(res, 400, 'no-instruction', 'Describe what to change.');
    if (instruction.length > MAX_INSTRUCTION_CHARS) return sendError(res, 400, 'instruction-too-long', 'That change request is too long.');
    if (!body.refine.current || typeof body.refine.current !== 'object') {
      return sendError(res, 400, 'no-current-set', 'Nothing to refine yet.');
    }
    refine = { instruction, current: body.refine.current };
  }

  // Abort the upstream call if the browser goes away (user cancelled or sent a newer request).
  const clientGone = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) clientGone.abort();
  });

  const mockMode = !llmConfig().apiKey;
  let result;
  if (mockMode || sim !== 'none') {
    const base = refine
      ? { ...refine.current, cards: [...(refine.current.cards || []), { front: 'Refinement request', back: refine.instruction }] }
      : buildMockSet(notes, cardCount, quizCount);
    result = await simulate(sim, base, { signal: clientGone.signal });
  } else {
    const messages = refine
      ? buildRefineMessages({ notes, current: refine.current, instruction: refine.instruction })
      : buildGenerateMessages({ notes, cardCount, quizCount });
    result = await callLLM(messages, { signal: clientGone.signal });
  }

  sendJson(res, 200, {
    content: result.content,
    finishReason: result.finishReason ?? null,
    mock: mockMode || sim !== 'none',
  });
}

// ---------- static files ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('No build found. Run `npm start` (which builds first) or `npm run dev`.');
  }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let filePath = path.normalize(path.join(DIST, urlPath));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html'); // SPA fallback
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      if (req.url === '/api/health' && req.method === 'GET') {
        const { model } = llmConfig();
        return sendJson(res, 200, { ok: true, mock: !llmConfig().apiKey, model, simulations: SIMULATIONS });
      }
      if (req.url === '/api/generate' && req.method === 'POST') return await handleGenerate(req, res);
      return sendError(res, 404, 'not-found', 'Unknown API route.');
    }
    return serveStatic(req, res);
  } catch (err) {
    if (res.headersSent) return res.end();
    if (err instanceof UpstreamError) {
      if (err.code === 'client-closed') return res.end();
      return sendError(res, err.status, err.code, err.message, err.retryable);
    }
    console.error('[server] unexpected error', err);
    return sendError(res, 500, 'internal', 'Something went wrong on the server.', true);
  }
});

server.listen(PORT, () => {
  const { model, baseUrl, apiKey } = llmConfig();
  console.log(`\n  Study assistant running at http://localhost:${PORT}`);
  console.log(apiKey ? `  Model: ${model} via ${baseUrl}\n` : '  No LLM_API_KEY set: running in MOCK mode (see .env.example)\n');
});
