/**
 * A Claude Agent SDK `canUseTool` callback that asks Vulnify before Claude sends an email or deletes files.
 * Tools it does not map fall through to `allow` (use your normal permission mode for those).
 */
const AGENT = process.env.VULNIFY_AGENT || 'support-agent';
const INTERNAL_DOMAIN = process.env.INTERNAL_EMAIL_DOMAIN || 'acme.internal';

/** Map a tool request to a Vulnify action, or null when Vulnify doesn't need to see it. */
export function describe(toolName, input) {
  if (toolName.endsWith('send_email')) {
    const to = String(input.to ?? '');
    return {
      agent: AGENT, action: 'SEND_EMAIL', resource: 'email',
      destination: to.endsWith(`@${INTERNAL_DOMAIN}`) ? 'INTERNAL' : 'EXTERNAL_EMAIL',
      recordsAffected: 1,
      content: `${input.subject ?? ''}\n${input.body ?? ''}`, // scanned for personal data in memory, not stored
    };
  }
  if (toolName === 'Bash' && /(^|[;&|]\s*)rm\s/.test(String(input.command ?? ''))) {
    return { agent: AGENT, action: 'DELETE_DATA', resource: 'local files', destination: 'INTERNAL', recordsAffected: 1 };
  }
  return null;
}

export function vulnifyCanUseTool(vulnify) {
  /** @type {import('@anthropic-ai/claude-agent-sdk').CanUseTool} */
  return async (toolName, input) => {
    const action = describe(toolName, input);
    if (!action) return { behavior: 'allow', updatedInput: input };
    const d = await vulnify.check(action);
    const decision = d.finalDecision ?? d.decision;
    if (decision === 'ALLOW') return { behavior: 'allow', updatedInput: input };
    return { behavior: 'deny', message: `Vulnify ${decision} (event ${d.id}): ${d.reasons.join('; ')}. Do not retry; ask the user.` };
  };
}
