import crypto from 'node:crypto';
import type { AuthUserProfile, Role } from '../auth/roles.ts';
import { canAccessBlock } from '../auth/permissions.ts';
import type { IHostelRepository } from '../repo/interface.ts';

export type DocumentCategory =
  | 'identity_document'
  | 'enrollment_proof'
  | 'hostel_form'
  | 'supporting_document'
  | 'allotment_letter'
  | 'fee_receipt';

export type DocumentReviewStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type AllowedDocumentMimeType = (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

export const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB
export const SIGNED_URL_DEFAULT_TTL_SECONDS = 60;

export interface StudentDocumentRecord {
  id: string;
  student_id: string;
  student_code: string;
  category: DocumentCategory;
  original_filename: string;
  sanitized_filename: string;
  mime_type: AllowedDocumentMimeType;
  size_bytes: number;
  sha256_checksum: string;
  private_storage_path: string;
  review_status: DocumentReviewStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  uploaded_at: string;
  is_synthetic_placeholder: boolean;
}

export interface DocumentAccessLogEntry {
  id: string;
  document_id: string;
  student_id: string;
  actor_id: string;
  actor_email: string;
  actor_role: Role;
  event: 'UPLOADED' | 'SIGNED_URL_ISSUED' | 'DOWNLOADED' | 'REVIEWED';
  detail: string;
  timestamp: string;
}

export class DocumentVaultError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'DocumentVaultError';
  }
}

export function sanitizeDocumentFilename(rawName: string): string {
  const base = rawName
    .replace(/\\/g, '/')
    .split('/')
    .pop() ?? 'document';
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 96);
  return cleaned.length >= 3 ? cleaned : `document_${Date.now()}.pdf`;
}

/**
 * Private Institutional Document Vault Service
 * ============================================
 * - Enforces strict MIME allowlist (PDF, JPEG, PNG) and 5 MiB cap.
 * - Stores objects strictly under private logical paths (no public URLs).
 * - Issues short-lived (60s) HMAC-SHA256 signed tokens bound to (docId, userId, exp).
 * - Blocks cross-student IDOR and denies MAINTENANCE_STAFF unconditionally.
 * - Audits every upload, signed-link issuance, download, and review action.
 */
export class PrivateDocumentVaultService {
  private readonly documents = new Map<string, StudentDocumentRecord>();
  private readonly payloads = new Map<string, Buffer>();
  private readonly accessLogs: DocumentAccessLogEntry[] = [];
  private readonly signingKey: Buffer;

  constructor(private readonly repo: IHostelRepository) {
    const secret = process.env.DOCUMENT_SIGNING_SECRET || process.env.SESSION_SECRET;
    this.signingKey = secret
      ? crypto.createHash('sha256').update(`hostelhub-doc-vault:${secret}`).digest()
      : crypto.randomBytes(32);

    this.seedDemoDocuments();
  }

  private seedDemoDocuments(): void {
    const seedContent = Buffer.from(
      'VidyaVihar University — Synthetic Development Enrollment Certificate (stu-001 / VV2024CO101)\n' +
        'This file is a non-production development placeholder stored in the private vault.\n',
      'utf8'
    );
    const docId = 'doc-seed-stu001-enroll';
    const checksum = crypto.createHash('sha256').update(seedContent).digest('hex');

    this.documents.set(docId, {
      id: docId,
      student_id: 'stu-001',
      student_code: 'VV2024CO101',
      category: 'enrollment_proof',
      original_filename: 'VV2024CO101_enrollment_2026.pdf',
      sanitized_filename: 'VV2024CO101_enrollment_2026.pdf',
      mime_type: 'application/pdf',
      size_bytes: seedContent.byteLength,
      sha256_checksum: checksum,
      private_storage_path: `private/students/stu-001/${docId}-VV2024CO101_enrollment_2026.pdf`,
      review_status: 'VERIFIED',
      review_note: 'Development placeholder document verified for UI demonstration.',
      reviewed_by: 'admin.demo@hostelhub.local',
      reviewed_at: '2026-07-16T09:30:00.000Z',
      uploaded_at: '2026-07-16T09:20:00.000Z',
      is_synthetic_placeholder: true,
    });
    this.payloads.set(docId, seedContent);
  }

  private async canWardenAccessStudent(actor: AuthUserProfile, studentId: string): Promise<boolean> {
    if (actor.role !== 'WARDEN') return false;
    const student = await this.repo.getStudentById(studentId);
    if (!student) return false;
    if (!student.allotted_room_id) {
      // Unallotted students pending review can be checked by wardens only if assigned at least one block
      return actor.assigned_block_ids.length > 0;
    }
    const room = await this.repo.getRoomById(student.allotted_room_id);
    if (!room) return false;
    return canAccessBlock(actor, room.block_id);
  }

