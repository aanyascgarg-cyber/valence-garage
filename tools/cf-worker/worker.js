/**
 * Valence Garage AI proxy — Cloudflare Worker.
 *
 * Holds the Gemini API key as a server-side SECRET so app users get
 * frontier AI with zero setup and the key never ships to a browser
 * or a public repository.
 *
 * Security posture:
 *   - CORS + Origin allowlist: only the live app and localhost dev.
 *   - Model allowlist: gemini-flash-latest only.
 *   - Output cap: maxOutputTokens clamped to 900.
 *   - Body cap: requests over 1.5 MB rejected (photos arrive ~200 KB).
 *   - Streaming SSE passthrough, same shape the app already parses.
 *
 * Deploy (dashboard path, no local tooling needed):
 *   Workers & Pages -> Create Worker -> paste this file -> Deploy.
 *   Settings -> Variables & Secrets -> add GEMINI_KEY (type: secret).
 * Then set PROXY_URL in js/aiengine.js to the worker URL.
 */

const ALLOWED_ORIGINS = [
  'https://aanyascgarg-cyber.github.io',
  'http://localhost:8317',
];

const MODEL = 'gemini-flash-latest';
const UPSTREAM =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}` +
  `:streamGenerateContent?alt=sse`;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: allowed ? corsHeaders(origin) : {},
      });
    }

    if (!allowed) {
      return new Response('origin not allowed', { status: 403 });
    }
    if (request.method !== 'POST') {
      return new Response('POST only', {
        status: 405, headers: corsHeaders(origin),
      });
    }

    const len = Number(request.headers.get('Content-Length') || '0');
    if (len > 1_500_000) {
      return new Response('payload too large', {
        status: 413, headers: corsHeaders(origin),
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('bad json', {
        status: 400, headers: corsHeaders(origin),
      });
    }

    // Rebuild the upstream body ourselves: only fields we bless survive.
    const parts = Array.isArray(body?.parts) ? body.parts.slice(0, 4) : null;
    if (!parts || parts.length === 0) {
      return new Response('parts required', {
        status: 400, headers: corsHeaders(origin),
      });
    }

    const upstreamBody = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: Math.min(900, body?.maxOutputTokens || 900),
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const upstream = await fetch(`${UPSTREAM}&key=${env.GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upstreamBody),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': upstream.headers.get('Content-Type') ||
          'text/event-stream',
      },
    });
  },
};
