import type {
  AccountResponse,
  ChecklistDetailResponse,
  IncidentDetailResponse,
  SafetyAlertDetailResponse,
  SafetyAlertWorkContextResponse,
} from '@smartsite/api-client';

export const siteId = '11111111-1111-4111-8111-111111111111';
export const contractorId = '22222222-2222-4222-8222-222222222222';
export const safetyId = '55555555-5555-4555-8555-555555555551';
export const repId = '55555555-5555-4555-8555-555555555552';
const uuid = (group: string, index: number) =>
  `${group.repeat(8)}-${group.repeat(4)}-4${group.repeat(3)}-8${group.repeat(3)}-${String(index).padStart(12, '0')}`;
const stamp = '2026-11-22T01:27:00Z';
export function createSafetyFixture() {
  let role: 'SAFETY_OFFICER' | 'CONTRACTOR_REPRESENTATIVE' = 'SAFETY_OFFICER';
  const site = { id: siteId, code: 'QA', name: 'Công trường kiểm thử SmartSite', createdAt: stamp };
  const user = (): AccountResponse => ({
    id: role === 'SAFETY_OFFICER' ? safetyId : repId,
    username: role === 'SAFETY_OFFICER' ? 'qa.safety' : 'qa.contractor',
    displayName:
      role === 'SAFETY_OFFICER' ? 'Cán bộ an toàn kiểm thử' : 'Đại diện nhà thầu kiểm thử',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role, siteId }],
  });
  const incidents: IncidentDetailResponse[] = Array.from({ length: 48 }, (_, index) => ({
    id: uuid('6', index + 1),
    siteId,
    contractorId,
    contractorName: 'Nhà thầu kiểm thử Đông Phú',
    title:
      index === 0
        ? 'Khắc phục rào chắn tại sảnh tầng 1'
        : `Kiểm tra an toàn khu vực thi công ${index + 1}`,
    description:
      'Kiểm tra rào chắn, nhắc lại quy định bảo hộ và ghi nhận kết quả sau khi khắc phục. Đây là dữ liệu kiểm thử.',
    severity: index % 2 ? 'MEDIUM' : 'HIGH',
    status: index === 0 ? 'IN_PROGRESS' : 'ASSIGNED',
    zoneId: null,
    zoneName: null,
    occurredAt: stamp,
    reportedBy: safetyId,
    reportedByName: 'Cán bộ an toàn kiểm thử',
    closedBy: null,
    closedAt: null,
    responsibilityReason: 'Đã xác nhận với đại diện nhà thầu trong bộ dữ liệu kiểm thử.',
    responsibilityConfirmedBy: safetyId,
    responsibilityConfirmedAt: stamp,
    workerIds: [],
    workers: [],
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    alerts: [],
    audit: [],
    actions: [
      {
        id: uuid('7', index + 1),
        incidentId: uuid('6', index + 1),
        assignedTo: repId,
        assignedToName: 'Đại diện nhà thầu kiểm thử',
        assignedBy: safetyId,
        description: 'Bổ sung rào chắn và gửi kết quả sau khi khắc phục.',
        dueAt: '2026-11-23T02:00:00Z',
        status: index === 0 ? 'SUBMITTED' : 'ASSIGNED',
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
        submissions:
          index === 0
            ? [
                {
                  id: uuid('8', 1),
                  correctiveActionId: uuid('7', 1),
                  submittedBy: repId,
                  submittedByName: 'Đại diện nhà thầu kiểm thử',
                  resultDescription: 'Tổ thi công đã bổ sung rào chắn và kiểm tra trang bị đầu ca.',
                  submittedAt: stamp,
                  status: 'PENDING',
                  reviewedBy: null,
                  reviewedAt: null,
                  reviewNote: null,
                  evidence: null,
                },
              ]
            : [],
      },
    ],
  }));
  const alerts: SafetyAlertDetailResponse[] = Array.from({ length: 48 }, (_, index) => ({
    id: uuid('9', index + 1),
    siteId,
    zoneId: index < 2 ? uuid('4', 1) : null,
    candidateWorkerId: null,
    alertType: 'PPE_VIOLATION',
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
    status: index < 24 ? 'CONFIRMED' : 'PENDING_REVIEW',
    firstDetectedAt: stamp,
    lastDetectedAt: stamp,
    detectionCount: index === 0 ? 1 : 0,
    revision: 1,
    createdAt: stamp,
    updatedAt: stamp,
    detections:
      index === 0
        ? [
            {
              eventId: uuid('3', 1),
              cameraExternalId: 'qa-lobby-camera',
              capturedAt: stamp,
              processingStatus: 'PROCESSED',
              evidence: [],
            },
          ]
        : [],
    detectionsTotal: index === 0 ? 1 : 0,
    reviews: [],
    reviewsTotal: 0,
  }));
  const alertContexts: SafetyAlertWorkContextResponse[] = alerts.map((_, index) => ({
    capturedAt: stamp,
    identity: 'UNKNOWN',
    workers: [],
    relatedTeams: [],
    zoneName: index < 2 ? 'Sảnh tầng 1 (kiểm thử)' : null,
    cameraName: index === 0 ? 'Camera sảnh (kiểm thử)' : null,
    warning: '',
  }));
  const checklists: ChecklistDetailResponse[] = [
    {
      id: uuid('a', 1),
      siteId,
      contractorId,
      contractorName: 'Nhà thầu kiểm thử Đông Phú',
      teamId: uuid('b', 1),
      teamName: 'Tổ kiểm thử',
      zoneId: uuid('4', 1),
      zoneName: 'Sảnh kiểm thử',
      assignedTo: repId,
      assignedToName: 'Đại diện nhà thầu kiểm thử',
      assignedBy: safetyId,
      assignedByName: 'Cán bộ an toàn kiểm thử',
      description: 'Inspect the synthetic barrier',
      startsAt: stamp,
      endsAt: '2026-12-23T02:00:00Z',
      status: 'ASSIGNED',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
      items: [
        { id: uuid('c', 1), position: 0, text: 'Barrier installed', evidenceRequired: false },
      ],
      submissions: [],
      audit: [],
    },
  ];
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const response = (data: unknown, status = 200) => ({ data, status });
  return {
    site,
    incidents,
    checklists,
    alerts,
    alertContexts,
    requests,
    user,
    setRole: (next: typeof role) => {
      role = next;
    },
    handle(method: string, url: string, body: Record<string, unknown> = {}) {
      const parsed = new URL(url, 'http://qa.local'),
        path = parsed.pathname.replace(/^\/api\/v1/, '');
      requests.push({ method, path, body });
      if (path === '/auth/me') return response(user());
      if (path === '/auth/login' || path === '/auth/refresh')
        return response({
          accessToken: 'synthetic-browser-token',
          tokenType: 'Bearer',
          accessTokenExpiresAt: '2099-01-01T00:00:00Z',
          refreshTokenExpiresAt: '2099-01-02T00:00:00Z',
          user: user(),
        });
      if (path === '/health') return response({ status: 'ok' });
      if (path === '/sites') return response({ items: [site], total: 1 });
      if (path.endsWith('/safety-assignees'))
        return response({
          items: [{ id: repId, displayName: 'Đại diện nhà thầu kiểm thử' }],
          total: 1,
        });
      if (path.endsWith('/safety-contractors'))
        return response({
          items: [{ id: contractorId, name: 'Nhà thầu kiểm thử Đông Phú' }],
          total: 1,
        });
      if (path.endsWith('/worker-compliance')) return response({ items: [], total: 0 });
      if (path.endsWith('/safety-overview'))
        return response({
          site,
          date: '2026-11-22',
          timezone: 'Asia/Ho_Chi_Minh',
          teams: { items: [], total: 0 },
          unassignedWorkers: { items: [], total: 0 },
        });
      if (path.endsWith('/safety-overview/week'))
        return response({
          site,
          weekStart: '2026-11-16',
          weekEnd: '2026-11-22',
          timezone: 'Asia/Ho_Chi_Minh',
          updatedAt: stamp,
          teams: { items: [], total: 0 },
        });
      if (method === 'GET' && path.endsWith('/work-context')) {
        const index = alerts.findIndex((item) => path.includes('/safety-alerts/' + item.id + '/'));
        return index >= 0
          ? response(alertContexts[index])
          : response({ message: 'Not available' }, 404);
      }
      if (method === 'GET' && path.endsWith('/identity-subjects')) {
        return response({
          eventId: uuid('3', 1),
          payloadHash: '0123456789abcdef'.repeat(4),
          eventConsistent: true,
          frames: [],
          subjects: [],
        });
      }
      if (method === 'GET' && path.includes('/safety-alerts')) {
        const alert = alerts.find((item) => path.endsWith('/safety-alerts/' + item.id));
        if (alert) return response(alert);
        const offset = Number(parsed.searchParams.get('offset') ?? 0),
          limit = Number(parsed.searchParams.get('limit') ?? 20);
        const status = parsed.searchParams.get('status');
        const filtered = status ? alerts.filter((item) => item.status === status) : alerts;
        return response({ items: filtered.slice(offset, offset + limit), total: filtered.length });
      }
      if (path.includes('/safety-checklists')) {
        const checklist = checklists.find((item) => path.includes('/safety-checklists/' + item.id));
        if (method === 'GET')
          return response(checklist ?? { items: checklists, total: checklists.length });
        if (!checklist) return response({ message: 'Not available' }, 404);
        if (path.endsWith('/start')) checklist.status = 'IN_PROGRESS';
        if (path.endsWith('/submissions')) {
          checklist.status = 'SUBMITTED';
          const results =
            typeof body.results === 'string' ? JSON.parse(body.results) : body.results;
          checklist.submissions.push({
            id: uuid('d', requests.length),
            submittedBy: repId,
            submittedByName: 'Đại diện nhà thầu kiểm thử',
            submittedAt: stamp,
            status: 'PENDING',
            reviewedBy: null,
            reviewedByName: null,
            reviewedAt: null,
            reviewNote: null,
            results: (results as { itemId: string; answer: 'PASS'; note?: string }[]).map(
              (item, i) => ({
                id: uuid('e', i + 1),
                ...item,
                note: item.note ?? '',
                evidence: [],
                incidentId: null,
              }),
            ),
          });
        }
        checklist.version++;
        return response({ resource: checklist, replayed: false });
      }
      const incident = incidents.find((item) => path.includes('/incidents/' + item.id));
      if (incident && method === 'GET') return response(incident);
      if (incident && method === 'POST') {
        if (path.endsWith('/responsibility')) {
          incident.contractorId = String(body.contractorId);
          incident.contractorName = 'Nhà thầu kiểm thử Đông Phú';
          incident.responsibilityReason = String(body.reason);
          incident.responsibilityConfirmedBy = safetyId;
          incident.responsibilityConfirmedAt = stamp;
          incident.version++;
        }

        const action = incident.actions.find((item) => path.includes('/actions/' + item.id));
        if (action) {
          if (path.endsWith('/start')) {
            action.status = 'IN_PROGRESS';
            incident.status = 'IN_PROGRESS';
          }
          if (path.endsWith('/submissions')) {
            action.status = 'SUBMITTED';
            action.submissions.push({
              id: uuid('8', requests.length),
              correctiveActionId: action.id,
              submittedBy: repId,
              resultDescription: String(body.resultDescription ?? 'Synthetic result'),
              submittedAt: stamp,
              status: 'PENDING',
              reviewedBy: null,
              reviewedAt: null,
              reviewNote: null,
              evidence: null,
            });
          }
          if (path.endsWith('/reviews')) {
            const submission = action.submissions.find((item) => item.id === body.submissionId);
            if (submission) {
              submission.status = body.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
              submission.reviewNote = String(body.reason ?? '');
              submission.reviewedBy = safetyId;
              submission.reviewedAt = stamp;
            }
            action.status = body.decision === 'APPROVED' ? 'CLOSED' : 'IN_PROGRESS';
            if (action.status === 'CLOSED') incident.status = 'CLOSED';
          }
          action.version++;
          incident.version++;
        }
        if (path.endsWith('/actions') && !action)
          incident.actions.push({
            ...(incident.actions[0] ?? incidents[1]!.actions[0]!),
            id: uuid('7', requests.length + 100),
            description: String(body.description),
            assignedTo: String(body.assignedTo),
            status: 'ASSIGNED',
            submissions: [],
            version: 1,
          });
        return response({ resource: incident, replayed: false });
      }
      if (path.endsWith('/incidents')) {
        if (method === 'GET') {
          const offset = Number(parsed.searchParams.get('offset') ?? 0),
            limit = Number(parsed.searchParams.get('limit') ?? 20);
          return response({
            items: incidents.slice(offset, offset + limit),
            total: incidents.length,
          });
        }
        const created = {
          ...incidents[1]!,
          id: uuid('6', incidents.length + 1),
          title: String(body.title),
          description: String(body.description),
          actions: [],
          status: 'OPEN' as const,
        };
        incidents.unshift(created);
        return response({ resource: created, replayed: false }, 201);
      }
      if (path.endsWith('/contractor-scopes') || path.endsWith('/dashboard/scopes'))
        return response({
          items: [
            {
              siteId,
              siteName: site.name,
              contractorId,
              contractorName: 'Nhà thầu kiểm thử Đông Phú',
            },
          ],
          total: 1,
        });
      return response({ items: [], total: 0, unreadCount: 0 });
    },
  };
}
