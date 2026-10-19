import { describe, expect, it } from 'vitest';
import { ConversationOpeningService } from './ConversationOpeningService.js';
import type { StateStore } from './StateStore.js';

function createService() {
  const values = new Map<string, unknown>();
  const store = {
    getJson: async (key: string) => values.get(key) ?? null,
    setJson: async (key: string, value: unknown) => { values.set(key, value); },
  } as StateStore;
  return new ConversationOpeningService(store);
}

describe('ConversationOpeningService', () => {
  it('asks once using the first name from WhatsApp and remembers a different preference', async () => {
    const service = createService();
    expect(await service.getNameState('whatsapp:+15550001111')).toBeNull();
    expect(await service.askAboutName('whatsapp:+15550001111', 'Jeremy McShane')).toBe('Jeremy');
    const state = await service.getNameState('whatsapp:+15550001111');
    expect(state).toMatchObject({ suggestedName: 'Jeremy', awaitingReply: true });
    expect(await service.handleNameReply('whatsapp:+15550001111', 'Call me Jay', state!))
      .toBe('Of course, Jay. What can I help you with?');
    expect(await service.getNameState('whatsapp:+15550001111'))
      .toMatchObject({ preferredName: 'Jay', awaitingReply: false });
  });

  it('accepts the suggested name and avoids treating a travel request as a name', async () => {
    const service = createService();
    await service.askAboutName('whatsapp:+15550002222', 'Amina Khan');
    const state = (await service.getNameState('whatsapp:+15550002222'))!;
    expect(await service.handleNameReply('whatsapp:+15550002222', 'Find a hotel in Galle', state)).toBeNull();
    expect(await service.handleNameReply('whatsapp:+15550002222', 'Colombo', state)).toBeNull();
    expect(await service.handleNameReply('whatsapp:+15550002222', 'Yes please', state))
      .toBe('Of course, Amina. What can I help you with?');
  });

  it('asks for an alternative after no and accepts a short answer', async () => {
    const service = createService();
    await service.askAboutName('whatsapp:+15550006666', 'Maya Patel');
    const state = (await service.getNameState('whatsapp:+15550006666'))!;
    expect(await service.handleNameReply('whatsapp:+15550006666', 'No', state))
      .toBe('Of course. What name would you prefer I use?');
    const awaitingAlternative = (await service.getNameState('whatsapp:+15550006666'))!;
    expect(await service.handleNameReply('whatsapp:+15550006666', 'May', awaitingAlternative))
      .toBe('Of course, May. What can I help you with?');
  });

  it('opens the first voice reply in a conversation once', async () => {
    const service = createService();
    expect(await service.shouldOpenVoiceConversation('whatsapp:+15550003333')).toBe(true);
    expect(await service.shouldOpenVoiceConversation('whatsapp:+15550003333')).toBe(false);
    expect(await service.shouldOpenVoiceConversation('whatsapp:+15550004444')).toBe(true);
    await service.markTextActivity('whatsapp:+15550007777');
    expect(await service.shouldOpenVoiceConversation('whatsapp:+15550007777')).toBe(false);
  });

  it('does not use an unsafe display name', async () => {
    const service = createService();
    expect(await service.askAboutName('whatsapp:+15550005555', 'https://example.com')).toBeNull();
    expect(await service.getNameState('whatsapp:+15550005555')).toBeNull();
  });
});
