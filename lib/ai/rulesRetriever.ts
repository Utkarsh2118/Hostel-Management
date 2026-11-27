import fs from 'node:fs';
import path from 'node:path';

export interface RuleSection {
  heading: string;
  content: string;
}

const RULES_STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'how', 'is', 'are', 'was', 'were',
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'about', 'can', 'i',
  'my', 'we', 'our', 'do', 'does', 'did', 'be', 'by', 'or', 'and', 'from', 'if', 'it',
  'me', 'hostel', 'rule', 'rules', 'policy', 'tell', 'please', 'allowed', 'permitted',
]);

export function getRulesFilePath(): string {
  return path.resolve(process.cwd(), 'rules.md');
}

export function readRulesMarkdown(): string {
  const filePath = getRulesFilePath();
  if (!fs.existsSync(filePath)) {
    return '# Hostel Rules\n\nNo rules document found. Please contact the warden.';
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeRulesMarkdown(content: string): void {
  const filePath = getRulesFilePath();
  const baseDir = path.resolve(process.cwd());
  if (!filePath.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid rules file path.');
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function parseRulesSections(markdown: string): RuleSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: RuleSection[] = [];
  let currentHeading = 'General Hostel Information';
  let buffer: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      if (buffer.join('\n').trim()) {
        sections.push({
          heading: currentHeading,
          content: buffer.join('\n').trim(),
        });
      }
      currentHeading = match[1].trim();
      buffer = [];
    } else if (!line.startsWith('# ')) {
      buffer.push(line);
    }
  }

  if (buffer.join('\n').trim()) {
    sections.push({
      heading: currentHeading,
      content: buffer.join('\n').trim(),
    });
  }

  return sections;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !RULES_STOP_WORDS.has(t));
}

/**
 * Retrieves the most relevant sections from rules.md for a student's question.
 * Returns an empty array if no section has meaningful lexical overlap so the
 * assistant never hallucinates unsupported policies.
 */
export function retrieveMatchingRuleSections(
  question: string,
  markdown?: string,
  maxSections = 2
): Array<RuleSection & { score: number }> {
  const source = markdown ?? readRulesMarkdown();
  const sections = parseRulesSections(source);
  const queryTokens = tokenize(question);

  if (queryTokens.length === 0) return [];

  const scored = sections.map((section) => {
    const headingLower = section.heading.toLowerCase();
    const bodyLower = section.content.toLowerCase();
    let score = 0;

    for (const token of queryTokens) {
      // Stem-friendly prefix match (e.g., "timing"/"timings", "visitor"/"visitors")
      const stem = token.length > 4 ? token.slice(0, token.length - 1) : token;
      if (headingLower.includes(token) || headingLower.includes(stem)) {
        score += 4;
      }
      if (bodyLower.includes(token)) {
        score += 2;
      } else if (stem.length >= 4 && bodyLower.includes(stem)) {
        score += 1;
      }
    }

    return { ...section, score };
  });

  return scored
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSections);
}
