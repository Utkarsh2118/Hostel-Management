import { describe, expect, it } from 'vitest';
import {
  calculateRoommateCompatibility,
  findTopRoommateMatches,
} from '../lib/compatibility/engine.ts';
import { HostelAuthService } from '../lib/auth/authService.ts';
import {
  CreateSwapRequestSchema,
  UpdateStudentProfileSchema,
} from '../lib/validation/schemas.ts';
import type { Student } from '../lib/types.ts';

function sampleStudent(overrides: Partial<Student> & { id: string }): Student {
  return {
    student_code: `VV24CS${overrides.id}`,
    name: `Student ${overrides.id}`,
    email: `${overrides.id}@univ.edu.in`,
    year: 3,
    branch: 'Computer Science',
    gender: 'male',
    cgpa_band: 'A',
    sleep_schedule: 'late',
    study_style: 'quiet',
    cleanliness: 4,
    about_me: 'Distributed systems and badminton enthusiast.',
    preferences: ['nb-101'],
    roommate_requests: [],
    allotted_room_id: 'nb-101',
    ...overrides,
  };
}

describe('Roommate Compatibility, Auth Domain & Zod Validation', () => {
  it('scores identical habits highest and filters matches strictly by gender', () => {
    const me = sampleStudent({ id: 'me', gender: 'male', sleep_schedule: 'late', study_style: 'quiet', cleanliness: 4 });
    const ideal = sampleStudent({ id: 'ideal', gender: 'male', sleep_schedule: 'late', study_style: 'quiet', cleanliness: 4 });
    const mismatch = sampleStudent({ id: 'mismatch', gender: 'male', sleep_schedule: 'early', study_style: 'group', cleanliness: 1, about_me: '' });
    const otherGender = sampleStudent({ id: 'girl', gender: 'female', sleep_schedule: 'late', study_style: 'quiet', cleanliness: 4 });

    const idealScore = calculateRoommateCompatibility(me, ideal);
    const mismatchScore = calculateRoommateCompatibility(me, mismatch);
    expect(idealScore.score).toBe(100);
    expect(mismatchScore.score).toBeLessThan(50);

    const top = findTopRoommateMatches(me, [me, mismatch, otherGender, ideal], 5);
    expect(top.map((m) => m.student.id)).toEqual(['ideal', 'mismatch']);
  });

  it('validates university email domain restrictions', () => {
    const auth = new HostelAuthService({ allowedEmailDomain: 'univ.edu.in' });
    expect(auth.isUniversityEmailValid('rohan.kulkarni@univ.edu.in')).toBe(true);
    expect(auth.isUniversityEmailValid('external@gmail.com')).toBe(false);
    expect(auth.isUniversityEmailValid('@univ.edu.in')).toBe(false);
  });

  it('enforces max 5 unique preferences and non-empty swap criteria via Zod', () => {
    const tooManyPrefs = UpdateStudentProfileSchema.safeParse({
      name: 'Rohan',
      year: 3,
      branch: 'CS',
      gender: 'male',
      cgpa_band: 'A',
      sleep_schedule: 'late',
      study_style: 'quiet',
      cleanliness: 4,
      about_me: '',
      preferences: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
    });
    expect(tooManyPrefs.success).toBe(false);

    const dupPrefs = UpdateStudentProfileSchema.safeParse({
      name: 'Rohan',
      year: 3,
      branch: 'CS',
      gender: 'male',
      cgpa_band: 'A',
      sleep_schedule: 'late',
      study_style: 'quiet',
      cleanliness: 4,
      about_me: '',
      preferences: ['r1', 'r1'],
    });
    expect(dupPrefs.success).toBe(false);

    const emptySwap = CreateSwapRequestSchema.safeParse({ wanted_criteria: { note: 'just looking' } });
    expect(emptySwap.success).toBe(false);

    const validSwap = CreateSwapRequestSchema.safeParse({
      wanted_criteria: { ac: true, floor_max: 2, note: 'AC lower floor' },
    });
    expect(validSwap.success).toBe(true);
  });
});
