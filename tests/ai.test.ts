import { describe, expect, it, vi } from 'vitest';
import {
  HostelLlmClient,
  parseRoomQueryOffline,
  ProviderError,
} from '../lib/ai/llmClient.ts';
import { retrieveMatchingRuleSections } from '../lib/ai/rulesRetriever.ts';

describe('AI Client, Fallback Chain, Caching & Grounded Rules', () => {
  it('parses valid structured JSON from Gemini and caches normalized queries', async () => {
    const geminiMock = vi.fn(async () =>
      JSON.stringify({
        block: 'Nilgiri Bhavan',
        floor_min: 3,
        floor_max: 4,
        ac: true,
        tags: ['quiet', 'near_mess'],
        capacity: 2,
      })
    );

    const client = new HostelLlmClient({ geminiInvoker: geminiMock });
    const first = await client.parseNaturalLanguageRoomSearch(
      'Quiet AC double room on a high floor near the mess in Nilgiri'
    );
    expect(first.provider).toBe('gemini');
    expect(first.cached).toBe(false);
    expect(first.filter.ac).toBe(true);
    expect(first.filter.tags).toEqual(['quiet', 'near_mess']);

    // Same query with different spacing/casing hits normalized cache
    const second = await client.parseNaturalLanguageRoomSearch(
      '  quiet ac double room on a high floor near the mess in nilgiri  '
    );
    expect(second.cached).toBe(true);
    expect(geminiMock).toHaveBeenCalledTimes(1);
  });

  it('retries once when the model returns invalid JSON and succeeds on second attempt', async () => {
    let calls = 0;
    const flakyGemini = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return 'not valid json {{{';
      }
      return JSON.stringify({
        block: null,
        floor_min: 1,
        floor_max: 2,
        ac: false,
        tags: ['balcony'],
        capacity: null,
      });
    });

    const client = new HostelLlmClient({ geminiInvoker: flakyGemini });
    const result = await client.parseNaturalLanguageRoomSearch('Low floor non-ac balcony room');

    expect(flakyGemini).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe('gemini');
    expect(result.filter.ac).toBe(false);
    expect(result.filter.tags).toContain('balcony');
  });

  it('falls back to Groq automatically on HTTP 429 from Gemini', async () => {
    const gemini429 = vi.fn(async () => {
      throw new ProviderError('Rate limited', 429);
    });
    const groqOk = vi.fn(async () =>
      JSON.stringify({
        block: 'Kaveri Bhavan',
        floor_min: 2,
        floor_max: 2,
        ac: true,
        tags: ['near_mess'],
        capacity: 2,
      })
    );

    const client = new HostelLlmClient({
      geminiInvoker: gemini429,
      groqInvoker: groqOk,
    });
    const res = await client.parseNaturalLanguageRoomSearch('2nd floor AC in Kaveri near mess');

    expect(res.provider).toBe('groq');
    expect(res.filter.block).toBe('Kaveri Bhavan');
    expect(client.getStatus().provider).toBe('groq');
  });

  it('falls back to Groq on Gemini timeout and finally offline keyword parser if both fail', async () => {
    const slowGemini = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('{}'), 500))
    );
    const brokenGroq = vi.fn(async () => {
      throw new ProviderError('Groq unavailable', 503);
    });

    const client = new HostelLlmClient({
      timeoutMs: 40,
      geminiInvoker: slowGemini,
      groqInvoker: brokenGroq,
    });

    const res = await client.parseNaturalLanguageRoomSearch(
      'Quiet room on a high floor near the mess with AC'
    );

    expect(res.provider).toBe('offline');
    expect(res.filter.ac).toBe(true);
    expect(res.filter.floor_min).toBe(3);
    expect(res.filter.tags).toContain('quiet');
    expect(res.filter.tags).toContain('near_mess');
    expect(client.getStatus().provider).toBe('offline');
  });

  it('parses offline keywords accurately without external AI', () => {
    const parsed = parseRoomQueryOffline('Single non-AC corner room on 4th floor in Narmada');
    expect(parsed.block).toBe('Narmada Bhavan');
    expect(parsed.floor_min).toBe(4);
    expect(parsed.floor_max).toBe(4);
    expect(parsed.ac).toBe(false);
    expect(parsed.capacity).toBe(1);
    expect(parsed.tags).toContain('corner');
  });

  it('answers supported rules from rules.md and refuses unsupported policies', async () => {
    const messMatches = retrieveMatchingRuleSections('What are the breakfast and dinner mess timings?');
    expect(messMatches.length).toBeGreaterThan(0);
    expect(messMatches[0].heading.toLowerCase()).toContain('mess');

    const unsupported = retrieveMatchingRuleSections('Can I park a helicopter on the hostel roof?');
    expect(unsupported).toHaveLength(0);

    const client = new HostelLlmClient({ geminiApiKey: '', groqApiKey: '' });
    const unknownReply = await client.answerGroundedPolicyQuestion({
      question: 'Can I park a helicopter on the hostel roof?',
      matchedExcerpts: unsupported,
    });
    expect(unknownReply.grounded).toBe(false);
    expect(unknownReply.answer).toBe("I don't know the exact rule. Please contact the warden.");
  });
});
