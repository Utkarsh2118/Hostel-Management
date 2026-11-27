import type { AuthUserProfile } from '../auth/roles.ts';
import { canAccessBlock } from '../auth/permissions.ts';
import type { IHostelRepository } from '../repo/interface.ts';
import type { MaintenanceTaskService } from '../maintenance/store.ts';
import type { HostelOperationsService } from '../operations/service.ts';
import type { HostelFinanceService } from '../finance/service.ts';

export type ExportDataset = 'occupancy' | 'fees' | 'complaints' | 'gate_passes';

export interface BlockReportRow {
  block_id: string;
  block_code: string;
  block_name: string;
  gender_type: 'boys' | 'girls';
  total_rooms: number;
  total_beds: number;
  occupied_beds: number;
  vacant_beds: number;
  occupancy_pct: number;
  open_complaints: number;
  active_maintenance_tasks: number;
  billed_inr: number;
  collected_inr: number;
  outstanding_inr: number;
}

export interface InstitutionalReportSummary {
  generated_at: string;
  scope: 'INSTITUTION_WIDE' | 'ASSIGNED_BLOCKS';
  totals: {
    blocks_in_scope: number;
    total_beds: number;
    occupied_beds: number;
    vacant_beds: number;
    occupancy_pct: number;
    open_complaints: number;
    active_gate_passes: number;
    scheduled_or_active_visitors: number;
    open_maintenance_tasks: number;
    total_billed_inr: number;
    total_collected_inr: number;
    total_outstanding_inr: number;
    pending_payment_verifications: number;
  };
  blocks: BlockReportRow[];
}

export class ReportingError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ReportingError';
  }
}

/**
 * Neutralizes CSV/Excel formula injection (=, +, -, @, tab, CR) and escapes RFC 4180 quotes.
 */
export function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const trimmedStart = raw.replace(/^[\t\r\n ]+/, '');
  const needsFormulaGuard =
    trimmedStart.startsWith('=') ||
    trimmedStart.startsWith('+') ||
    trimmedStart.startsWith('-') ||
    trimmedStart.startsWith('@') ||
    raw.startsWith('\t') ||
    raw.startsWith('\r');
  const guarded = needsFormulaGuard ? `'${raw}` : raw;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function buildCsvDocument(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const headerLine = headers.map((h) => sanitizeCsvCell(h)).join(',');
  const bodyLines = rows.map((row) => row.map((cell) => sanitizeCsvCell(cell)).join(','));
  return [headerLine, ...bodyLines].join('\r\n') + '\r\n';
}

/**
 * Phase 5 — Institutional Reporting & Audited CSV Export Service
 * ==============================================================
 * - Accessible strictly to WARDEN (block-scoped) and ADMIN (institution-wide).
 * - Denies STUDENT and MAINTENANCE_STAFF unconditionally (403).
 * - Sanitizes all CSV exports against spreadsheet formula injection and logs every export.
 */
export class InstitutionalReportingService {
  constructor(
    private readonly repo: IHostelRepository,
    private readonly maintenanceService: MaintenanceTaskService,
    private readonly operationsService: HostelOperationsService,
    private readonly financeService: HostelFinanceService
  ) {}

  private assertAuthorized(actor: AuthUserProfile): void {
    if (actor.role !== 'WARDEN' && actor.role !== 'ADMIN') {
      throw new ReportingError(
        'Forbidden: Institutional reports and exports are restricted to Wardens and Administrators.',
        403
      );
    }
  }

