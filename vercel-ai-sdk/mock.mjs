import { VulnifyBlockedError } from '@vulnify/sdk';

/** Demo policy used when no API key is set. guardAiSdkTools calls guard() and reads VulnifyBlockedError. */
export function outcomeFor(action) {
  const records = Number(action.recordsAffected || 0);
  const resource = String(action.resource || '');
  if (action.action === 'DELETE_DATA' && resource.toLowerCase().includes('production')) {
    return { decision: 'BLOCK', reasons: ['Delete operation', 'Production database'] };
  }
  if (action.action === 'EXPORT_DATA' && action.destination === 'EXTERNAL_EMAIL' && records >= 100) {
    return {
      decision: 'REVIEW',
      reasons: ['Export operation', 'External destination', `Large data volume (${records} records)`],
    };
  }
  if (action.action === 'READ_DATA') return { decision: 'ALLOW', reasons: ['Read operation'] };
  return { decision: 'ALLOW', reasons: ['Allowed by the demo policy'] };
}

export function mockVulnify() {
  const seen = [];
  return {
    seen,
    async guard(action, fn) {
      seen.push(action);
      const outcome = outcomeFor(action);
      if (outcome.decision === 'ALLOW') return fn();
      throw new VulnifyBlockedError({
        id: `evt-mock-${outcome.decision.toLowerCase()}`,
        decision: outcome.decision,
        finalDecision: outcome.decision,
        reasons: outcome.reasons,
      });
    },
  };
}
