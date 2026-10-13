import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type {
  ContractorParticipationListResponse,
  GlobalContractorSummary,
  Page,
} from '@smartsite/contracts';
import { ContractorEntity } from '../../../database/entities/contractor.entity.js';
import { missing, page, uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { AuthenticatedUser } from '../../auth/auth.service.js';

@Injectable()
export class ContractorParticipationQueryService {
  constructor(private readonly source: DataSource) {}

  private async authorize(m: EntityManager, actor: AuthenticatedUser) {
    if (
      !actor.isActive ||
      actor.mustChangePassword ||
      !actor.roleAssignments.some((r) => r.role === 'ADMIN' && r.siteId === null)
    )
      this.denied();
    const rows = (await m.query(
      `SELECT u.id FROM app_user u JOIN user_role_assignment r ON r.user_id=u.id
       WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password AND r.role='ADMIN' AND r.site_id IS NULL`,
      [actor.id],
    )) as { id: string }[];
    if (!rows.length) this.denied();
  }

  private denied(): never {
    throw new PublicHttpException(403, {
      code: 'FORBIDDEN',
      message: 'Global Admin access is required',
    });
  }

  async contractors(
    actor: AuthenticatedUser,
    offset = 0,
    limit = 20,
  ): Promise<Page<GlobalContractorSummary>> {
    const paging = page(offset, limit);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      await this.authorize(m, actor);
      const [records, total] = await m.getRepository(ContractorEntity).findAndCount({
        order: { name: 'ASC', id: 'ASC' },
        skip: paging.offset,
        take: paging.limit,
      });
      return {
        items: records.map(({ id, code, name, isActive }) => ({ id, code, name, isActive })),
        total,
      };
    });
  }

  async participations(
    actor: AuthenticatedUser,
    value: string,
    offset = 0,
    limit = 20,
  ): Promise<ContractorParticipationListResponse> {
    const contractorId = uuid(value),
      paging = page(offset, limit);
    return this.source.transaction('REPEATABLE READ', async (m) => {
      await this.authorize(m, actor);
      const contractor = await m.getRepository(ContractorEntity).findOneBy({ id: contractorId });
      if (!contractor) missing();
      const [count] = (await m.query(
        'SELECT count(*)::int AS total FROM contractor_site_participation WHERE contractor_id=$1',
        [contractorId],
      )) as { total: number }[];
      const rows = (await m.query(
        `SELECT p.id,s.id AS "siteId",s.name AS "siteName",s.code AS "siteCode",p.valid_from AS "validFrom",p.valid_until AS "validUntil",p.is_active AS "isActive",
        CASE WHEN NOT p.is_active OR NOT c.is_active THEN 'INACTIVE'
        WHEN p.valid_until<=CURRENT_TIMESTAMP THEN 'EXPIRED'
        WHEN p.valid_from>CURRENT_TIMESTAMP THEN 'FUTURE' ELSE 'ACTIVE' END AS status
        FROM contractor_site_participation p JOIN site s ON s.id=p.site_id JOIN contractor c ON c.id=p.contractor_id
        WHERE p.contractor_id=$1 ORDER BY s.name,s.id,p.valid_from,p.id OFFSET $2 LIMIT $3`,
        [contractorId, paging.offset, paging.limit],
      )) as {
        id: string;
        siteId: string;
        siteName: string;
        siteCode: string;
        validFrom: Date;
        validUntil: Date | null;
        isActive: boolean;
        status: ContractorParticipationListResponse['items'][number]['status'];
      }[];
      return {
        contractor: {
          id: contractor.id,
          code: contractor.code,
          name: contractor.name,
          isActive: contractor.isActive,
        },
        items: rows.map((r) => ({
          id: r.id,
          site: { id: r.siteId, code: r.siteCode, name: r.siteName },
          validFrom: r.validFrom.toISOString(),
          validUntil: r.validUntil?.toISOString() ?? null,
          isActive: r.isActive,
          status: r.status,
        })),
        total: count!.total,
      };
    });
  }
}