  public async getSummary(actor: AuthUserProfile): Promise<InstitutionalReportSummary> {
    this.assertAuthorized(actor);

    const [blocks, rooms, complaints, gatePasses, visitors, invoices] = await Promise.all([
      this.repo.getBlocks(),
      this.repo.getRooms(),
      this.operationsService.listComplaints(actor),
      this.operationsService.listGatePasses(actor),
      this.operationsService.listVisitors(actor),
      this.financeService.listInvoices(actor),
    ]);
    const maintenanceTasks = this.maintenanceService.listTasksForUser(actor);

    const scopedBlocks =
      actor.role === 'ADMIN' ? blocks : blocks.filter((b) => canAccessBlock(actor, b.id));

    const blockRows: BlockReportRow[] = scopedBlocks.map((block) => {
      const blkRooms = rooms.filter((r) => r.block_id === block.id);
      const totalBeds = blkRooms.reduce((s, r) => s + r.capacity, 0);
      const occupiedBeds = blkRooms.reduce((s, r) => s + r.occupants.length, 0);
      const vacantBeds = Math.max(0, totalBeds - occupiedBeds);
      const openComplaints = complaints.filter(
        (c) => c.block_id === block.id && c.status !== 'RESOLVED' && c.status !== 'CLOSED'
      ).length;
      const activeMaint = maintenanceTasks.filter(
        (m) => m.block_id === block.id && m.status !== 'resolved' && m.status !== 'closed'
      ).length;
      const blkInvoices = invoices.filter((inv) => inv.block_id === block.id);
      const billed = blkInvoices.reduce((s, inv) => s + inv.total_payable_inr, 0);
      const collected = blkInvoices.reduce((s, inv) => s + inv.paid_inr, 0);
      const outstanding = blkInvoices.reduce((s, inv) => s + inv.balance_due_inr, 0);

      return {
        block_id: block.id,
        block_code: block.code,
        block_name: block.name,
        gender_type: block.gender_type,
        total_rooms: blkRooms.length,
        total_beds: totalBeds,
        occupied_beds: occupiedBeds,
        vacant_beds: vacantBeds,
        occupancy_pct: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : 0,
        open_complaints: openComplaints,
        active_maintenance_tasks: activeMaint,
        billed_inr: billed,
        collected_inr: collected,
        outstanding_inr: outstanding,
      };
    });

    const totalBeds = blockRows.reduce((s, b) => s + b.total_beds, 0);
    const occupiedBeds = blockRows.reduce((s, b) => s + b.occupied_beds, 0);
    const totalBilled = invoices.reduce((s, inv) => s + inv.total_payable_inr, 0);
    const totalCollected = invoices.reduce((s, inv) => s + inv.paid_inr, 0);
    const totalOutstanding = invoices.reduce((s, inv) => s + inv.balance_due_inr, 0);
    const pendingVerifications = invoices.reduce(
      (s, inv) =>
        s + inv.payments.filter((p) => p.status === 'SUBMITTED_FOR_VERIFICATION').length,
      0
    );

    return {
      generated_at: new Date().toISOString(),
      scope: actor.role === 'ADMIN' ? 'INSTITUTION_WIDE' : 'ASSIGNED_BLOCKS',
      totals: {
        blocks_in_scope: blockRows.length,
        total_beds: totalBeds,
        occupied_beds: occupiedBeds,
        vacant_beds: Math.max(0, totalBeds - occupiedBeds),
        occupancy_pct: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : 0,
        open_complaints: complaints.filter(
          (c) => c.status !== 'RESOLVED' && c.status !== 'CLOSED'
        ).length,
        active_gate_passes: gatePasses.filter(
          (g) => g.status === 'PENDING' || g.status === 'APPROVED' || g.status === 'CHECKED_OUT_GATE'
        ).length,
        scheduled_or_active_visitors: visitors.filter(
          (v) => v.status === 'SCHEDULED' || v.status === 'CHECKED_IN'
        ).length,
        open_maintenance_tasks: maintenanceTasks.filter(
          (m) => m.status !== 'resolved' && m.status !== 'closed'
        ).length,
        total_billed_inr: totalBilled,
        total_collected_inr: totalCollected,
        total_outstanding_inr: totalOutstanding,
        pending_payment_verifications: pendingVerifications,
      },
      blocks: blockRows,
    };
  }

