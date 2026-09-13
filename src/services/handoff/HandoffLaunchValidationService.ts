export type LaunchScenario = 'consent_gate'|'case_creation'|'agent_assignment'|'safe_closure'|'multi_instance_session'|'key_rotation'|'session_revocation'|'queue_retry'|'dead_letter_recovery'|'provider_outage_recovery'|'load';
export interface LaunchValidationHarness { run(scenario: LaunchScenario, syntheticMarker: string): Promise<{ passed: boolean; externalEffects: number }> }
export interface LaunchValidationReport { status: 'planned'|'passed'|'failed'; evidence: 'simulated'; results: { scenario: LaunchScenario; passed: boolean }[]; bookingAttempted: false; paymentAttempted: false; travelerContactAttempted: false; }

export class HandoffLaunchValidationService {
  static readonly scenarios: LaunchScenario[] = ['consent_gate','case_creation','agent_assignment','safe_closure','multi_instance_session','key_rotation','session_revocation','queue_retry','dead_letter_recovery','provider_outage_recovery','load'];
  constructor(private readonly harness: LaunchValidationHarness) {}
  plan(): LaunchValidationReport { return this.report('planned', HandoffLaunchValidationService.scenarios.map(scenario => ({ scenario, passed: false }))); }
  async run(guard: { enabled: boolean; environment: string; confirm?: string }): Promise<LaunchValidationReport> {
    if (!guard.enabled || guard.environment !== 'staging' || guard.confirm !== 'MR14_SYNTHETIC_ONLY') throw new Error('Launch validation safety guard rejected execution');
    const results: LaunchValidationReport['results'] = [];
    for (const scenario of HandoffLaunchValidationService.scenarios) {
      try {
        const outcome = await this.harness.run(scenario, 'synthetic-mr14');
        results.push({ scenario, passed: outcome.passed && outcome.externalEffects === 0 });
      } catch { results.push({ scenario, passed: false }); }
    }
    return this.report(results.every(result => result.passed) ? 'passed' : 'failed', results);
  }
  private report(status: LaunchValidationReport['status'], results: LaunchValidationReport['results']): LaunchValidationReport {
    return { status, evidence: 'simulated', results, bookingAttempted: false, paymentAttempted: false, travelerContactAttempted: false };
  }
}