  private async assertCanReadDocument(actor: AuthUserProfile, doc: StudentDocumentRecord): Promise<void> {
    if (actor.role === 'MAINTENANCE_STAFF') {
      throw new DocumentVaultError('Maintenance staff are strictly prohibited from accessing student documents.', 403);
    }
    if (actor.role === 'ADMIN') return;
    if (actor.role === 'STUDENT') {
      if (actor.student_id !== doc.student_id) {
        throw new DocumentVaultError('Forbidden: You may only access your own uploaded documents.', 403);
      }
      return;
    }
    if (actor.role === 'WARDEN') {
      const allowed = await this.canWardenAccessStudent(actor, doc.student_id);
      if (!allowed) {
        throw new DocumentVaultError(
          'Forbidden: This student is outside your assigned hostel block scope.',
          403
        );
      }
      return;
    }
    throw new DocumentVaultError('Forbidden.', 403);
  }

  private async recordAccessEvent(
    actor: AuthUserProfile,
    doc: StudentDocumentRecord,
    event: DocumentAccessLogEntry['event'],
    detail: string
  ): Promise<void> {
    const entry: DocumentAccessLogEntry = {
      id: `doc-log-${crypto.randomUUID().slice(0, 8)}`,
      document_id: doc.id,
      student_id: doc.student_id,
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      event,
      detail,
      timestamp: new Date().toISOString(),
    };
    this.accessLogs.unshift(entry);
    await this.repo.appendAuditLog(actor.email, actor.role, `DOCUMENT_${event}`, {
      document_id: doc.id,
      student_id: doc.student_id,
      category: doc.category,
      detail,
    });
  }

  public async listDocuments(
    actor: AuthUserProfile,
    filterStudentId?: string
  ): Promise<StudentDocumentRecord[]> {
    if (actor.role === 'MAINTENANCE_STAFF') {
      throw new DocumentVaultError('Maintenance staff cannot list student documents.', 403);
    }

    const allDocs = Array.from(this.documents.values()).sort((a, b) =>
      b.uploaded_at.localeCompare(a.uploaded_at)
    );

    if (actor.role === 'STUDENT') {
      if (!actor.student_id) return [];
      if (filterStudentId && filterStudentId !== actor.student_id) {
        throw new DocumentVaultError('Forbidden: Students cannot query other students’ documents.', 403);
      }
      return allDocs
        .filter((d) => d.student_id === actor.student_id)
        .map((d) => structuredClone(d));
    }

    if (actor.role === 'ADMIN') {
      return allDocs
        .filter((d) => !filterStudentId || d.student_id === filterStudentId)
        .map((d) => structuredClone(d));
    }

    // WARDEN: strictly filter to students inside assigned hostel blocks
    const scoped: StudentDocumentRecord[] = [];
    for (const doc of allDocs) {
      if (filterStudentId && doc.student_id !== filterStudentId) continue;
      if (await this.canWardenAccessStudent(actor, doc.student_id)) {
        scoped.push(structuredClone(doc));
      }
    }
    return scoped;
  }

