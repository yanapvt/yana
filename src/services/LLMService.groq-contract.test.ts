import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMService } from './LLMService.js';

const provider = () => new LLMService({ provider: 'groq', apiKey: 'fixture-key',
  model: 'openai/gpt-oss-20b', baseUrl: 'https://api.groq.com/openai/v1' });
const context = { userMessage: 'Find anniversary dining in Colombo',
  pendingQuestion: { text: 'Which area should I search?', expectedAnswerType: 'location' } };
const decision = { contractVersion: '2.0', intent: 'search_restaurants',
  responseText: 'Colombo has some lovely dinner spots. Shall I show you options?',
  parameters: { location: 'Colombo' }, missingFields: [], suggestedAction: 'none', confidence: 0.92 };
const completion = (value: { content?: string | null; tool_calls?: unknown[] }) => ({ ok: true,
  json: async () => ({ choices: [{ message: value }] }),
});

afterEach(() => vi.unstubAllGlobals());

describe('Groq decision transport contract', () => {
  it('disables tools and validates a conversational JSON response locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion({ content: JSON.stringify(decision) }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await provider().decide(context)).responseText).toBe(decision.responseText);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({ model: 'openai/gpt-oss-20b', tool_choice: 'none',
      reasoning_effort: 'low', include_reasoning: false, max_completion_tokens: 2048 });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('response_format');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('validates a contextual clarification against the existing decision contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: JSON.stringify({
      ...decision, responseText: 'Which area in Colombo suits you?', suggestedAction: 'clarify',
      clarificationRequired: true, clarificationQuestion: 'Which area in Colombo suits you?',
    }) })));
    expect(await provider().decide(context)).toMatchObject({ suggestedAction: 'clarify',
      clarificationQuestion: 'Which area in Colombo suits you?' });
  });

  it('accepts a registered search proposal as data for backend validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: JSON.stringify({
      ...decision, suggestedAction: 'execute_tool', recommendedSchema: 'search_restaurants',
      proposedAction: { name: 'search', arguments: { schemaId: 'search_restaurants' } },
    }) })));
    expect(await provider().decide(context)).toMatchObject({ proposedAction: {
      name: 'search', arguments: { schemaId: 'search_restaurants' },
    } });
  });

  it('ignores only redundant candidate fields in action arguments', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: JSON.stringify({
      ...decision, suggestedAction: 'execute_tool', proposedAction: {
        name: 'search', arguments: { location: 'Colombo' },
      },
    }) })));
    expect((await provider().decide(context)).proposedAction).toEqual({ name: 'search', arguments: {} });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: JSON.stringify({
      ...decision, suggestedAction: 'execute_tool', proposedAction: {
        name: 'search', arguments: { location: 'Galle' },
      },
    }) })));
    await expect(provider().decide(context)).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });

  it('uses the authoritative confidence when Groq duplicates it inconsistently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: JSON.stringify({
      ...decision, confidence: 0.9, intentConfidence: 0.8,
    }) })));
    expect(await provider().decide(context)).toMatchObject({ confidence: 0.9, intentConfidence: 0.9 });
  });

  it('discards an unused action payload on a clarification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: JSON.stringify({
      ...decision, parameters: {}, suggestedAction: 'clarify', clarificationRequired: true,
      clarificationQuestion: 'Where would you like to dine?',
      proposedAction: { name: 'search', arguments: { unauthorized: 'not executed' } },
    }) })));
    expect(await provider().decide(context)).toMatchObject({ suggestedAction: 'clarify' });
    expect((await provider().decide(context)).proposedAction).toBeUndefined();
  });
  it('retries one empty Groq decision before any action is authorised', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion({ content: null }))
      .mockResolvedValueOnce(completion({ content: JSON.stringify(decision) }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await provider().decide(context)).intent).toBe('search_restaurants');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an undeclared JSON tool even if a provider returns HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: null,
      tool_calls: [{ type: 'function', function: { name: 'JSON', arguments: '{}' } }],
    })));
    await expect(provider().decide(context)).rejects.toMatchObject({ code: 'INVALID_TOOL_CALL' });
  });

  it('rejects malformed or unauthorised structured decisions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: '{invalid' })));
    await expect(provider().decide(context)).rejects.toMatchObject({ code: 'PARSE_ERROR' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: JSON.stringify({
      ...decision, recommendedSchema: 'unknown_schema',
    }) })));
    await expect(provider().decide(context)).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });

  it('categorises a Groq tool-use 400 and logs only safe diagnostics', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400,
      text: async () => JSON.stringify({ error: { type: 'invalid_request_error', code: 'tool_use_failed',
        message: "attempted to call tool 'JSON' which was not in request.tools",
        failed_generation: 'private traveller content',
      } }),
    }));
    await expect(provider().decide(context)).rejects.toMatchObject({ code: 'PROVIDER_TOOL_USE_FAILED',
      providerDetails: { status: 400, type: 'invalid_request_error', code: 'tool_use_failed',
        safeDetail: 'undeclared JSON tool call' },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private traveller content');
    log.mockRestore();
  });

  it('categorises provider timeout and unavailability without leaking network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('private timeout detail', 'AbortError')));
    await expect(provider().decide(context)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('private network detail')));
    await expect(provider().decide(context)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503,
      text: async () => JSON.stringify({ error: { type: 'server_error', code: 'service_unavailable',
        message: 'internal provider detail' } }),
    }));
    await expect(provider().decide(context)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE',
      retryable: true, providerDetails: { status: 503, type: 'server_error', code: 'service_unavailable' },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('internal provider detail');
    log.mockRestore();
  });
});
