import { SessionRepository } from '../../db/repositories/SessionRepository.js';
import { getHotelSearchSessionService, type HotelSearchSessionService } from '../hotelSearchSessionService.js';
import type { HandoffSessionControl } from './NearBookingHandoffService.js';

/** Bridges durable UUID sessions to the phone-scoped hotel session without weakening FK integrity. */
export class HotelSearchHandoffSessionControl implements HandoffSessionControl {
  constructor(
    private readonly sessions = new SessionRepository(),
    private readonly hotelSessions: Pick<HotelSearchSessionService, 'markHandedOff' | 'clearHandedOff'> =
      getHotelSearchSessionService()
  ) {}

  async markHandedOff(sessionId: string, handoffId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new Error('Durable session unavailable for handoff lock');
    await this.hotelSessions.markHandedOff(`whatsapp:${session.phoneNumber}`, handoffId);
  }

  async clearHandedOff(sessionId: string, handoffId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) return;
    await this.hotelSessions.clearHandedOff(`whatsapp:${session.phoneNumber}`, handoffId);
  }
}
