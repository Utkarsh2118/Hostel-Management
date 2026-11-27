import { GoogleGenAI, Type } from '@google/genai';
import {
  AiProviderState,
  AiStatusInfo,
  NaturalLanguageRoomFilter,
  RoomTag,
} from '../types.ts';
import { NaturalLanguageRoomFilterSchema } from '../validation/schemas.ts';

/**
 * Centralized Server-Side AI Client
 * =================================
 * Primary provider: Google Gemini (@google/genai, model: gemini-4-hydrogen)
 * Secondary provider: Groq (OpenAI-compatible endpoint)
 * Final fallback: Deterministic local rule/keyword parser (zero external calls)
 *
 * Safeguards:
 * - Never imported in client code; keys read strictly from server process.env.
 * - Automatic fallback on HTTP 429 or timeout.
 * - Normalized query caching (10 min TTL).
 * - Strict Zod schema validation for structured outputs, retrying once on invalid JSON.
 * - Never sends private student PII; never controls allotment or swap execution.
 */

export interface LlmTextRequest {
  systemInstruction: string;
  userPrompt: string;
  expectJson?: boolean;
  timeoutMs?: number;
}

export interface LlmTextResponse {
  text: string;
  provider: AiProviderState;
}

export type ProviderInvoker = (req: LlmTextRequest) => Promise<string>;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isTimeout = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function normalizeQueryKey(prefix: string, input: string): string {
  return `${prefix}::${input.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ProviderError(`AI provider request timed out after ${timeoutMs}ms`, 408, true));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractStatusCode(err: unknown): number | undefined {
  if (err instanceof ProviderError) return err.statusCode;
  if (typeof err === 'object' && err !== null) {
    const record = err as Record<string, unknown>;
    if (typeof record.status === 'number') return record.status;
    if (typeof record.statusCode === 'number') return record.statusCode;
    if (typeof record.message === 'string' && record.message.includes('429')) {
      return 429;
    }
  }
  return undefined;
}

/**
 * Deterministic keyword fallback for natural-language room search when AI providers
 * are unconfigured, rate-limited, or timed out.
 */
export function parseRoomQueryOffline(query: string): NaturalLanguageRoomFilter {
  const q = query.toLowerCase();

  let block: string | null = null;
  if (q.includes('nilgiri') || /\bnb\b/.test(q)) block = 'Nilgiri Bhavan';
  else if (q.includes('vindhya') || /\bvb\b/.test(q)) block = 'Vindhya Bhavan';
  else if (q.includes('kaveri') || /\bkb\b/.test(q)) block = 'Kaveri Bhavan';
  else if (q.includes('narmada') || /\bnm\b/.test(q)) block = 'Narmada Bhavan';

  let floor_min: number | null = null;
  let floor_max: number | null = null;

  const explicitFloor = q.match(/floor\s*(\d)|(\d)(?:st|nd|rd|th)\s*floor/);
  if (explicitFloor) {
    const f = Number(explicitFloor[1] ?? explicitFloor[2]);
    if (f >= 1 && f <= 4) {
      floor_min = f;
      floor_max = f;
    }
  } else if (q.includes('high floor') || q.includes('top floor') || q.includes('upper floor')) {
    floor_min = 3;
    floor_max = 4;
  } else if (q.includes('low floor') || q.includes('lower floor') || q.includes('ground')) {
    floor_min = 1;
    floor_max = 2;
  }

  let ac: boolean | null = null;
  if (q.includes('non-ac') || q.includes('non ac') || q.includes('without ac') || q.includes('no ac')) {
    ac = false;
  } else if (/\bac\b/.test(q) || q.includes('air condition')) {
    ac = true;
  }

  const tags: RoomTag[] = [];
  if (q.includes('quiet') || q.includes('silent') || q.includes('peaceful')) tags.push('quiet');
  if (q.includes('mess') || q.includes('dining') || q.includes('canteen')) tags.push('near_mess');
  if (q.includes('stair')) tags.push('near_stairs');
  if (q.includes('corner')) tags.push('corner');
  if (q.includes('balcony') || q.includes('view')) tags.push('balcony');

  let capacity: number | null = null;
  if (q.includes('single') || q.includes('1-seater') || q.includes('1 seater') || q.includes('solo')) {
    capacity = 1;
  } else if (q.includes('double') || q.includes('2-seater') || q.includes('2 seater') || q.includes('twin')) {
    capacity = 2;
  } else if (q.includes('triple') || q.includes('3-seater') || q.includes('3 seater')) {
    capacity = 3;
  } else if (q.includes('quad') || q.includes('4-seater') || q.includes('4 seater')) {
    capacity = 4;
  }

  return {
    block,
    floor_min,
    floor_max,
    ac,
    tags,
    capacity,
  };
}

export interface LlmClientOptions {
  geminiApiKey?: string;
  groqApiKey?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  geminiInvoker?: ProviderInvoker;
  groqInvoker?: ProviderInvoker;
}

export class HostelLlmClient {
  private readonly geminiKey: string;
  private readonly groqKey: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly geminiInvoker?: ProviderInvoker;
  private readonly groqInvoker?: ProviderInvoker;

  private readonly filterCache = new Map<
    string,
    CacheEntry<{ filter: NaturalLanguageRoomFilter; provider: AiProviderState }>
  >();
  private readonly textCache = new Map<string, CacheEntry<LlmTextResponse>>();

  private lastUsedProvider: AiProviderState = 'offline';
  private lastFallbackReason: string | null = null;

  constructor(options: LlmClientOptions = {}) {
    this.geminiKey = (options.geminiApiKey ?? process.env.GEMINI_API_KEY ?? '').trim();
    this.groqKey = (options.groqApiKey ?? process.env.GROQ_API_KEY ?? '').trim();
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000;
    this.geminiInvoker = options.geminiInvoker;
    this.groqInvoker = options.groqInvoker;

    if (this.geminiKey || this.geminiInvoker) {
      this.lastUsedProvider = 'gemini';
    } else if (this.groqKey || this.groqInvoker) {
      this.lastUsedProvider = 'groq';
    } else {
      this.lastUsedProvider = 'offline';
      this.lastFallbackReason = 'No cloud AI key configured; running deterministic local mode.';
    }
  }

  public getStatus(): AiStatusInfo {
    const geminiConfigured = Boolean(this.geminiKey || this.geminiInvoker);
    const groqConfigured = Boolean(this.groqKey || this.groqInvoker);

    let active: AiProviderState = this.lastUsedProvider;
    if (active === 'gemini' && !geminiConfigured) {
      active = groqConfigured ? 'groq' : 'offline';
    }

    const label =
      active === 'gemini'
        ? 'Gemini Active'
        : active === 'groq'
          ? 'Groq Fallback Active'
          : 'Offline / Rule-Based Mode';

    const detail =
      active === 'gemini'
        ? 'Server-side Google Gemini (gemini-4-hydrogen) with automatic Groq and keyword fallback.'
        : active === 'groq'
          ? this.lastFallbackReason ?? 'Using Groq secondary provider.'
          : this.lastFallbackReason ??
            'Running deterministic local keyword parser and rules.md retriever without external AI.';

    return {
      provider: active,
      label,
      detail,
      gemini_configured: geminiConfigured,
      groq_configured: groqConfigured,
      last_used_provider: this.lastUsedProvider,
      last_fallback_reason: this.lastFallbackReason,
    };
  }

  private async callGemini(req: LlmTextRequest): Promise<string> {
    if (this.geminiInvoker) {
      return withTimeout(this.geminiInvoker(req), req.timeoutMs ?? this.timeoutMs);
    }
    if (!this.geminiKey) {
      throw new ProviderError('GEMINI_API_KEY is not configured.', 401);
    }

    const ai = new GoogleGenAI({
      apiKey: this.geminiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const config: Record<string, unknown> = {
      systemInstruction: req.systemInstruction,
    };

    if (req.expectJson) {
      config.responseMimeType = 'application/json';
      config.responseSchema = {
        type: Type.OBJECT,
        properties: {
          block: { type: Type.STRING, nullable: true },
          floor_min: { type: Type.INTEGER, nullable: true },
          floor_max: { type: Type.INTEGER, nullable: true },
          ac: { type: Type.BOOLEAN, nullable: true },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          capacity: { type: Type.INTEGER, nullable: true },
        },
        required: ['block', 'floor_min', 'floor_max', 'ac', 'tags', 'capacity'],
      };
    }

    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: req.userPrompt,
        config,
      }),
      req.timeoutMs ?? this.timeoutMs
    );

    const text = response.text?.trim();
    if (!text) {
      throw new ProviderError('Empty response received from Gemini.', 502);
    }
    return text;
  }

  private async callGroq(req: LlmTextRequest): Promise<string> {
    if (this.groqInvoker) {
      return withTimeout(this.groqInvoker(req), req.timeoutMs ?? this.timeoutMs);
    }
    if (!this.groqKey) {
      throw new ProviderError('GROQ_API_KEY is not configured.', 401);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? this.timeoutMs);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.groqKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: req.systemInstruction },
            { role: 'user', content: req.userPrompt },
          ],
          ...(req.expectJson ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      if (!response.ok) {
        throw new ProviderError(`Groq HTTP ${response.status}`, response.status);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new ProviderError('Empty response received from Groq.', 502);
      }
      return text;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderError('Groq request timed out.', 408, true);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async invokeWithFallback(req: LlmTextRequest): Promise<LlmTextResponse> {
    const hasGemini = Boolean(this.geminiKey || this.geminiInvoker);
    const hasGroq = Boolean(this.groqKey || this.groqInvoker);

    if (hasGemini) {
      try {
        const text = await this.callGemini(req);
        this.lastUsedProvider = 'gemini';
        this.lastFallbackReason = null;
        return { text, provider: 'gemini' };
      } catch (err) {
        const status = extractStatusCode(err);
        const isTimeout = err instanceof ProviderError && err.isTimeout;
        const reason =
          status === 429
            ? 'Gemini rate-limited (HTTP 429); switched to fallback.'
            : isTimeout
              ? 'Gemini timed out; switched to fallback.'
              : 'Gemini temporarily unavailable; switched to fallback.';
        this.lastFallbackReason = reason;
      }
    }

    if (hasGroq) {
      try {
        const text = await this.callGroq(req);
        this.lastUsedProvider = 'groq';
        return { text, provider: 'groq' };
      } catch (err) {
        const status = extractStatusCode(err);
        this.lastFallbackReason =
          status === 429
            ? 'Both Gemini and Groq hit rate limits; using deterministic offline fallback.'
            : 'External AI providers unavailable; using deterministic offline fallback.';
      }
    }

    this.lastUsedProvider = 'offline';
    throw new ProviderError(this.lastFallbackReason ?? 'Offline mode active.', 503);
  }

  /**
   * Parses natural-language room queries into a validated NaturalLanguageRoomFilter.
   * Retries ONCE if the AI returns invalid JSON/schema, then falls back cleanly.
   */
  public async parseNaturalLanguageRoomSearch(query: string): Promise<{
    filter: NaturalLanguageRoomFilter;
    provider: AiProviderState;
    cached: boolean;
  }> {
    const cacheKey = normalizeQueryKey('room-search', query);
    const hit = this.filterCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return { filter: hit.value.filter, provider: hit.value.provider, cached: true };
    }

    const systemInstruction = [
      'You extract structured hostel room search filters from a student query.',
      'Return ONLY a valid JSON object matching keys: block (string|null: Nilgiri Bhavan, Vindhya Bhavan, Kaveri Bhavan, Narmada Bhavan, or null),',
      'floor_min (integer 1-4 or null), floor_max (integer 1-4 or null), ac (boolean|null),',
      'tags (array of subset of: quiet, near_mess, near_stairs, corner, balcony), capacity (integer 1-4 or null).',
      'High floor means floor_min=3, floor_max=4. Low floor means floor_min=1, floor_max=2.',
      'Never invent extra keys or markdown fences.',
    ].join(' ');

    let parsedFilter: NaturalLanguageRoomFilter | null = null;
    let usedProvider: AiProviderState = 'offline';

    // Up to 2 attempts: initial + 1 retry on invalid structured JSON
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const prompt =
          attempt === 0
            ? `Extract room search filter for: "${query}"`
            : `Your previous JSON output failed schema validation. Return ONLY strict valid JSON with keys block, floor_min, floor_max, ac, tags, capacity for: "${query}"`;

        const res = await this.invokeWithFallback({
          systemInstruction,
          userPrompt: prompt,
          expectJson: true,
        });

        const cleaned = res.text
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        const rawJson: unknown = JSON.parse(cleaned);
        const validation = NaturalLanguageRoomFilterSchema.safeParse(rawJson);
        if (validation.success) {
          parsedFilter = validation.data;
          usedProvider = res.provider;
          break;
        }
      } catch (err) {
        // If offline/provider completely failed, break immediately to offline parser
        if (err instanceof ProviderError && err.statusCode === 503) {
          break;
        }
      }
    }

    if (!parsedFilter) {
      parsedFilter = parseRoomQueryOffline(query);
      usedProvider = 'offline';
      this.lastUsedProvider = 'offline';
      if (!this.lastFallbackReason) {
        this.lastFallbackReason = 'Structured AI validation failed; used deterministic keyword parser.';
      }
    }

    this.filterCache.set(cacheKey, {
      value: { filter: parsedFilter, provider: usedProvider },
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return { filter: parsedFilter, provider: usedProvider, cached: false };
  }

  /**
   * Answers hostel policy questions strictly grounded in provided `rules.md` excerpts.
   */
  public async answerGroundedPolicyQuestion(params: {
    question: string;
    matchedExcerpts: Array<{ heading: string; content: string }>;
  }): Promise<{
    answer: string;
    grounded: boolean;
    provider: AiProviderState;
    cached: boolean;
  }> {
    const FALLBACK_UNKNOWN = "I don't know the exact rule. Please contact the warden.";

    if (params.matchedExcerpts.length === 0) {
      return {
        answer: FALLBACK_UNKNOWN,
        grounded: false,
        provider: this.getStatus().provider,
        cached: false,
      };
    }

    const cacheKey = normalizeQueryKey(
      'policy-qa',
      `${params.question}::${params.matchedExcerpts.map((e) => e.heading).join('|')}`
    );
    const hit = this.textCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      const grounded = !hit.value.text.includes("I don't know the exact rule");
      return {
        answer: hit.value.text,
        grounded,
        provider: hit.value.provider,
        cached: true,
      };
    }

    const contextText = params.matchedExcerpts
      .map((s) => `### ${s.heading}\n${s.content}`)
      .join('\n\n');

    const systemInstruction = [
      'You are the HostelHub Information Desk at VidyaVihar University.',
      'Answer the student question using ONLY the official hostel rules excerpts provided below.',
      'Be concise, direct, and cite the relevant rule section title.',
      'If the provided excerpts do not clearly contain the answer, respond with EXACTLY:',
      `"${FALLBACK_UNKNOWN}"`,
      'Never invent timings, fines, or policies not explicitly written in the excerpts.',
    ].join(' ');

    try {
      const res = await this.invokeWithFallback({
        systemInstruction,
        userPrompt: `OFFICIAL RULES EXCERPTS:\n${contextText}\n\nSTUDENT QUESTION: ${params.question}`,
        expectJson: false,
      });

      this.textCache.set(cacheKey, {
        value: res,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      return {
        answer: res.text,
        grounded: !res.text.includes("I don't know the exact rule"),
        provider: res.provider,
        cached: false,
      };
    } catch {
      // Deterministic offline grounded synthesis directly from matched rules.md lines
      const top = params.matchedExcerpts[0];
      const answer = `From "${top.heading}":\n${top.content}`;
      return {
        answer,
        grounded: true,
        provider: 'offline',
        cached: false,
      };
    }
  }
}

let sharedLlmClient: HostelLlmClient | null = null;

export function getLlmClient(): HostelLlmClient {
  if (!sharedLlmClient) {
    sharedLlmClient = new HostelLlmClient();
  }
  return sharedLlmClient;
}
