import { RoommateMatch, Student } from '../types.ts';

/**
 * Deterministic Rule-Based Roommate Compatibility Engine
 * ======================================================
 * Produces a transparent 0-100 compatibility estimate from:
 * - Sleep schedule alignment (0-35 pts)
 * - Study style alignment (0-30 pts)
 * - Cleanliness alignment (0-35 pts)
 * Plus an optional cached lexical similarity bonus (up to +5 pts, total capped at 100)
 * when both students voluntarily fill out their short `about_me` note.
 *
 * No private PII (email, student code, CGPA) is ever sent externally.
 */

const STOP_WORDS = new Set([
  'i', 'am', 'a', 'an', 'the', 'and', 'or', 'to', 'in', 'of', 'for', 'with', 'like',
  'love', 'looking', 'roommate', 'who', 'is', 'are', 'prefer', 'preferring', 'very',
  'my', 'me', 'on', 'at', 'by', 'from', 'as', 'be', 'this', 'that', 'it', 'usually',
]);

// Cache tokenized feature vectors for voluntary about_me notes.
const bioVectorCache = new Map<string, Set<string>>();

function getBioTokens(bio: string): Set<string> {
  const normalized = bio.trim().toLowerCase();
  if (!normalized) return new Set();
  const cached = bioVectorCache.get(normalized);
  if (cached) return cached;

  const tokens = new Set(
    normalized
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
  );
  bioVectorCache.set(normalized, tokens);
  return tokens;
}

function computeBioSimilarityBonus(bioA: string, bioB: string): number {
  const setA = getBioTokens(bioA);
  const setB = getBioTokens(bioB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  const jaccard = intersection / union;
  return Math.min(5, Math.round(jaccard * 12));
}

export function calculateRoommateCompatibility(
  me: Student,
  candidate: Student
): {
  score: number;
  breakdown: RoommateMatch['breakdown'];
  explanation: string;
} {
  const sleep = me.sleep_schedule === candidate.sleep_schedule ? 35 : 10;
  const study = me.study_style === candidate.study_style ? 30 : 12;
  const cleanDiff = Math.abs(me.cleanliness - candidate.cleanliness);
  const cleanliness = Math.max(0, 35 - cleanDiff * 7);
  const bio_bonus = computeBioSimilarityBonus(me.about_me, candidate.about_me);

  const rawScore = sleep + study + cleanliness + bio_bonus;
  const score = Math.min(100, Math.max(0, rawScore));

  const notes: string[] = [];
  if (me.sleep_schedule === candidate.sleep_schedule) {
    notes.push(
      me.sleep_schedule === 'early'
        ? 'Both keep an early sleep schedule'
        : 'Both are late-night sleepers'
    );
  } else {
    notes.push('Different sleep schedules (early vs. late)');
  }

  if (me.study_style === candidate.study_style) {
    notes.push(
      me.study_style === 'quiet'
        ? 'both prefer quiet independent study'
        : 'both enjoy group study sessions'
    );
  } else {
    notes.push('contrasting study styles');
  }

  if (cleanDiff === 0) {
    notes.push(`identical cleanliness standard (${candidate.cleanliness}/5)`);
  } else if (cleanDiff === 1) {
    notes.push(`close cleanliness expectations (${candidate.cleanliness}/5 vs. ${me.cleanliness}/5)`);
  } else {
    notes.push(`cleanliness gap of ${cleanDiff} levels`);
  }

  if (bio_bonus > 0) {
    notes.push('shared interests noted in bio');
  }

  const explanation = `Rule-based estimate: ${notes.join('; ')}.`;

  return {
    score,
    breakdown: { sleep, study, cleanliness, bio_bonus },
    explanation,
  };
}

export function findTopRoommateMatches(
  me: Student,
  allStudents: Student[],
  limit = 5
): RoommateMatch[] {
  const candidates = allStudents.filter(
    (s) => s.id !== me.id && s.gender === me.gender
  );

  const scored: RoommateMatch[] = candidates.map((candidate) => {
    const { score, breakdown, explanation } = calculateRoommateCompatibility(
      me,
      candidate
    );
    const requestedByMe = me.roommate_requests.includes(candidate.id);
    const requestedMe = candidate.roommate_requests.includes(me.id);

    return {
      student: {
        id: candidate.id,
        student_code: candidate.student_code,
        name: candidate.name,
        year: candidate.year,
        branch: candidate.branch,
        gender: candidate.gender,
        sleep_schedule: candidate.sleep_schedule,
        study_style: candidate.study_style,
        cleanliness: candidate.cleanliness,
        about_me: candidate.about_me,
        allotted_room_id: candidate.allotted_room_id,
      },
      score,
      breakdown,
      explanation,
      is_mutual_request: requestedByMe && requestedMe,
      requested_by_me: requestedByMe,
      requested_me: requestedMe,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Prefer same academic year as soft tie-break
    const aSameYear = a.student.year === me.year ? 1 : 0;
    const bSameYear = b.student.year === me.year ? 1 : 0;
    if (bSameYear !== aSameYear) return bSameYear - aSameYear;
    return a.student.student_code.localeCompare(b.student.student_code);
  });

  return scored.slice(0, limit);
}
