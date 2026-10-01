import { HandoffStagingDrillService } from '../src/services/handoff/HandoffStagingDrillService.js';

// Provider hooks are intentionally not embedded. This command emits the exact
// plan until a staging harness is injected by deployment automation.
const unavailableHarness = { verifyMigrations: async()=>{throw new Error('No staging harness configured');}, exercise:async()=>({recovered:false,duplicateDeliveries:0}) };
const drill = new HandoffStagingDrillService(unavailableHarness);
const execute = process.argv.includes('--execute');
if (!execute) console.log(JSON.stringify(drill.plan(), null, 2));
else {
  const report = await drill.run({ enabled:process.env.HUMAN_HANDOFF_STAGING_DRILL_ENABLED==='true', environment:process.env.NODE_ENV??'', confirm:process.env.HUMAN_HANDOFF_STAGING_DRILL_CONFIRM });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode=1;
}
