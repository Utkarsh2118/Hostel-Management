import React, { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { AiProviderState, AiStatusInfo } from '../../lib/types';
import { AiStatusBadge } from '../components/ui/AiStatusBadge';

interface AskResponse {
  answer: string;
  grounded: boolean;
  sources: string[];
  provider: AiProviderState;
  cached: boolean;
  ai_status: AiStatusInfo;
}

interface DeskExchange {
  id: string;
  question: string;
  answer: string;
  grounded: boolean;
  sources: string[];
  provider: AiProviderState;
  cached: boolean;
  timestamp: string;
}

interface AssistantPageProps {
  aiStatus: AiStatusInfo | null;
  onAiStatusUpdate: (status: AiStatusInfo) => void;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

const SAMPLE_QUESTIONS = [
  'What are the mess timings for breakfast and dinner?',
  'What is the night gate curfew for 1st-year vs senior students?',
  'Are electric kettles or room heaters allowed in hostel rooms?',
  'How long does a room swap proposal stay valid before expiring?',
  'What are the visitor hours for parents and day scholars?',
  'Can I bring a pet dog into Nilgiri Bhavan?',
];

export const AssistantPage: React.FC<AssistantPageProps> = ({
  aiStatus,
  onAiStatusUpdate,
  onToast,
}) => {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [exchanges, setExchanges] = useState<DeskExchange[]>([
    {
      id: 'welcome',
      question: 'How does the Hostel Information Desk work?',
      answer:
        'Ask any question about VidyaVihar hostel blocks, mess timings, gate curfew, visitor rules, electrical appliances, or room swap procedures. Every answer is verified strictly against the official rules.md handbook—if a policy is not documented there, you will be referred to your Block Warden.',
      grounded: true,
      sources: ['VidyaVihar University Hostel Rules & Administration Manual'],
      provider: aiStatus?.provider ?? 'offline',
      cached: false,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [rulesMarkdown, setRulesMarkdown] = useState<string>('');
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    apiFetch<{ content: string }>('/api/rules')
      .then((res) => setRulesMarkdown(res.content))
      .catch(() => {
        /* Handled gracefully when user expands manual */
      });
  }, []);

  const submitQuestion = async (rawQ: string) => {
    const trimmed = rawQ.trim();
    if (trimmed.length < 2) {
      onToast('error', 'Please type a hostel policy question first.');
      return;
    }

    setAsking(true);
    try {
      const res = await apiFetch<AskResponse>('/api/assistant/ask', {
        method: 'POST',
        body: JSON.stringify({ question: trimmed }),
      });
      onAiStatusUpdate(res.ai_status);
      setExchanges((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          question: trimmed,
          answer: res.answer,
          grounded: res.grounded,
          sources: res.sources,
          provider: res.provider,
          cached: res.cached,
          timestamp: new Date().toISOString(),
        },
      ]);
      setQuestion('');
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Warden abhi busy hain. Thodi der baad try karo.'
      );
    } finally {
      setAsking(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitQuestion(question);
  };

  return (
    <div className="space-y-7">
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="font-mono-code text-xs text-[#465078]">
            HOSTEL INFORMATION DESK · GROUNDED IN OFFICIAL RULES.MD
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
            Hostel Rules &amp; Policy Desk
          </h1>
        </div>
        <AiStatusBadge status={aiStatus} />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Main Information Desk Ledger (8 cols) */}
        <section className="lg:col-span-8 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink flex flex-col">
          <div className="px-5 py-3 bg-[#F1E6CF] border-b-2 border-[#1F2A5A] flex items-center justify-between gap-2">
            <span className="font-mono-code text-xs font-bold text-[#1F2A5A]">
              INQUIRY REGISTER · GROUND FLOOR DESK
            </span>
            <span className="font-mono-code text-xs text-[#465078]">
              {exchanges.length} entry(s)
            </span>
          </div>

          <div className="p-5 space-y-5 max-h-[540px] overflow-y-auto">
            {exchanges.map((item) => (
              <article
                key={item.id}
                className="border-b last:border-b-0 border-[#1F2A5A]/20 pb-5 last:pb-0 space-y-3"
              >
                {/* Student Inquiry Slip */}
                <div className="bg-[#FBE9A6] border border-[#1F2A5A] rounded-[2px] px-4 py-2.5">
                  <p className="font-mono-code text-[11px] text-[#465078]">STUDENT INQUIRY</p>
                  <p className="text-sm font-bold text-[#1F2A5A] mt-0.5">{item.question}</p>
                </div>

                {/* Official Desk Answer */}
                <div className="bg-[#F1E6CF] border border-[#1F2A5A]/50 rounded-[2px] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-code">
                    <span
                      className={
                        item.grounded
                          ? 'font-bold text-[#295234]'
                          : 'font-bold text-[#B3261E]'
                      }
                    >
                      {item.grounded
                        ? 'VERIFIED FROM RULES.MD'
                        : 'UNSUPPORTED POLICY · CONTACT WARDEN'}
                    </span>
                    <span className="text-[#465078]">
                      via {item.provider}
                      {item.cached ? ' (cached)' : ''}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-[#1F2A5A] whitespace-pre-line leading-relaxed">
                    {item.answer}
                  </p>

                  {item.sources.length > 0 && (
                    <p className="mt-2.5 pt-2 border-t border-[#1F2A5A]/15 font-mono-code text-[11px] text-[#465078]">
                      Reference: {item.sources.join(' · ')}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>

          {/* Question Input Desk */}
          <form
            onSubmit={handleSubmit}
            className="p-4 bg-[#F1E6CF] border-t-2 border-[#1F2A5A] flex flex-col sm:flex-row gap-2.5"
          >
            <label className="flex-1">
              <span className="sr-only">Ask a question about hostel rules</span>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about mess timings, curfew, visitors, AC rules, or swaps..."
                className="w-full px-3.5 py-2.5 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] text-[#1F2A5A] placeholder:text-[#465078]"
              />
            </label>
            <button
              type="submit"
              disabled={asking}
              className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] inline-flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
              {asking ? 'Checking rules...' : 'Ask Desk'}
            </button>
          </form>
        </section>

        {/* Right Column: Common Queries + Inspectable rules.md (4 cols) */}
        <aside className="lg:col-span-4 space-y-5">
          <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5">
            <h2 className="font-display text-xl text-[#1F2A5A] border-b border-[#1F2A5A]/25 pb-2">
              Frequently Asked at Desk
            </h2>
            <ul className="mt-3 space-y-2">
              {SAMPLE_QUESTIONS.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    disabled={asking}
                    onClick={() => void submitQuestion(q)}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-[#1F2A5A] bg-[#F1E6CF] border border-[#1F2A5A]/50 rounded-[2px] hover:bg-[#FBE9A6] transition-colors disabled:opacity-50"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-[#1F2A5A]">Official rules.md Source</h3>
              <button
                type="button"
                onClick={() => setShowManual((v) => !v)}
                className="text-xs font-bold text-[#C2552D] hover:underline"
              >
                {showManual ? 'Hide Source' : 'Read Full Manual'}
              </button>
            </div>
            <p className="mt-1 text-xs text-[#465078]">
              The assistant never invents university rules. Anything outside this manual directs you
              to the Block Warden.
            </p>
            {showManual && (
              <pre className="mt-3 p-3 bg-[#F1E6CF] border border-[#1F2A5A]/40 text-[11px] font-mono-code text-[#1F2A5A] whitespace-pre-wrap max-h-72 overflow-y-auto">
                {rulesMarkdown || 'Loading rules.md...'}
              </pre>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
