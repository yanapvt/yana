import { describe, expect, it, vi } from 'vitest';
import { HotelSearchHandoffSessionControl } from './HotelSearchHandoffSessionControl.js';

describe('HotelSearchHandoffSessionControl', () => {
  it('maps a durable UUID session to its phone-scoped hotel state', async () => {
    const sessions = { findById: vi.fn().mockResolvedValue({ phoneNumber: '+94770000000' }) };
    const hotelSessions = { markHandedOff: vi.fn(), clearHandedOff: vi.fn() };
    const control = new HotelSearchHandoffSessionControl(sessions as any, hotelSessions as any);
    await control.markHandedOff('session-uuid', 'handoff-uuid');
    await control.clearHandedOff('session-uuid', 'handoff-uuid');
    expect(hotelSessions.markHandedOff).toHaveBeenCalledWith('whatsapp:+94770000000', 'handoff-uuid');
    expect(hotelSessions.clearHandedOff).toHaveBeenCalledWith('whatsapp:+94770000000', 'handoff-uuid');
  });
});
