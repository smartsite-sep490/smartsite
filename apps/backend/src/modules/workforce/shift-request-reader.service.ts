import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ShiftRequestListResponse, ShiftRequestResponse } from '@smartsite/contracts';
import { command, page, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ShiftRequestListDto } from './dto/shift-request-list.dto.js';
import { hasActiveContractorParticipation } from './contractor-participation.js';

@Injectable()
export class ShiftRequestReaderService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    actor: AuthenticatedUser,
    siteId: string,
    input: ShiftRequestListDto,
  ): Promise<ShiftRequestListResponse> {
    const site = uuid(siteId).toLowerCase();
    const query = command(ShiftRequestListDto, input);
    const paging = page(Number(query.offset ?? '0'), Number(query.limit ?? '20'));
    const workerView = query.view === 'WORKER' || query.view === 'INCOMING';
    const role = workerView ? UserRole.WORKER : UserRole.CONTRACTOR_REPRESENTATIVE;
    const deny = () => {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'You no longer have access to these shift requests.',
      });
    };
    if (
      !actor.isActive ||
      actor.mustChangePassword ||
      !actor.roleAssignments.some((a) => a.siteId === site && a.role === role)
    )
      deny();
    let workerId: string | null = null;
    if (workerView) {
      const worker = await this.dataSource
        .getRepository(WorkerEntity)
        .findOneBy({ siteId: site, userId: actor.id, isActive: true });
      if (
        !worker?.contractorId ||
        !(await hasActiveContractorParticipation(
          this.dataSource.manager,
          worker.contractorId,
          site,
        ))
      )
        deny();
      workerId = worker!.id;
    }
    const eligible = await this.dataSource.query(
      `SELECT 1 FROM app_user u
      JOIN user_role_assignment r ON r.user_id = u.id AND r.site_id = $2 AND r.role = $3
      WHERE u.id = $1 AND u.is_active AND ($4::uuid IS NOT NULL OR EXISTS (
        SELECT 1 FROM contractor_representative_assignment a
        JOIN contractor c ON c.id = a.contractor_id AND c.is_active
        JOIN contractor_site_participation p ON p.contractor_id = a.contractor_id AND p.site_id = a.site_id
        WHERE a.user_id = u.id AND a.site_id = $2 AND p.is_active AND p.valid_from <= CURRENT_TIMESTAMP
          AND (p.valid_until IS NULL OR p.valid_until > CURRENT_TIMESTAMP)))`,
      [actor.id, site, role, workerId],
    );
    if (!eligible.length) deny();
    // Scope, filters, mixed ordering, count and pagination are all evaluated by PostgreSQL.
    const [result] = (await this.dataSource.query(
      `
      WITH requests AS (
        SELECT c.id, c.site_id, c.status::text AS status, c.created_at, 'CHANGE' AS request_type,
          c.worker_id AS worker_id, NULL::uuid AS coworker_worker_id,
          ARRAY[c.worker_schedule_id] AS schedule_ids, c.reason, to_jsonb(c) AS payload
        FROM shift_change_request c WHERE c.site_id = $1
        UNION ALL
        SELECT s.id, s.site_id, s.status::text, s.created_at, 'SWAP',
          s.requester_worker_id, s.coworker_worker_id,
          ARRAY[s.requester_worker_schedule_id, s.coworker_worker_schedule_id], s.reason, to_jsonb(s)
        FROM shift_swap_request s WHERE s.site_id = $1
      ), scoped AS (
        SELECT r.*, w.display_name, cw.display_name AS coworker_name
        FROM requests r JOIN worker w ON w.id = r.worker_id AND w.site_id = r.site_id AND w.is_active
        LEFT JOIN worker cw ON cw.id = r.coworker_worker_id AND cw.site_id = r.site_id
        WHERE (r.coworker_worker_id IS NULL OR (cw.is_active AND cw.contractor_id = w.contractor_id))
          AND EXISTS (SELECT 1 FROM contractor c WHERE c.id = w.contractor_id AND c.is_active)
          AND EXISTS (SELECT 1 FROM contractor_site_participation p WHERE p.site_id = r.site_id
            AND p.contractor_id = w.contractor_id AND p.is_active AND p.valid_from <= CURRENT_TIMESTAMP
            AND (p.valid_until IS NULL OR p.valid_until > CURRENT_TIMESTAMP))
          AND EXISTS (SELECT 1 FROM user_role_assignment a WHERE a.user_id = $2 AND a.site_id = r.site_id AND a.role = $4)
          AND (($3::uuid IS NOT NULL AND (r.worker_id = $3 OR r.coworker_worker_id = $3)
            AND EXISTS (SELECT 1 FROM worker me WHERE me.id = $3 AND me.user_id = $2 AND me.site_id = r.site_id AND me.is_active))
            OR ($3::uuid IS NULL AND EXISTS (SELECT 1 FROM contractor_representative_assignment a
              WHERE a.user_id = $2 AND a.site_id = r.site_id AND a.contractor_id = w.contractor_id)))
      ), filtered AS (
        SELECT * FROM scoped WHERE
          ($5 = 'WORKER' OR ($5 = 'INCOMING' AND status = 'PENDING_COWORKER' AND coworker_worker_id = $3)
            OR ($5 = 'REVIEW' AND status = 'PENDING_MANAGER')
            OR ($5 = 'HISTORY' AND status NOT IN ('DRAFT', 'PENDING_COWORKER', 'PENDING_MANAGER')))
          AND ($6 = 'ALL' OR request_type = $6)
          AND ($7 = '' OR strpos(lower(reason), $7) > 0 OR strpos(lower(display_name), $7) > 0 OR strpos(lower(coalesce(coworker_name, '')), $7) > 0)
      ), paged AS (
        SELECT * FROM filtered ORDER BY created_at DESC, id ASC, request_type ASC LIMIT $8 OFFSET $9
      )
      SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('payload', payload, 'requestType', request_type)
        ORDER BY created_at DESC, id ASC, request_type ASC) FROM paged), '[]'::jsonb) AS items,
        (SELECT count(*)::integer FROM filtered) AS total,
        (SELECT count(*)::integer FROM scoped WHERE status = 'PENDING_MANAGER'
          OR ($3::uuid IS NOT NULL AND status = 'PENDING_COWORKER')) AS "pendingCount",
        (SELECT count(*)::integer FROM scoped WHERE status = 'PENDING_COWORKER' AND coworker_worker_id = $3) AS "incomingCount",
        coalesce((SELECT jsonb_agg(DISTINCT sid) FROM scoped CROSS JOIN unnest(schedule_ids) sid
          WHERE $3::uuid IS NOT NULL AND status IN ('PENDING_COWORKER', 'PENDING_MANAGER')), '[]'::jsonb) AS "pendingScheduleIds"
    `,
      [
        site,
        actor.id,
        workerId,
        role,
        query.view,
        query.requestType ?? 'ALL',
        query.search?.trim().toLowerCase() ?? '',
        paging.limit,
        paging.offset,
      ],
    )) as Array<{
      items: Array<{ payload: Record<string, unknown>; requestType: 'CHANGE' | 'SWAP' }>;
      total: number;
      pendingCount: number;
      incomingCount: number;
      pendingScheduleIds: string[];
    }>;
    const common = [
      'id',
      'site_id',
      'expected_schedule_version_id',
      'status',
      'requested_by_user_id',
      'reason',
      'reviewed_by_user_id',
      'reviewed_at',
      'review_reason',
      'applied_at',
      'created_at',
    ];
    return {
      ...result!,
      items: result!.items.map(({ payload, requestType }) => {
        const fields =
          requestType === 'CHANGE'
            ? ['worker_id', 'worker_schedule_id', 'from_shift_id', 'to_shift_id']
            : [
                'requester_worker_id',
                'requester_worker_schedule_id',
                'coworker_worker_id',
                'coworker_worker_schedule_id',
                'requester_shift_id',
                'coworker_shift_id',
                'coworker_confirmed_at',
              ];
        return {
          ...Object.fromEntries(
            [...common, ...fields].map((key) => [
              key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
              payload[key],
            ]),
          ),
          requestType,
        } as ShiftRequestResponse;
      }),
    };
  }
}
