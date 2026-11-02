import { describe, expect, it } from 'vitest';
import { validateMemoryCandidates, relevantMemories, type TravellerMemoryFact } from './TravellerMemory.js';
import { InMemoryTravellerMemoryRepository } from '../storage/travellerMemoryRepository.js';
import { ContextBuilder, modelContext } from './ContextBuilder.js';
import { buildMemoryConfirmationPrompt, handleTravellerMemoryConsent } from '../routes/webhook.js';

const inbound = { messageId: 'm1', from: '+94700000000', to: 'yana', timestamp: new Date(), type: 'text' as const,
  inputType: 'text' as const, content: { type: 'text' as const, body: 'It is my wife Maya’s birthday and I am allergic to shellfish' } };

describe('typed traveller context', () => {
  it('accepts only explicit, confident, allowlisted facts and forces sensitive confirmation', () => {
    const result = validateMemoryCandidates([
      { key: 'occasion', value: "wife's birthday", scope: 'profile', confidence: .98, explicit: true },
      { key: 'allergy', value: 'shellfish', scope: 'profile', confidence: .99, explicit: true },
      { key: 'preference', value: 'probably adventurous', scope: 'profile', confidence: .99, explicit: false },
      { key: 'private_note', value: 'no', scope: 'profile', confidence: 1, explicit: true },
    ]);
    expect(result).toEqual([
      expect.objectContaining({ key: 'occasion', scope: 'trip', requiresConfirmation: false }),
      expect.objectContaining({ key: 'allergy', scope: 'profile', requiresConfirmation: true }),
    ]);
  });

  it('persists ordinary facts, holds sensitive facts pending, confirms them, and is idempotent', async () => {
    const repository = new InMemoryTravellerMemoryRepository();
    const candidates = validateMemoryCandidates([
      { key: 'occasion', value: "wife's birthday", scope: 'trip', confidence: .98, explicit: true },
      { key: 'allergy', value: 'shellfish', scope: 'trip', confidence: .99, explicit: true },
    ]);
    await repository.saveCandidates(inbound.from, inbound.messageId, candidates);
    await repository.saveCandidates(inbound.from, inbound.messageId, candidates);
    let facts = await repository.findForContext(inbound.from, ['trip:current']);
    expect(facts).toHaveLength(2);
    expect(facts.find((fact) => fact.key === 'occasion')?.status).toBe('confirmed');
    expect(facts.find((fact) => fact.key === 'allergy')?.status).toBe('proposed');
    expect(await repository.confirmPending(inbound.from)).toBe(1);
    facts = await repository.findForContext(inbound.from, ['trip:current']);
    expect(facts.find((fact) => fact.key === 'allergy')?.status).toBe('confirmed');
  });

  it('projects only confirmed, flow-relevant facts and never pending sensitive data', () => {
    const base = { id: 'id', userId: inbound.from, contextId: 'trip:current', scope: 'trip' as const, confidence: .99,
      explicit: true, sensitive: false, sourceMessageId: 'm', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const facts: TravellerMemoryFact[] = [
      { ...base, key: 'occasion', value: 'birthday', status: 'confirmed' },
      { ...base, id: 'id2', key: 'allergy', value: 'shellfish', status: 'proposed', sensitive: true },
      { ...base, id: 'id3', key: 'dietary_requirement', value: 'vegan', status: 'confirmed' },
    ];
    expect(relevantMemories(facts, 'excursion').map((fact) => fact.key)).toEqual(['occasion']);
    const context = new ContextBuilder().build({ inboundMessage: inbound, text: inbound.content.body, profileComplete: true,
      travellerMemories: facts, memoryStatus: 'available', activeSession: { flow: 'restaurant', collectedFields: {}, requiredFields: [], missingFields: [] } });
    expect(modelContext(context).travellerContext).toEqual({
      confirmedFacts: [
        { key: 'occasion', value: 'birthday', scope: 'trip' },
        { key: 'dietary_requirement', value: 'vegan', scope: 'trip' },
      ],
      pendingConfirmations: [{ key: 'allergy', value: 'shellfish', scope: 'trip' }],
    });
  });

  it('renders consent and activates sensitive context only after an explicit reply', async () => {
    const repository = new InMemoryTravellerMemoryRepository();
    const candidates = validateMemoryCandidates([
      { key: 'allergy', value: 'shellfish', scope: 'trip', confidence: .99, explicit: true },
    ]);
    await repository.saveCandidates(inbound.from, inbound.messageId, candidates);
    expect(buildMemoryConfirmationPrompt(candidates)).toContain('Reply “remember it” or “not now”');
    expect(await handleTravellerMemoryConsent(inbound.from, 'remember it', repository)).toContain('Thank you for confirming');
    expect((await repository.findForContext(inbound.from, ['trip:current']))[0]?.status).toBe('confirmed');
  });

  it('rejects pending sensitive context when the traveller replies not now', async () => {
    const repository = new InMemoryTravellerMemoryRepository();
    const candidates = validateMemoryCandidates([
      { key: 'accessibility_need', value: 'step-free access', scope: 'trip', confidence: .99, explicit: true },
    ]);
    await repository.saveCandidates(inbound.from, inbound.messageId, candidates);
    expect(await handleTravellerMemoryConsent(inbound.from, 'not now', repository)).toContain('won’t retain');
    expect((await repository.findForContext(inbound.from, ['trip:current']))[0]?.status).toBe('rejected');
  });
});
