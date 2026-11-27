import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  Download,
  FileCheck2,
  FileUp,
  History,
  Lock,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ToastMessage } from '../components/layout/ToastContainer';
import type {
  StudentVerificationRecord,
} from '../../lib/integrations/university/student-verification';
import type {
  DocumentCategory,
  StudentDocumentRecord,
} from '../../lib/documents/service';

interface ProviderSummary {
  environment: string;
  active_provider_kind: string;
  active_provider_name: string;
  is_mock_development_provider: boolean;
  official_api_configured: boolean;
  imported_roster_count: number;
}

interface VerificationMeResponse {
  record: StudentVerificationRecord;
  provider: ProviderSummary;
}

interface DocumentsListResponse {
  documents: StudentDocumentRecord[];
}

interface SignedUrlResponse {
  document_id: string;
  token: string;
  download_url: string;
  expires_at: string;
  ttl_seconds: number;
}

export interface StudentVerificationPageProps {
  onToast: (tone: ToastMessage['tone'], text: string) => void;
}

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  identity_document: 'University / Govt ID Card',
  enrollment_proof: 'Semester Enrollment Proof',
  hostel_form: 'Signed Hostel Undertaking',
  supporting_document: 'Supporting Medical / Other Proof',
  allotment_letter: 'Hostel Allotment Letter',
  fee_receipt: 'Hostel Fee Receipt',
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

