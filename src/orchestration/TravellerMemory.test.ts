import { describe, expect, it } from 'vitest';
import { validateMemoryCandidates, relevantMemories, type TravellerMemoryFact } from './TravellerMemory.js';
import { InMemoryTravellerMemoryRepository } from '../storage/travellerMemoryRepository.js';
import { ContextBuilder, modelContext } from './ContextBuilder.js';
import { buildMemoryConfirmationPrompt, handleTravellerMemoryConsent } from '../routes/webhook.js';
import { supportedMemoryCandidates } from './MutationAuthority.js';

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

  it('stages every fact pending exact permission and is idempotent', async () => {
    const repository = new InMemoryTravellerMemoryRepository();
    const candidates = validateMemoryCandidates([
      { key: 'occasion', value: "wife's birthday", scope: 'trip', confidence: .98, explicit: true },
      { key: 'allergy', value: 'shellfish', scope: 'trip', confidence: .99, explicit: true },
    ]);
    await repository.saveCandidates(inbound.from, inbound.messageId, candidates);
    await repository.saveCandidates(inbound.from, inbound.messageId, candidates);
    let facts = await repository.findForContext(inbound.from, ['trip:current']);
    expect(facts).toHaveLength(2);
    expect(facts.find((fact) => fact.key === 'occasion')?.status).toBe('proposed');
    expect(facts.find((fact) => fact.key === 'allergy')?.status).toBe('proposed');
    expect(await repository.confirmPending(inbound.from)).toBe(0);
    expect(await repository.confirmPending(inbound.from, 'allergy', 'shellfish')).toBe(1);
    facts = await repository.findForContext(inbound.from, ['trip:current']);
    expect(facts.find((fact) => fact.key === 'allergy')?.status).toBe('confirmed');
    expect(facts.find((fact) => fact.key === 'occasion')?.status).toBe('proposed');
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
        expect.objectContaining({ key: 'occasion', value: 'birthday', scope: 'trip',
          source: 'confirmed_traveller_memory', updatedAt: base.updatedAt }),
        expect.objectContaining({ key: 'dietary_requirement', value: 'vegan', scope: 'trip',
          source: 'confirmed_traveller_memory', updatedAt: base.updatedAt }),
      ],
      pendingConfirmations: [expect.objectContaining({ key: 'allergy', value: 'shellfish', scope: 'trip',
        source: 'pending_traveller_memory', updatedAt: base.updatedAt })],
    });
  });

  it('renders consent and activates sensitive context only after an explicit reply', async () => {
    const repository = new InMemoryTravellerMemoryRepository();
    const candidates = validateMemoryCandidates([
      { key: 'allergy', value: 'shellfish', scope: 'trip', confidence: .99, explicit: true },
    ]);
    await repository.saveCandidates(inbound.from, inbound.messageId, candidates);
    expect(buildMemoryConfirmationPrompt(candidates)).toContain('Reply “remember it” or “not now”');
    expect(await handleTravellerMemoryConsent(inbound.from, 'remember it', repository)).toContain('I’ll remember');
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

  it('does not promote event details or replace confirmed profile memory before exact consent', async () => {
    const repository = new InMemoryTravellerMemoryRepository();
    const candidate = (value: string) => ({ key: 'preference' as const, value, scope: 'profile' as const,
      confidence: .99, explicit: true });
    await repository.saveCandidates(inbound.from, 'old', [candidate('beach hotels')]);
    await repository.confirmPending(inbound.from, 'preference', 'beach hotels');
    await repository.saveCandidates(inbound.from, 'new', [candidate('quiet hotels')]);
    let facts = await repository.findForContext(inbound.from);
    expect(facts.find((fact) => fact.value === 'beach hotels')?.status).toBe('confirmed');
    expect(facts.find((fact) => fact.value === 'quiet hotels')?.status).toBe('proposed');
    expect(await handleTravellerMemoryConsent(inbound.from, 'yes', repository)).toBeNull();
    expect(await handleTravellerMemoryConsent(inbound.from, 'confirm booking', repository)).toBeNull();
    expect(await handleTravellerMemoryConsent(inbound.from, 'pay now', repository)).toBeNull();
    expect(await handleTravellerMemoryConsent(inbound.from, 'remember it', repository)).not.toBeNull();
    facts = await repository.findForContext(inbound.from);
    expect(facts.find((fact) => fact.value === 'quiet hotels')?.status).toBe('confirmed');
    expect(facts.find((fact) => fact.value === 'beach hotels')?.status).toBe('superseded');
  });

  it('requires positive meaning and traveller ownership before staging preferences', () => {
    const candidate = { key: 'preference' as const, value: 'quiet hotels', scope: 'profile' as const,
      confidence: .99, explicit: true };
    for (const message of ['I dislike quiet hotels', 'I might like quiet hotels', 'I visited quiet hotels',
      'My wife likes quiet hotels', 'I want quiet hotels for my daughter'])
      expect(supportedMemoryCandidates([candidate], message), message).toEqual([]);
    expect(supportedMemoryCandidates([candidate], 'I prefer quiet hotels')).toHaveLength(1);
    expect(supportedMemoryCandidates([candidate], 'I prefer quiet hotels and my wife likes a pool')).toHaveLength(1);
    const dislike = { ...candidate, key: 'dislike' as const };
    expect(supportedMemoryCandidates([dislike], 'I dislike quiet hotels')).toHaveLength(1);
    expect(supportedMemoryCandidates([dislike], "I don't dislike quiet hotels")).toEqual([]);
  });

  it('requires an exact choice when several memories await permission', async () => {
    const repository = new InMemoryTravellerMemoryRepository();
    const candidates = [
      { key: 'preference' as const, value: 'beach hotels', scope: 'profile' as const,
        confidence: .99, explicit: true },
      { key: 'dietary_requirement' as const, value: 'vegetarian', scope: 'profile' as const,
        confidence: .99, explicit: true },
    ];
    await repository.saveCandidates(inbound.from, 'multi', candidates);
    expect(await handleTravellerMemoryConsent(inbound.from, 'remember it', repository)).toContain('choose one exact item');
    expect(await handleTravellerMemoryConsent(inbound.from, 'remember preference: beach hotels', repository))
      .toContain('I’ll remember');
    const facts = await repository.findForContext(inbound.from);
    expect(facts.find((fact) => fact.key === 'preference')?.status).toBe('confirmed');
    expect(facts.find((fact) => fact.key === 'dietary_requirement')?.status).toBe('proposed');
  });
});
