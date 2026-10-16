/**
 * Asks the Vulnify MCP gateway (POST /v1/gateway/mcp) about one tool call. The gateway maps the tool name to an
 * action (send/export/delete/write/read), records the decision and runs nothing. This proxy forwards only on ALLOW.
 */
export function describe(tool, args = {}, env = process.env) {
  const to = typeof args.to === 'string' ? args.to : '';
  const internal = env.INTERNAL_EMAIL_DOMAIN && to.endsWith(`@${env.INTERNAL_EMAIL_DOMAIN}`);
  return {
    tool,
    arguments: args,
    agent: env.VULNIFY_AGENT || 'support-agent',
    resource: env.VULNIFY_RESOURCE || 'customers',
    destination: to.includes('@') && !internal ? 'EXTERNAL_EMAIL' : 'INTERNAL',
    recordsAffected: Number.isFinite(args.count) ? args.count : 1,
  };
}

export async function ask(tool, args, { apiKey = process.env.VULNIFY_API_KEY, baseUrl = 'https://api.vulnify.io', fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${baseUrl}/v1/gateway/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(describe(tool, args)),
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json();
    if (!res.ok) return { allowed: false, decision: 'BLOCK', reasons: [`Vulnify error ${res.status}: ${body.message ?? ''}`] };
    const decision = body.finalDecision ?? body.decision;
    return { allowed: decision === 'ALLOW', decision, eventId: body.id, reasons: body.reasons ?? [] };
  } catch (err) {
    return { allowed: false, decision: 'BLOCK', reasons: [`Vulnify unreachable (${err.message}); failing closed`] };
  }
}
