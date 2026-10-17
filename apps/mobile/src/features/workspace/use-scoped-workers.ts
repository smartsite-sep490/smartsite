import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from './workspace-context';
import { allPages } from '../shared/data';
export function useScopedWorkers() {
  const { client, token, scope, workerId, queryKey } = useWorkspace();
  return useQuery({
    queryKey: [...queryKey, 'scoped-workers'],
    queryFn: async ({ signal }) =>
      (await allPages((p) => client.listWorkers(token, scope.siteId, p), signal)).filter((w) =>
        scope.role === 'worker' ? w.id === workerId : w.contractorId === scope.contractorId,
      ),
  });
}