  public async uploadStudentDocument(
    actor: AuthUserProfile,
    input: {
      category: DocumentCategory;
      filename: string;
      mime_type: string;
      content_base64: string;
    }
  ): Promise<StudentDocumentRecord> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new DocumentVaultError('Only authenticated students can upload personal verification documents.', 403);
    }

    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(input.mime_type as AllowedDocumentMimeType)) {
      throw new DocumentVaultError(
        `Unsupported file type '${input.mime_type}'. Allowed formats: PDF, JPEG, PNG.`,
        400
      );
    }

    let payloadBuffer: Buffer;
    try {
      payloadBuffer = Buffer.from(input.content_base64, 'base64');
    } catch {
      throw new DocumentVaultError('Document payload must be valid base64.', 400);
    }

    if (payloadBuffer.byteLength === 0) {
      throw new DocumentVaultError('Uploaded document cannot be empty.', 400);
    }
    if (payloadBuffer.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
      throw new DocumentVaultError(
        `Document exceeds the 5 MB maximum upload limit (${payloadBuffer.byteLength} bytes).`,
        413
      );
    }

    const sanitized = sanitizeDocumentFilename(input.filename);
    const docId = `doc-${crypto.randomUUID().slice(0, 10)}`;
    const checksum = crypto.createHash('sha256').update(payloadBuffer).digest('hex');
    const storagePath = `private/students/${actor.student_id}/${docId}-${sanitized}`;

    const record: StudentDocumentRecord = {
      id: docId,
      student_id: actor.student_id,
      student_code: actor.student_code ?? actor.student_id,
      category: input.category,
      original_filename: input.filename.slice(0, 120),
      sanitized_filename: sanitized,
      mime_type: input.mime_type as AllowedDocumentMimeType,
      size_bytes: payloadBuffer.byteLength,
      sha256_checksum: checksum,
      private_storage_path: storagePath,
      review_status: 'PENDING',
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      uploaded_at: new Date().toISOString(),
      is_synthetic_placeholder: false,
    };

    this.documents.set(docId, record);
    this.payloads.set(docId, payloadBuffer);

    await this.recordAccessEvent(
      actor,
      record,
      'UPLOADED',
      `Uploaded ${sanitized} (${record.mime_type}, ${record.size_bytes} bytes)`
    );

    return structuredClone(record);
  }

  public async createSignedDownloadToken(
    actor: AuthUserProfile,
    documentId: string,
    ttlSeconds = SIGNED_URL_DEFAULT_TTL_SECONDS
  ): Promise<{
    document_id: string;
    token: string;
    download_url: string;
    expires_at: string;
    ttl_seconds: number;
  }> {
    const doc = this.documents.get(documentId);
    if (!doc) {
      throw new DocumentVaultError('Document not found.', 404);
    }
    await this.assertCanReadDocument(actor, doc);

    const boundedTtl = Math.max(10, Math.min(300, Math.floor(ttlSeconds)));
    const expEpochSec = Math.floor(Date.now() / 1000) + boundedTtl;
    const payload = Buffer.from(
      JSON.stringify({
        docId: doc.id,
        userId: actor.id,
        exp: expEpochSec,
      }),
      'utf8'
    ).toString('base64url');

    const sig = crypto
      .createHmac('sha256', this.signingKey)
      .update(payload)
      .digest('base64url');

    const token = `${payload}.${sig}`;
    const expiresAt = new Date(expEpochSec * 1000).toISOString();

    await this.recordAccessEvent(
      actor,
      doc,
      'SIGNED_URL_ISSUED',
      `Issued short-lived signed access link (${boundedTtl}s TTL)`
    );

    return {
      document_id: doc.id,
      token,
      download_url: `/api/documents/download?token=${encodeURIComponent(token)}`,
      expires_at: expiresAt,
      ttl_seconds: boundedTtl,
    };
  }

  public async redeemSignedDownloadToken(
    actor: AuthUserProfile,
    token: string
  ): Promise<{
    document: StudentDocumentRecord;
    content: Buffer;
  }> {
    if (actor.role === 'MAINTENANCE_STAFF') {
      throw new DocumentVaultError('Maintenance staff cannot download student documents.', 403);
    }

    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new DocumentVaultError('Invalid or malformed signed document token.', 401);
    }

    const [payloadB64, providedSig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.signingKey)
      .update(payloadB64)
      .digest('base64url');

    const providedBuf = Buffer.from(providedSig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw new DocumentVaultError('Signed document link signature verification failed.', 401);
    }

    let parsed: { docId?: string; userId?: string; exp?: number };
    try {
      parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
        docId?: string;
        userId?: string;
        exp?: number;
      };
    } catch {
      throw new DocumentVaultError('Signed document payload could not be parsed.', 401);
    }

    if (!parsed.docId || !parsed.userId || typeof parsed.exp !== 'number') {
      throw new DocumentVaultError('Signed document token is incomplete.', 401);
    }
    if (Math.floor(Date.now() / 1000) > parsed.exp) {
      throw new DocumentVaultError('Signed document link has expired. Request a fresh access link.', 410);
    }
    if (parsed.userId !== actor.id) {
      throw new DocumentVaultError('Signed document link is bound to a different authenticated user.', 403);
    }

    const doc = this.documents.get(parsed.docId);
    const content = this.payloads.get(parsed.docId);
    if (!doc || !content) {
      throw new DocumentVaultError('Document payload not found.', 404);
    }

    await this.assertCanReadDocument(actor, doc);
    await this.recordAccessEvent(actor, doc, 'DOWNLOADED', `Downloaded ${doc.sanitized_filename}`);

    return {
      document: structuredClone(doc),
      content,
    };
  }

  public async reviewDocument(
    actor: AuthUserProfile,
    params: {
      documentId: string;
      status: DocumentReviewStatus;
      note: string;
    }
  ): Promise<StudentDocumentRecord> {
    if (actor.role !== 'ADMIN' && actor.role !== 'WARDEN') {
      throw new DocumentVaultError('Only Administrators or scoped Wardens may review student documents.', 403);
    }

    const doc = this.documents.get(params.documentId);
    if (!doc) {
      throw new DocumentVaultError('Document not found.', 404);
    }
    await this.assertCanReadDocument(actor, doc);

    const updated: StudentDocumentRecord = {
      ...doc,
      review_status: params.status,
      review_note: params.note.trim(),
      reviewed_by: actor.email,
      reviewed_at: new Date().toISOString(),
    };
    this.documents.set(doc.id, updated);

    await this.recordAccessEvent(
      actor,
      updated,
      'REVIEWED',
      `Marked ${params.status}: ${updated.review_note}`
    );

    return structuredClone(updated);
  }

  public listAccessLogs(actor: AuthUserProfile, documentId?: string): DocumentAccessLogEntry[] {
    if (actor.role !== 'ADMIN' && actor.role !== 'WARDEN') {
      throw new DocumentVaultError('Only Administrators or Wardens may view document access logs.', 403);
    }
    return this.accessLogs
      .filter((entry) => !documentId || entry.document_id === documentId)
      .slice(0, 100)
      .map((entry) => structuredClone(entry));
  }
}

let sharedDocumentVaultService: PrivateDocumentVaultService | null = null;

export function getDocumentVaultService(repo: IHostelRepository): PrivateDocumentVaultService {
  if (!sharedDocumentVaultService) {
    sharedDocumentVaultService = new PrivateDocumentVaultService(repo);
  }
  return sharedDocumentVaultService;
}
