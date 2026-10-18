import { useTranslation } from '../../i18n';
import { translate as tr } from '../../i18n';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  SmartSiteManagementClient,
  type AccountResponse,
  type WorkerComplianceStatus,
} from '@smartsite/api-client';
import { API_URL, useAuth } from '../auth/auth-context';
import { useQuery } from '@tanstack/react-query';
import { QueryState, Page, Hint, Button } from '../shared/ui';
export type MobileScope = {
  role: 'worker' | 'contractor';
  siteId: string;
  siteName: string;
  contractorId: string;
  contractorName: string;
};
type Workspace = {
  scope: MobileScope;
  user: AccountResponse;
  client: SmartSiteManagementClient;
  token: string;
  queryKey: readonly unknown[];
  workerId: string;
  workerDocumentStatus?: WorkerComplianceStatus;
};
const WorkspaceContext = createContext<Workspace | null>(null);
export function WorkspaceProvider({
  scope,
  user,
  children,
  onScopeChange,
}: PropsWithChildren<{ scope: MobileScope; user: AccountResponse; onScopeChange: () => void }>) {
  useTranslation();
  const { session, epoch, token } = useAuth();
  const [controller] = useState(() => new AbortController());
  useEffect(() => {
    const signal = session.adapter(epoch).signal;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    return () => {
      signal.removeEventListener('abort', abort);
      controller.abort();
    };
  }, [session, epoch, controller]);
  const client = useMemo(() => {
    const adapter = session.adapter(epoch);
    return new SmartSiteManagementClient(API_URL, { ...adapter, signal: controller.signal });
  }, [session, epoch, controller]);
  const queryKey = [
    'mobile',
    user.id,
    epoch,
    scope.siteId,
    scope.role,
    scope.contractorId,
  ] as const;
  const self = useQuery({
    queryKey: [...queryKey, 'self'],
    queryFn: () => client.myContractorTeam(token, scope.siteId),
    enabled: scope.role === 'worker',
  });
  const compliance = useQuery({
    queryKey: [...queryKey, 'worker-documents', self.data?.workerId],
    queryFn: () => client.workerCompliance(token, scope.siteId, self.data!.workerId),
    enabled: scope.role === 'worker' && !!self.data?.workerId,
    refetchInterval: 60_000,
  });
  const content = (
    <WorkspaceContext.Provider
      value={{
        scope,
        user,
        client,
        token,
        queryKey,
        workerId: self.data?.workerId ?? '',
        workerDocumentStatus: compliance.data?.status,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
  if (scope.role === 'worker' && !self.isSuccess)
    return (
      <Page title={tr('workforce.workerProfile')}>
        <QueryState query={self}>{() => null}</QueryState>
        <Button secondary label={tr('scope.chooseAgain')} onPress={onScopeChange} />
      </Page>
    );
  if (scope.role === 'worker')
    return (
      <QueryState query={self}>
        {(data) =>
          data.workerId ? (
            content
          ) : (
            <Page title={tr('scope.noWorkerProfile')}>
              <Hint>{tr('scope.linkWorkerHint')}</Hint>
            </Page>
          )
        }
      </QueryState>
    );
  return content;
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace missing');
  return value;
}