export const StudentVerificationPage: React.FC<StudentVerificationPageProps> = ({ onToast }) => {
  const [record, setRecord] = useState<StudentVerificationRecord | null>(null);
  const [provider, setProvider] = useState<ProviderSummary | null>(null);
  const [documents, setDocuments] = useState<StudentDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [studentCodeInput, setStudentCodeInput] = useState('');
  const [submittingVer, setSubmittingVer] = useState(false);

  const [docCategory, setDocCategory] = useState<DocumentCategory>('enrollment_proof');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [verRes, docsRes] = await Promise.all([
        apiFetch<VerificationMeResponse>('/api/verification/me'),
        apiFetch<DocumentsListResponse>('/api/documents'),
      ]);
      setRecord(verRes.record);
      setProvider(verRes.provider);
      setStudentCodeInput(verRes.record.university_student_id || '');
      setDocuments(docsRes.documents);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load verification register.'
      );
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentCodeInput.trim()) {
      onToast('error', 'Enter your official University Student ID.');
      return;
    }
    setSubmittingVer(true);
    try {
      const res = await apiFetch<{
        record: StudentVerificationRecord;
        provider: ProviderSummary;
        message: string;
      }>('/api/verification/submit', {
        method: 'POST',
        body: JSON.stringify({
          university_student_code: studentCodeInput.trim().toUpperCase(),
        }),
      });
      setRecord(res.record);
      setProvider(res.provider);
      onToast(res.record.is_mock_development_record ? 'info' : 'success', res.message);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Verification request failed.'
      );
    } finally {
      setSubmittingVer(false);
    }
  };

  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      onToast('error', 'Choose a PDF, JPEG, or PNG file to upload.');
      return;
    }
    if (!ALLOWED_MIME.has(selectedFile.type)) {
      onToast('error', 'Only PDF, JPEG, and PNG documents are accepted.');
      return;
    }
    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      onToast('error', 'File exceeds the 5 MB maximum institutional upload limit.');
      return;
    }

    setUploadingDoc(true);
    try {
      const contentBase64 = await readFileAsBase64(selectedFile);
      const res = await apiFetch<{ document: StudentDocumentRecord; message: string }>(
        '/api/documents',
        {
          method: 'POST',
          body: JSON.stringify({
            category: docCategory,
            filename: selectedFile.name,
            mime_type: selectedFile.type,
            content_base64: contentBase64,
          }),
        }
      );
      setDocuments((prev) => [res.document, ...prev]);
      setSelectedFile(null);
      onToast('success', res.message);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to upload document.'
      );
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleSignedDownload = async (doc: StudentDocumentRecord) => {
    setDownloadingId(doc.id);
    try {
      const signed = await apiFetch<SignedUrlResponse>(
        `/api/documents/${encodeURIComponent(doc.id)}/signed-url`,
        { method: 'POST' }
      );
      const response = await fetch(signed.download_url, {
        credentials: 'include',
        headers: { 'X-Requested-With': 'HostelHub' },
      });
      if (!response.ok) {
        throw new Error(`Signed download failed (HTTP ${response.status}).`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = doc.sanitized_filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      onToast(
        'success',
        `Downloaded ${doc.sanitized_filename} via ${signed.ttl_seconds}s user-bound signed link.`
      );
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to download document.'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading || !record) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading University Verification &amp; Private Document Vault...
      </div>
    );
  }

  const lifecycleItems = [
    {
      key: 'authenticated',
      label: '01 · Authenticated',
      detail: 'Verified server-side session',
      done: record.account_lifecycle.authenticated,
    },
    {
      key: 'identity_verified',
      label: '02 · Identity Verified',
      detail: 'University enrollment confirmed',
      done: record.account_lifecycle.identity_verified,
    },
    {
      key: 'account_activated',
      label: '03 · Account Activated',
      detail: 'Standing active & unrestricted',
      done: record.account_lifecycle.account_activated,
    },
    {
      key: 'hostel_eligible',
      label: '04 · Hostel Eligible',
      detail: 'Meets campus housing rules',
      done: record.account_lifecycle.hostel_eligible,
    },
    {
      key: 'application_approved',
      label: '05 · Allotment Approved',
      detail: 'Active room/bed assignment',
      done: record.account_lifecycle.application_approved,
    },
  ];

  const statusTone =
    record.status === 'VERIFIED'
      ? 'bg-[#5E8C6A] text-[#F8F2E4]'
      : record.status === 'REJECTED' || record.status === 'SUSPENDED'
        ? 'bg-[#B3261E] text-[#F8F2E4]'
        : 'bg-[#F2C94C] text-[#1F2A5A]';

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 border-b-2 border-[#1F2A5A] pb-4">
          <div>
            <p className="font-mono-code text-xs font-bold tracking-[0.16em] text-[#C2552D] uppercase">
              PHASE 2 · INSTITUTIONAL IDENTITY &amp; VAULT
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] leading-tight mt-1">
              University Verification &amp; Private Documents
            </h1>
            <p className="text-sm text-[#465078] mt-1 max-w-2xl">
              Your university Student Information System (SIS) or Registrar roster is the sole
              authority for enrollment verification. Uploaded documents are stored privately and
              accessed exclusively through short-lived signed links.
            </p>
          </div>
          <div className="shrink-0 text-left md:text-right">
            <span className="block font-mono-code text-[11px] uppercase tracking-wider text-[#465078]">
              Verification Status
            </span>
            <span
              className={`inline-block mt-1 px-3 py-1 font-mono-code text-sm font-bold border-2 border-[#1F2A5A] ${statusTone}`}
            >
              {record.status}
            </span>
          </div>
        </div>

        {/* Non-production Development Mock Notice */}
        {(record.is_mock_development_record || provider?.is_mock_development_provider) && (
          <div
            role="status"
            className="mt-4 bg-[#FBE9A6] border-2 border-[#B3261E] p-3.5 flex items-start gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-[#B3261E] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-[#1F2A5A]">
              <p className="font-bold">
                Development Verification Mode — Not Connected to Official University SIS
              </p>
              <p className="text-xs text-[#465078] mt-0.5">
                Active provider: <span className="font-mono-code font-bold">{provider?.active_provider_name}</span>{' '}
                (Environment: <span className="font-mono-code font-bold">{provider?.environment}</span>).
                Records flagged as development mocks are blocked in production and do not constitute
                official university approval.
              </p>
            </div>
          </div>
        )}

        {/* Separated 5-Stage Lifecycle Ledger */}
        <div className="mt-5">
          <h2 className="font-mono-code text-xs font-bold uppercase tracking-wider text-[#465078] mb-2.5">
            Account &amp; Hostel Lifecycle Checkpoints
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {lifecycleItems.map((step) => (
              <div
                key={step.key}
                className={[
                  'border-2 border-[#1F2A5A] p-3',
                  step.done ? 'bg-[#F1E6CF]' : 'bg-[#F8F2E4] opacity-80',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-code text-[11px] font-bold text-[#1F2A5A]">
                    {step.label}
                  </span>
                  {step.done ? (
                    <CheckSquare className="w-4 h-4 text-[#5E8C6A] shrink-0" aria-hidden="true" />
                  ) : (
                    <Square className="w-4 h-4 text-[#465078] shrink-0" aria-hidden="true" />
                  )}
                </div>
                <p className="text-xs text-[#465078] mt-1.5">{step.detail}</p>
                <p className="font-mono-code text-[10px] font-bold mt-2 uppercase text-[#1F2A5A]">
                  {step.done ? 'COMPLETE' : 'PENDING'}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Two-Column Grid: Verification Submission + Verified Attributes */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-[#1F2A5A]/30 pb-2.5">
            <ShieldCheck className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
            <h2 className="font-display text-2xl text-[#1F2A5A]">
              Check University Enrollment
            </h2>
          </div>

          <form onSubmit={handleSubmitVerification} className="space-y-3.5">
            <div>
              <label
                htmlFor="univ-student-id"
                className="block font-mono-code text-xs font-bold uppercase text-[#1F2A5A] mb-1"
              >
                University Student / Roll ID
              </label>
              <input
                id="univ-student-id"
                type="text"
                value={studentCodeInput}
                onChange={(e) => setStudentCodeInput(e.target.value)}
                placeholder="e.g. VV2024CO101"
                required
                className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-sm text-[#1F2A5A] focus:outline-none focus:bg-[#FBE9A6]"
              />
              <p className="text-xs text-[#465078] mt-1">
                Verified server-side against the active institutional provider. Students cannot
                self-approve eligibility.
              </p>
            </div>

            <button
              type="submit"
              disabled={submittingVer}
              className="w-full py-2.5 px-4 bg-[#1F2A5A] text-[#F8F2E4] font-bold text-sm border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#273570] disabled:opacity-60"
            >
              {submittingVer ? 'Checking Institutional Register...' : 'Submit for Verification'}
            </button>
          </form>

          <div className="border-t border-[#1F2A5A]/30 pt-3 text-xs space-y-1.5">
            <p className="font-mono-code font-bold text-[#465078] uppercase">
              Latest Provider Verdict
            </p>
            <p className="text-[#1F2A5A]">{record.reason}</p>
            {record.verified_attributes && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-[#F1E6CF] border border-[#1F2A5A]/40 p-3 mt-2 font-mono-code text-[11px]">
                <div>
                  <dt className="text-[#465078]">Official Name</dt>
                  <dd className="font-bold text-[#1F2A5A]">
                    {record.verified_attributes.official_full_name}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#465078]">Course / Year</dt>
                  <dd className="font-bold text-[#1F2A5A]">
                    {record.verified_attributes.course_branch} · Y
                    {record.verified_attributes.academic_year}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#465078]">Enrollment</dt>
                  <dd className="font-bold text-[#1F2A5A] uppercase">
                    {record.verified_attributes.enrollment_status}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#465078]">Campus Code</dt>
                  <dd className="font-bold text-[#1F2A5A]">
                    {record.verified_attributes.campus_code}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </section>

        {/* Verification Audit History */}
        <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1F2A5A]/30 pb-2.5">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
              <h2 className="font-display text-2xl text-[#1F2A5A]">
                Verification History Ledger
              </h2>
            </div>
            <span className="font-mono-code text-xs text-[#465078] tabular-nums">
              {record.history.length} entry(s)
            </span>
          </div>

          {record.history.length === 0 ? (
            <p className="text-sm text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-4">
              No verification checks have been recorded yet. Submit your University Student ID on
              the left to initiate a check.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-[#1F2A5A] font-mono-code uppercase text-[#465078]">
                    <th className="py-2 pr-3">Timestamp</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Provider</th>
                    <th className="py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2A5A]/20">
                  {record.history.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-2.5 pr-3 font-mono-code whitespace-nowrap tabular-nums text-[#465078]">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-3 font-mono-code font-bold text-[#1F2A5A]">
                        {entry.status}
                        {entry.is_mock_development_record && (
                          <span className="block text-[10px] text-[#B3261E]">DEV MOCK</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-[#1F2A5A]">
                        {entry.provider_name}
                      </td>
                      <td className="py-2.5 text-[#465078]">{entry.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Private Document Vault */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b-2 border-[#1F2A5A] pb-3">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-[#C2552D]" aria-hidden="true" />
            <div>
              <h2 className="font-display text-2xl text-[#1F2A5A]">
                Private Student Document Vault
              </h2>
              <p className="text-xs text-[#465078]">
                Strictly private storage (PDF, JPEG, PNG up to 5 MB). Zero public URLs; every view
                uses a 60-second user-bound signed token and is audit-logged.
              </p>
            </div>
          </div>
          <span className="font-mono-code text-xs font-bold text-[#1F2A5A] tabular-nums">
            {documents.length} file(s) stored
          </span>
        </div>

        <form
          onSubmit={handleUploadDocument}
          className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-[#F1E6CF] border-2 border-[#1F2A5A] p-4 items-end"
        >
          <div className="md:col-span-4">
            <label
              htmlFor="doc-category"
              className="block font-mono-code text-xs font-bold uppercase text-[#1F2A5A] mb-1"
            >
              Document Category
            </label>
            <select
              id="doc-category"
              value={docCategory}
              onChange={(e) => setDocCategory(e.target.value as DocumentCategory)}
              className="w-full px-3 py-2 bg-[#F8F2E4] border-2 border-[#1F2A5A] text-sm text-[#1F2A5A]"
            >
              {(Object.keys(CATEGORY_LABELS) as DocumentCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-5">
            <label
              htmlFor="doc-file"
              className="block font-mono-code text-xs font-bold uppercase text-[#1F2A5A] mb-1"
            >
              Select Document (PDF / JPEG / PNG, Max 5 MB)
            </label>
            <input
              id="doc-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="w-full px-2.5 py-1.5 bg-[#F8F2E4] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
            />
          </div>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={uploadingDoc || !selectedFile}
              className="w-full py-2.5 px-4 bg-[#C2552D] text-[#F8F2E4] font-bold text-sm border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <FileUp className="w-4 h-4" aria-hidden="true" />
              {uploadingDoc ? 'Uploading...' : 'Upload to Vault'}
            </button>
          </div>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-[#1F2A5A] font-mono-code uppercase text-[#465078]">
                <th className="py-2 pr-3">File &amp; Category</th>
                <th className="py-2 pr-3">Format / Size</th>
                <th className="py-2 pr-3">SHA-256</th>
                <th className="py-2 pr-3">Review Status</th>
                <th className="py-2 text-right">Private Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2A5A]/20">
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <FileCheck2 className="w-4 h-4 text-[#1F2A5A] shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-bold text-[#1F2A5A]">{doc.sanitized_filename}</p>
                        <p className="text-[11px] text-[#465078]">
                          {CATEGORY_LABELS[doc.category]}
                          {doc.is_synthetic_placeholder ? ' · Dev Placeholder' : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-3 font-mono-code text-[#465078] tabular-nums">
                    {doc.mime_type}
                    <span className="block">{formatBytes(doc.size_bytes)}</span>
                  </td>
                  <td className="py-3 pr-3 font-mono-code text-[11px] text-[#465078]">
                    {doc.sha256_checksum.slice(0, 14)}…
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className={[
                        'inline-block px-2 py-0.5 font-mono-code text-[11px] font-bold border border-[#1F2A5A]',
                        doc.review_status === 'VERIFIED'
                          ? 'bg-[#5E8C6A] text-[#F8F2E4]'
                          : doc.review_status === 'REJECTED'
                            ? 'bg-[#B3261E] text-[#F8F2E4]'
                            : 'bg-[#FBE9A6] text-[#1F2A5A]',
                      ].join(' ')}
                    >
                      {doc.review_status}
                    </span>
                    {doc.review_note && (
                      <p className="text-[11px] text-[#465078] mt-1 max-w-xs">{doc.review_note}</p>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      disabled={downloadingId === doc.id}
                      onClick={() => void handleSignedDownload(doc)}
                      className="px-3 py-1.5 bg-[#F1E6CF] hover:bg-[#FBE9A6] text-[#1F2A5A] font-bold border border-[#1F2A5A] inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      {downloadingId === doc.id ? 'Signing...' : '60s Signed Download'}
                    </button>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[#465078]">
                    No documents uploaded to your private vault yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
