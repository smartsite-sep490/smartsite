import { Injectable } from '@nestjs/common';
import type {
  ContractorParticipationListResponse,
  GlobalContractorSummary,
  Page,
} from '@smartsite/contracts';
import { page, uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { AuthenticatedUser } from '../../auth/auth.service.js';

/** Retain the old directory routes so old clients receive an explicit denial. */
@Injectable()
export class ContractorParticipationQueryService {
  private denied(actor: AuthenticatedUser): never {
    throw new PublicHttpException(403, {
      code: actor.mustChangePassword ? 'PASSWORD_CHANGE_REQUIRED' : 'FORBIDDEN',
      message: 'Global contractor directory is unavailable',
    });
  }
  async contractors(
    actor: AuthenticatedUser,
    offset = 0,
    limit = 20,
  ): Promise<Page<GlobalContractorSummary>> {
    page(offset, limit);
    return this.denied(actor);
  }
  async participations(
    actor: AuthenticatedUser,
    contractorId: string,
    offset = 0,
    limit = 20,
  ): Promise<ContractorParticipationListResponse> {
    uuid(contractorId);
    page(offset, limit);
    return this.denied(actor);
  }
}
