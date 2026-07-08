// Shared minimal Anthropic Messages API caller — plain fetch, no SDK.
// Used by score-core.js (Haiku) and tailor-core.js (Sonnet).

export async function callAnthropic({ model, prompt, maxTokens = 400, thinking, fetchImpl = fetch }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  // Models with thinking on by default (e.g. claude-sonnet-5) can burn the
  // whole max_tokens budget inside a thinking block and return zero text —
  // strict-JSON callers must pass { type: 'disabled' }.
  if (thinking) body.thinking = thinking;
  const resp = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${data.error?.message || 'error'}`);
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return {
    text,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

export function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON object in response');
  return JSON.parse(m[0]);
}
