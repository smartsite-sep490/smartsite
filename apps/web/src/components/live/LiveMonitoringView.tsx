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
    { header: 'Time', key: 'time', render: (item) => <span className="font-mono text-slate-500 text-xs">{item.time}</span> },
    { header: 'Type', key: 'type', render: (item) => (
      <span className="font-bold text-[11px] text-slate-500 uppercase tracking-widest">{item.type}</span>
    )},
    { header: 'Person', key: 'person', render: (item) => <span className="font-semibold text-slate-900">{item.person}</span> },
    { header: 'Camera', key: 'camera', render: (item) => <span className="font-mono text-slate-500 text-xs">{item.camera}</span> },
    { header: 'Detection', key: 'issue', render: (item) => <span className="font-medium text-slate-900">{item.issue}</span> },
    {
      header: 'Result',
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
      header: 'Action',
      key: 'action',
      align: 'right',
      render: (item) => (
        <button
          onClick={() => onNavigate(item.targetTab)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all active:scale-[0.98]"
        >
          View Details
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Live Monitoring</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-2xl leading-relaxed">
          Operational workspace displaying real-time safety detections across all cameras. Multiple AI models run concurrently to detect PPE compliance and Restricted Zone access.
        </p>
      </div>

      {/* Main Camera Feed showing multiple violations on one worker */}
      <div className="w-full">
        <CameraFeed
          cameraId="CAM-04"
          zoneName="CRANE OPERATION AREA"
          imageUrl="/assets/crane-camera-view.png"
        >
          {/* Zone Polygon */}
          <div
            className="absolute border-[1.6px] border-[#DF2225] bg-[#DF2225]/10 pointer-events-none transition-all duration-300"
            style={{ left: '21.0%', top: '40.0%', width: '57.0%', height: '46.0%' }}
          >
            <div className="absolute top-4 left-4 px-2 py-0.5 bg-[#DF2225]/90 backdrop-blur-md text-white text-[10px] font-extrabold uppercase tracking-widest shadow-sm">
              RESTRICTED ZONE
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
                W-1024 ZONE VIOLATION
              </div>
              <div className="px-1.5 py-0.5 bg-[#F66B17] text-white text-[9px] font-extrabold uppercase tracking-widest shadow-sm whitespace-nowrap">
                W-1024 MISSING GLOVES
              </div>
            </div>
          </div>
        </CameraFeed>
      </div>

      {/* Combined Active Events Table */}
      <EventsTable
        title="Active Safety Detections"
        subtitle="Combined feed of PPE and Zone events across the site."
        data={events}
        columns={columns}
        keyExtractor={(item) => item.id}
      />
    </div>
  );
}
