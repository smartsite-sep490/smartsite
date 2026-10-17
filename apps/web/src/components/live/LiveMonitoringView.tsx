import { localizedLabel } from '../../i18n/labels';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { CameraFeed } from '../shared/CameraFeed';
import { EventsTable, TableColumn, StatusBadge } from '../shared/EventsTable';
import { ActiveTab } from '../layout/AppLayout';

interface LiveMonitoringViewProps {
  onNavigate: (tab: ActiveTab) => void;
}

interface CombinedEvent {
  id: string;
  time: string;
  person: string;
  camera: string;
  type: 'PPE' | 'Restricted Zone';
  issue: string;
  status: 'Violation' | 'Warning' | 'Compliant';
  targetTab: ActiveTab;
}

export function LiveMonitoringView({ onNavigate }: LiveMonitoringViewProps) {
  useTranslation();

  const events: CombinedEvent[] = [
    {
      id: 'EVT-2049',
      time: '10:42',
      person: 'Nguyen Van A',
      camera: 'CAM-04',
      type: 'Restricted Zone',
      issue: 'Not Authorized',
      status: 'Violation',
      targetTab: 'zones',
    },
    {
      id: 'EVT-2048',
      time: '10:42',
      person: 'Nguyen Van A',
      camera: 'CAM-04',
      type: 'PPE',
      issue: 'Missing Gloves',
      status: 'Violation',
      targetTab: 'ppe',
    },
    {
      id: 'EVT-2047',
      time: '10:35',
      person: 'Tran Van B',
      camera: 'CAM-08',
      type: 'PPE',
      issue: 'Missing Helmet',
      status: 'Warning',
      targetTab: 'ppe',
    },
    {
      id: 'EVT-2046',
      time: '10:30',
      person: 'Le Van C',
      camera: 'CAM-04',
      type: 'Restricted Zone',
      issue: 'Authorized',
      status: 'Compliant',
      targetTab: 'zones',
    },
  ];

  const columns: TableColumn<CombinedEvent>[] = [
    {
      get header() {
        return tr('common.time');
      },
      key: 'time',
      render: (item) => <span className="font-mono text-[#6B6B6B] text-xs">{item.time}</span>,
    },
    {
      get header() {
        return tr('common.type');
      },
      key: 'type',
      render: (item) => (
        <span className="font-bold text-[11px] text-[#6B6B6B] uppercase tracking-widest">
          {localizedLabel(item.type)}
        </span>
      ),
    },
    {
      get header() {
        return tr('common.person');
      },
      key: 'person',
      render: (item) => (
        <span data-authored-content className="font-semibold text-[#2F3437]">
          {item.person}
        </span>
      ),
    },
    {
      get header() {
        return tr('common.camera');
      },
      key: 'camera',
      render: (item) => <span className="font-mono text-[#6B6B6B] text-xs">{item.camera}</span>,
    },
    {
      get header() {
        return tr('common.detection');
      },
      key: 'issue',
      render: (item) => (
        <span className="font-medium text-[#2F3437]">{localizedLabel(item.issue)}</span>
      ),
    },
    {
      get header() {
        return tr('common.result_6e7d50');
      },
      key: 'status',
      render: (item) => {
        let type: 'error' | 'warning' | 'success' | 'info' = 'info';
        if (item.status === 'Violation') type = 'error';
        if (item.status === 'Warning') type = 'warning';
        if (item.status === 'Compliant') type = 'success';
        return <StatusBadge status={item.status} type={type} />;
      },
    },
    {
      get header() {
        return tr('common.action');
      },
      key: 'action',
      align: 'right',
      render: (item) => (
        <button
          onClick={() => onNavigate(item.targetTab)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#F7F6F3] text-[#2F3437] hover:bg-slate-200 transition-all active:scale-[0.98]"
        >
          {tr('common.view_details_90789c')}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#2F3437] tracking-tight">
          {tr('common.live_monitoring')}
        </h1>
        <p className="text-sm text-[#6B6B6B] mt-2 max-w-2xl leading-relaxed">
          {tr(
            'live_monitoring_view.operational_workspace_displaying_real_time_safety_detections_across_all_cameras_mu',
          )}
        </p>
      </div>

      {/* Main Camera Feed showing multiple violations on one worker */}
      <div className="w-full">
        <CameraFeed
          cameraId="CAM-04"
          zoneName={tr('common.crane_operation_area')}
          imageUrl="/assets/crane-camera-view.png"
        >
          {/* Zone Polygon */}
          <div
            className="absolute border-[1.6px] border-[#DF2225] bg-[#DF2225]/10 pointer-events-none transition-all duration-300"
            style={{ left: '21.0%', top: '40.0%', width: '57.0%', height: '46.0%' }}
          >
            <div className="absolute top-4 left-4 px-2 py-0.5 bg-[#DF2225]/90 backdrop-blur-md text-white text-[10px] font-extrabold uppercase tracking-widest shadow-sm">
              {tr('common.restricted_zone_cbd630')}
            </div>
          </div>

          {/* Worker Bounding Box */}
          <div
            className="absolute border-[2px] border-[#F66B17] pointer-events-none transition-all duration-300"
            style={{ left: '42.0%', top: '55.0%', width: '10.0%', height: '25.0%' }}
          >
            {/* Multi-alert Badge */}
            <div className="absolute -top-[38px] left-[-2px] flex flex-col gap-0.5 pointer-events-auto">
              <div className="px-1.5 py-0.5 bg-[#DF2225] text-white text-[9px] font-extrabold uppercase tracking-widest shadow-sm whitespace-nowrap">
                {tr('common.w_1024_zone_violation')}
              </div>
              <div className="px-1.5 py-0.5 bg-[#F66B17] text-white text-[9px] font-extrabold uppercase tracking-widest shadow-sm whitespace-nowrap">
                {tr('common.w_1024_missing_gloves')}
              </div>
            </div>
          </div>
        </CameraFeed>
      </div>

      {/* Combined Active Events Table */}
      <EventsTable
        title={tr('common.active_safety_detections')}
        subtitle={tr('live_monitoring_view.combined_feed')}
        data={events}
        columns={columns}
        keyExtractor={(item) => item.id}
      />
    </div>
  );
}
