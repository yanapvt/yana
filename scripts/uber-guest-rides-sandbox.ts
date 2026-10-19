import 'dotenv/config';
import { GuestRidesSandboxClient } from '../src/services/uber/GuestRidesSandboxClient.js';

const required = ['UBER_GUEST_CLIENT_ID', 'UBER_GUEST_CLIENT_SECRET', 'UBER_GUEST_ORGANIZATION_UUID'] as const;
const missing = required.filter((key) => !process.env[key]?.trim());

if (missing.length > 0) {
  console.error(`Uber Guest Rides sandbox is not configured. Missing: ${missing.join(', ')}.`);
  console.error('Add approved Uber for Business Guest Rides credentials to the local .env file, then rerun this command.');
  process.exitCode = 1;
} else {
  try {
    const result = await new GuestRidesSandboxClient().check({
      clientId: process.env.UBER_GUEST_CLIENT_ID!,
      clientSecret: process.env.UBER_GUEST_CLIENT_SECRET!,
      organizationUuid: process.env.UBER_GUEST_ORGANIZATION_UUID!,
    });
    console.log(`Uber Guest Rides sandbox connected. Run created: ${result.runId}; products returned: ${result.products}.`);
    console.log('This is a simulated sandbox run. No customer ride was booked.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Uber sandbox check failed.');
    process.exitCode = 1;
  }
}