  public async exportDatasetCsv(
    actor: AuthUserProfile,
    dataset: ExportDataset
  ): Promise<{ filename: string; csv: string; row_count: number }> {
    this.assertAuthorized(actor);
    const stamp = new Date().toISOString().slice(0, 10);
    let csv = '';
    let rowCount = 0;

    if (dataset === 'occupancy') {
      const summary = await this.getSummary(actor);
      const headers = [
        'Block Code',
        'Block Name',
        'Category',
        'Total Rooms',
        'Total Beds',
        'Occupied Beds',
        'Vacant Beds',
        'Occupancy %',
      ];
      const rows = summary.blocks.map((b) => [
        b.block_code,
        b.block_name,
        b.gender_type,
        b.total_rooms,
        b.total_beds,
        b.occupied_beds,
        b.vacant_beds,
        b.occupancy_pct,
      ]);
      csv = buildCsvDocument(headers, rows);
      rowCount = rows.length;
    } else if (dataset === 'fees') {
      const invoices = await this.financeService.listInvoices(actor);
      const headers = [
        'Invoice Code',
        'Term',
        'Student Code',
        'Student Name',
        'Block',
        'Room',
        'Due Date',
        'Total Payable (INR)',
        'Verified Paid (INR)',
        'Balance Due (INR)',
        'Status',
      ];
      const rows = invoices.map((inv) => [
        inv.invoice_code,
        inv.academic_term,
        inv.student_code,
        inv.student_name,
        inv.block_name,
        inv.room_label,
        inv.due_date,
        inv.total_payable_inr,
        inv.paid_inr,
        inv.balance_due_inr,
        inv.status,
      ]);
      csv = buildCsvDocument(headers, rows);
      rowCount = rows.length;
    } else if (dataset === 'complaints') {
      const complaints = await this.operationsService.listComplaints(actor);
      const headers = [
        'Complaint Code',
        'Block',
        'Room',
        'Student Code',
        'Category',
        'Priority',
        'Subject',
        'Status',
        'Maintenance Ticket',
        'Created At',
      ];
      const rows = complaints.map((c) => [
        c.complaint_code,
        c.block_name,
        c.room_number,
        c.student_code,
        c.category,
        c.priority,
        c.subject,
        c.status,
        c.escalated_ticket_code ?? '',
        c.created_at,
      ]);
      csv = buildCsvDocument(headers, rows);
      rowCount = rows.length;
    } else {
      const passes = await this.operationsService.listGatePasses(actor);
      const headers = [
        'Pass Code',
        'Student Code',
        'Student Name',
        'Block',
        'Room',
        'Type',
        'Destination',
        'Departure',
        'Expected Return',
        'Status',
      ];
      const rows = passes.map((g) => [
        g.pass_code ?? 'PENDING',
        g.student_code,
        g.student_name,
        g.block_name,
        g.room_label,
        g.pass_type,
        g.destination,
        g.departure_at,
        g.expected_return_at,
        g.status,
      ]);
      csv = buildCsvDocument(headers, rows);
      rowCount = rows.length;
    }

    await this.repo.appendAuditLog(actor.email, actor.role, 'INSTITUTIONAL_REPORT_EXPORTED', {
      dataset,
      row_count: rowCount,
      scope: actor.role === 'ADMIN' ? 'INSTITUTION_WIDE' : 'ASSIGNED_BLOCKS',
    });

    return {
      filename: `hostelhub-${dataset}-${stamp}.csv`,
      csv,
      row_count: rowCount,
    };
  }
}

let sharedReportingService: InstitutionalReportingService | null = null;

export function getReportingService(
  repo: IHostelRepository,
  maintenanceService: MaintenanceTaskService,
  operationsService: HostelOperationsService,
  financeService: HostelFinanceService
): InstitutionalReportingService {
  if (!sharedReportingService) {
    sharedReportingService = new InstitutionalReportingService(
      repo,
      maintenanceService,
      operationsService,
      financeService
    );
  }
  return sharedReportingService;
}
