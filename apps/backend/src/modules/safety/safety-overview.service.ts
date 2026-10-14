import { Injectable } from '@nestjs/common';
import type {
  SafetyOverviewQuery,
  SafetyAlertWorkContextResponse,
  SafetyOverviewTeam,
  SafetyChecklistSummary,
  SafetyTeamDetailResponse,
} from '@smartsite/contracts';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import {
  SafetyWorkContextService,
  safetyTeamZoneContextSql,
} from '../workforce/management/safety-work-context.service.js';
import { CameraConfigurationService } from '../cameras/camera-configuration.service.js';
import { SafetyWorkflowService } from './safety-workflow.service.js';
import { SafetyAlertEntity } from '../../database/entities/safety-alert.entity.js';
import { attentionAlertSql } from './alerts/safety-alert-query.service.js';
import { SafetyAlertEvidenceService } from './alerts/safety-alert-evidence.service.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { missing, uuid } from '../../common/configuration/commands.js';
@Injectable()
export class SafetyOverviewService {
  constructor(
    private readonly workforce: SafetyWorkContextService,
    private readonly cameras: CameraConfigurationService,
    private readonly db: DataSource,
    private readonly workflow: SafetyWorkflowService,
    private readonly evidence?: SafetyAlertEvidenceService,
  ) {}
  contractors(actor: AuthenticatedUser, siteId: string, q: SafetyOverviewQuery) {
    return this.workforce.contractors(actor, siteId, q);
  }
  teamOptions(actor: AuthenticatedUser, siteId: string, q: SafetyOverviewQuery) {
    return this.workforce.teamOptions(actor, siteId, q);
  }
  week(actor: AuthenticatedUser, siteId: string, q: SafetyOverviewQuery) {
    return this.workforce.week(actor, siteId, q);
  }
  zoneTeams(actor: AuthenticatedUser, siteId: string, zoneId: string, q: SafetyOverviewQuery) {
    return this.workforce.zoneTeams(actor, siteId, zoneId, q);
  }
  async overview(actor: AuthenticatedUser, siteId: string, q: SafetyOverviewQuery) {
    const result = await this.workforce.overview(actor, siteId, q);
    const updatedAt = await this.summaries(siteId, q, result.teams.items);
    return { ...result, updatedAt };
  }
  private async summaries(
    siteId: string,
    q: SafetyOverviewQuery,
    teams: SafetyOverviewTeam[],
    detail?: SafetyTeamDetailResponse,
  ) {
    const updatedAt = new Date().toISOString();
    if (!teams.length) return updatedAt;
    const ids = teams.map((t) => t.id);
    await this.db.transaction('REPEATABLE READ', async (m) => {
      const alerts = (await m.query(
        `SELECT g.team_id AS "teamId",g.zone_id AS "zoneId",e.camera_external_id AS "cameraExternalId",count(DISTINCT a.id)::int AS count
       FROM safety_alert a JOIN alert_detection_mapping am ON am.alert_id=a.id JOIN ai_observation_event e ON e.event_id=am.event_id
       JOIN ${safetyTeamZoneContextSql} g ON g.site_id=a.site_id AND g.zone_id=a.zone_id AND g.valid_from<=e.captured_at AND g.valid_until>e.captured_at
       WHERE a.site_id=$1 AND g.team_id=ANY($2::uuid[]) AND e.captured_at>=($3::date::timestamp AT TIME ZONE $4) AND e.captured_at<(($3::date+1)::timestamp AT TIME ZONE $4) AND ${attentionAlertSql}
       GROUP BY GROUPING SETS ((g.team_id),(g.team_id,g.zone_id),(g.team_id,g.zone_id,e.camera_external_id))`,
        [siteId, ids, q.date, q.timezone],
      )) as {
        teamId: string;
        zoneId: string | null;
        cameraExternalId: string | null;
        count: number;
      }[];
      const reports = (await m.query(
        `SELECT a.team_id AS "teamId",count(*)::int AS total,
       count(*) FILTER(WHERE a.status IN ('ASSIGNED','IN_PROGRESS') AND last.status IS DISTINCT FROM 'RETURNED')::int AS "notSubmitted",
       count(*) FILTER(WHERE a.status='IN_PROGRESS' AND last.status='RETURNED')::int AS "needsUpdate",
       count(*) FILTER(WHERE a.status='SUBMITTED')::int AS "awaitingReview",
       count(*) FILTER(WHERE a.status='ACCEPTED' AND last.failed)::int AS "recordedWithFindings",
       count(*) FILTER(WHERE a.status='ACCEPTED' AND NOT last.failed)::int AS "recordedWithoutFailures",
       count(*) FILTER(WHERE a.status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED') AND a.starts_at<=$5::timestamptz)::int AS "pastPlannedStart"
       ,count(*) FILTER(WHERE a.status<>'CANCELLED' AND last.first_submitted_at IS NULL AND a.starts_at<=$5::timestamptz)::int AS "pastStartWithoutReport"
       ,count(*) FILTER(WHERE last.first_submitted_at>a.starts_at)::int AS "lateFirstReports"
       ,count(*) FILTER(WHERE a.status='SUBMITTED' AND a.starts_at<=$5::timestamptz)::int AS "reviewPendingPastStart"
       ,COALESCE(sum(last.unlinked) FILTER(WHERE a.status='ACCEPTED'),0)::int AS "findingsWithoutIncident"
       ,COALESCE(sum(last.open_cases) FILTER(WHERE a.status='ACCEPTED'),0)::int AS "openIncidentFindings"
       ,COALESCE(sum(last.closed_cases) FILTER(WHERE a.status='ACCEPTED'),0)::int AS "closedIncidentFindings"
       FROM safety_checklist_assignment a LEFT JOIN LATERAL(
        SELECT s.status,
        (SELECT min(first.submitted_at) FROM safety_checklist_submission first WHERE first.assignment_id=a.id) AS first_submitted_at,
        EXISTS(SELECT 1 FROM safety_checklist_item_result r WHERE r.submission_id=s.id AND r.answer='FAIL') AS failed,
        (SELECT count(*) FROM safety_checklist_item_result r LEFT JOIN incident i ON i.source_checklist_result_id=r.id AND i.site_id=a.site_id WHERE r.submission_id=s.id AND r.answer='FAIL' AND i.id IS NULL) AS unlinked,
        (SELECT count(*) FROM safety_checklist_item_result r JOIN incident i ON i.source_checklist_result_id=r.id AND i.site_id=a.site_id WHERE r.submission_id=s.id AND r.answer='FAIL' AND i.status<>'CLOSED') AS open_cases,
        (SELECT count(*) FROM safety_checklist_item_result r JOIN incident i ON i.source_checklist_result_id=r.id AND i.site_id=a.site_id WHERE r.submission_id=s.id AND r.answer='FAIL' AND i.status='CLOSED') AS closed_cases
        FROM safety_checklist_submission s WHERE s.assignment_id=a.id ORDER BY s.submitted_at DESC,s.id DESC LIMIT 1
       ) last ON TRUE WHERE a.site_id=$1 AND a.team_id=ANY($2::uuid[]) AND a.status<>'CANCELLED'
       AND a.starts_at<(($3::date+1)::timestamp AT TIME ZONE $4) AND a.ends_at>($3::date::timestamp AT TIME ZONE $4) GROUP BY a.team_id`,
        [siteId, ids, q.date, q.timezone, updatedAt],
      )) as (Omit<SafetyChecklistSummary, 'noChecklistAssigned'> & { teamId: string })[];
      for (const team of teams) {
        team.attentionAlertCount =
          alerts.find((a) => a.teamId === team.id && a.zoneId === null)?.count ?? 0;
        const row = reports.find((r) => r.teamId === team.id);
        const summary = {
          total: 0,
          notSubmitted: 0,
          needsUpdate: 0,
          awaitingReview: 0,
          recordedWithFindings: 0,
          recordedWithoutFailures: 0,
          pastPlannedStart: 0,
        };
        if (row) {
          const { teamId: omitted, ...counts } = row;
          void omitted;
          Object.assign(summary, counts);
        }
        team.checklistSummary = {
          ...summary,
          noChecklistAssigned: team.scheduledWorkerCount > 0 && summary.total === 0,
        };
      }
      if (detail) {
        for (const z of detail.zones)
          z.attentionAlertCount =
            alerts.find((a) => a.zoneId === z.id && a.cameraExternalId === null)?.count ?? 0;
        for (const c of detail.cameras)
          c.attentionAlertCount =
            alerts.find((a) => a.zoneId === c.zoneId && a.cameraExternalId === c.externalId)
              ?.count ?? 0;
      }
    });
    return updatedAt;
  }
  async team(actor: AuthenticatedUser, siteId: string, id: string, q: SafetyOverviewQuery) {
    const detail = await this.workforce.team(actor, siteId, id, q);
    detail.cameras = await this.db.transaction((m) =>
      this.cameras.safetyZoneCameras(
        m,
        siteId,
        detail.zones.map((z) => z.id),
      ),
    );
    await this.summaries(siteId, q, [detail], detail);
    if (
      actor.roleAssignments.some(
        (r) =>
          (r.role === UserRole.ADMIN && r.siteId === null) ||
          (r.role === UserRole.SAFETY_OFFICER && r.siteId === siteId),
      )
    ) {
      const rows = detail.cameras.length
        ? await this.db.query(
            `SELECT DISTINCT ON(e.camera_external_id,a.zone_id) e.camera_external_id,a.zone_id,a.id AS "alertId",e.event_id AS "eventId",e.captured_at AS "capturedAt",e.raw_payload AS "rawPayload"
        FROM safety_alert a JOIN alert_detection_mapping am ON am.alert_id=a.id JOIN ai_observation_event e ON e.event_id=am.event_id
        WHERE a.site_id=$1 AND e.camera_external_id=ANY($2::varchar[]) AND e.captured_at>=($3::date::timestamp AT TIME ZONE $4) AND e.captured_at<(($3::date+1)::timestamp AT TIME ZONE $4) AND ${attentionAlertSql}
        ORDER BY e.camera_external_id,a.zone_id,e.captured_at DESC,e.event_id,a.id`,
            [siteId, detail.cameras.map((c) => c.externalId), q.date, q.timezone],
          )
        : [];
      for (const camera of detail.cameras) {
        const event = rows.find(
          (r: { camera_external_id: string; zone_id: string }) =>
            r.camera_external_id === camera.externalId && r.zone_id === camera.zoneId,
        );
        const item =
          event &&
          this.evidence
            ?.summarize(event.rawPayload, event.eventId)
            .find((e) => e.available && e.kind !== 'CROP');
        camera.latestEvidence = event
          ? {
              alertId: event.alertId,
              eventId: event.eventId,
              capturedAt: new Date(event.capturedAt).toISOString(),
              evidenceIndex: item?.index ?? null,
            }
          : null;
      }
    }
    return detail;
  }
  async alert(
    actor: AuthenticatedUser,
    siteId: string,
    id: string,
  ): Promise<SafetyAlertWorkContextResponse> {
    return this.db.transaction(async (m) => {
      await this.workforce.scope(m, actor, siteId);
      const alert = await m
        .getRepository(SafetyAlertEntity)
        .findOneBy({ id: uuid(id), siteId: uuid(siteId) });
      if (!alert) missing();
      const ids = await this.workflow.confirmedAlertWorkers(m, siteId, [alert]);
      const workers = await this.workforce.subjects(m, siteId, ids, alert.firstDetectedAt);
      const [context] = (await m.query(
        'SELECT z.name AS "zoneName",c.name AS "cameraName" FROM safety_alert a LEFT JOIN zone z ON z.id=a.zone_id AND z.site_id=a.site_id LEFT JOIN LATERAL (SELECT e.camera_external_id FROM alert_detection_mapping am JOIN ai_observation_event e ON e.event_id=am.event_id WHERE am.alert_id=a.id ORDER BY e.captured_at,e.event_id LIMIT 1) observed ON TRUE LEFT JOIN camera c ON c.external_id=observed.camera_external_id AND c.site_id=a.site_id WHERE a.id=$1',
        [alert.id],
      )) as { zoneName: string | null; cameraName: string | null }[];
      const relatedTeams = alert.zoneId
        ? ((await m.query(
            `SELECT DISTINCT t.id,t.name,t.description,t.contractor_id AS "contractorId",c.name AS "contractorName",t.is_active AS "isActive",0 AS "workerCount",0 AS "scheduledWorkerCount" FROM team_zone_permission tp JOIN contractor_team t ON t.id=tp.team_id JOIN contractor c ON c.id=t.contractor_id JOIN contractor_zone_permission cp ON cp.id=tp.contractor_zone_permission_id JOIN contractor_site_participation p ON p.id=cp.site_contractor_id WHERE t.site_id=$1 AND p.site_id=$1 AND p.contractor_id=t.contractor_id AND cp.zone_id=$2 AND tp.valid_from<=$3 AND tp.valid_until>$3 AND cp.valid_from<=$3 AND cp.valid_until>$3 AND p.valid_from<=$3 AND (p.valid_until IS NULL OR p.valid_until>$3) AND (tp.revoked_at IS NULL OR tp.revoked_at>$3) AND (cp.revoked_at IS NULL OR cp.revoked_at>$3) ORDER BY t.name,t.id LIMIT 20`,
            [siteId, alert.zoneId, alert.firstDetectedAt],
          )) as SafetyAlertWorkContextResponse['relatedTeams'])
        : [];
      return {
        capturedAt: alert.firstDetectedAt.toISOString(),
        identity: ids.length ? 'VERIFIED' : 'UNKNOWN',
        workers,
        ...context!,
        relatedTeams,
        warning:
          'Recorded team/Zone context supports verification. It does not prove presence, identity or contractor responsibility. Camera links describe current configuration.',
      };
    });
  }
}
