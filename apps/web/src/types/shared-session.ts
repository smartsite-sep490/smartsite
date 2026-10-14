import type { AccountResponse } from '@smartsite/api-client';

export type SharedSessionUser = Pick<AccountResponse, 'id' | 'displayName' | 'roleAssignments'> & {
  username?: string;
};

export interface SharedSession {
  accessToken: string;
  user: SharedSessionUser;
  sessionScope: string;
  onSignOut?: () => void;
}
