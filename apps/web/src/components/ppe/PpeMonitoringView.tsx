import React, { useState } from 'react';
import { CameraFeed } from '../shared/CameraFeed';
import { EventDetailPanel } from '../shared/EventDetailPanel';
import { EventsTable, TableColumn, StatusBadge } from '../shared/EventsTable';
import { ActionDrawer } from '../shared/ActionDrawer';
import { CameraSelectorBar, CameraModel } from '../shared/CameraSelectorBar';
import { IconCheck, IconX, IconAlertTriangle } from '../icons';

type PPEStatus = 'Open' | 'Under Review' | 'Needs Review' | 'Logged';

interface PPEEvent {
  id: string;
  time: string;
  worker: string;
  workerId: string;
  camera: string;
  issue: string;
  confidence: string;
  status: PPEStatus;
  missingItems: string[];
}

export function PpeMonitoringView() {
  const [selectedCameraId, setSelectedCameraId] = useState<string>('CAM-07');
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);

  const cameras: CameraModel[] = [
    { id: 'CAM-07', name: 'Tower Crane 1 Base', location: 'Work Area B', status: 'online', capabilities: ['PPE', 'ZONE'] },
    { id: 'CAM-02', name: 'Scaffold Level 4', location: 'Tower B', status: 'online', capabilities: ['PPE'] },
    { id: 'CAM-05', name: 'Main Entrance', location: 'Tower A', status: 'online', capabilities: ['PPE', 'FACIAL_REC'] },
  ];

  const allEvents: PPEEvent[] = [
    {
      id: 'EVT-2048',
      time: '10:42',
      worker: 'Nguyen Van A',
      workerId: 'WK-1024',
      camera: 'CAM-07',
      issue: 'Missing Gloves',
      confidence: '97%',
      status: 'Open',
      missingItems: ['Gloves'],
    },
    {
      id: 'EVT-2042',
      time: '10:36',
      worker: 'Tran Van B',
      workerId: 'WK-1025',
      camera: 'CAM-02',
      issue: 'Missing Helmet',
      confidence: '95%',
      status: 'Under Review',
      missingItems: ['Helmet'],
    },
    {
      id: 'EVT-2035',
      time: '10:21',
      worker: 'Unknown',
      workerId: 'Unknown',
      camera: 'CAM-05',
      issue: 'Uncertain PPE',
      confidence: '72%',
      status: 'Needs Review',
      missingItems: ['Safety Vest'],
    },
    {
      id: 'EVT-2029',
      time: '09:58',
      worker: 'Le Van C',
      workerId: 'WK-1026',
      camera: 'CAM-07',
      issue: 'Compliant',
      confidence: '98%',
      status: 'Logged',
      missingItems: [],
    },
  ];

  const activeCamera = (cameras.find(c => c.id === selectedCameraId) || cameras[0]) as CameraModel;
  const filteredEvents = allEvents.filter(e => e.camera === activeCamera.id);
  const activeEvent = filteredEvents.find(e => e.id === selectedAlert) || filteredEvents[0];

  const columns: TableColumn<PPEEvent>[] = [
    { header: 'Time', key: 'time', render: (item) => <span className="font-mono text-slate-500 text-xs">{item.time}</span> },
    { header: 'Worker', key: 'worker', render: (item) => <span className="font-semibold text-slate-900">{item.worker}</span> },
    { header: 'Issue', key: 'issue', render: (item) => <span className="font-medium text-slate-900">{item.issue}</span> },
    { header: 'Confidence', key: 'confidence', render: (item) => <span className="font-semibold text-slate-900">{item.confidence}</span> },
    {
      header: 'Status',
      key: 'status',
      render: (item) => {
        let type: 'error' | 'warning' | 'success' | 'info' = 'info';
        if (item.status === 'Open') type = 'error';
        if (item.status === 'Logged') type = 'success';
        if (item.status === 'Under Review' || item.status === 'Needs Review') type = 'warning';
        return <StatusBadge status={item.status} type={type} />;
      },
    },
    {
      header: 'Action',
      key: 'action',
      align: 'right',
      render: (item) => (
        <button
          onClick={() => setSelectedAlert(item.id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] ${
            selectedAlert === item.id 
              ? 'bg-[#041D2E] text-white' 
              : item.status === 'Open' || item.status === 'Needs Review'
              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {item.status === 'Logged' ? 'View' : 'Select'}
        </button>
      ),
    },
  ];

  const detailsGrid = activeEvent ? [
    { label: 'Worker', value: activeEvent.worker },
    { label: 'Worker ID', value: activeEvent.workerId },
    { label: 'Camera', value: activeEvent.camera },
    { label: 'Work Area', value: activeCamera.location },
    { label: 'Detected', value: activeEvent.time + ':16' },
    { label: 'Confidence', value: activeEvent.confidence },
  ] : [
    { label: 'Status', value: 'System Online' },
    { label: 'Camera', value: activeCamera.id },
    { label: 'Work Area', value: activeCamera.location },
    { label: 'Detections', value: '0 Active' },
  ];

  const checklistSlot = activeEvent ? (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] mb-3">
        PPE CHECK
      </p>
      <div className="space-y-1.5">
        <div className={`flex items-center justify-between p-3 rounded-xl border ${activeEvent.missingItems.includes('Helmet') ? 'bg-red-50/50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold text-slate-900 text-xs">Helmet</p>
            <p className={`text-[11px] font-medium ${activeEvent.missingItems.includes('Helmet') ? 'text-red-500' : 'text-slate-500'}`}>
              {activeEvent.missingItems.includes('Helmet') ? 'Missing' : 'Detected'}
            </p>
          </div>
          {activeEvent.missingItems.includes('Helmet') ? <IconX className="w-5 h-5 text-red-500" /> : <IconCheck className="w-5 h-5 text-emerald-500" />}
        </div>
        <div className={`flex items-center justify-between p-3 rounded-xl border ${activeEvent.missingItems.includes('Safety Vest') ? 'bg-red-50/50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold text-slate-900 text-xs">Safety Vest</p>
            <p className={`text-[11px] font-medium ${activeEvent.missingItems.includes('Safety Vest') ? 'text-red-500' : 'text-slate-500'}`}>
              {activeEvent.missingItems.includes('Safety Vest') ? 'Missing' : 'Detected'}
            </p>
          </div>
          {activeEvent.missingItems.includes('Safety Vest') ? <IconX className="w-5 h-5 text-red-500" /> : <IconCheck className="w-5 h-5 text-emerald-500" />}
        </div>
        <div className={`flex items-center justify-between p-3 rounded-xl border ${activeEvent.missingItems.includes('Gloves') ? 'bg-red-50/50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold text-slate-900 text-xs">Gloves</p>
            <p className={`text-[11px] font-medium ${activeEvent.missingItems.includes('Gloves') ? 'text-red-500' : 'text-slate-500'}`}>
              {activeEvent.missingItems.includes('Gloves') ? 'Missing' : 'Detected'}
            </p>
          </div>
          {activeEvent.missingItems.includes('Gloves') ? <IconX className="w-5 h-5 text-red-500" /> : <IconCheck className="w-5 h-5 text-emerald-500" />}
        </div>
      </div>
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-100 rounded-xl mt-4">
      <IconCheck className="w-8 h-8 text-emerald-500 mb-2 opacity-80" />
      <p className="text-xs font-bold text-slate-600">ALL COMPLIANT</p>
      <p className="text-[11px] text-slate-400 text-center mt-1">No PPE violations currently detected in this work area.</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      
      <CameraSelectorBar
        siteName="Tower A"
        contextName={activeCamera.location}
        cameras={cameras}
        activeCameraId={selectedCameraId}
        onSelectCamera={(id) => {
          setSelectedCameraId(id);
          setSelectedAlert(null); // Reset selection when camera changes
        }}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[829px_355px] gap-4 items-start">
        
        {/* Camera Feed */}
        <CameraFeed
          cameraId={activeCamera.id}
          zoneName={activeCamera.location}
          imageUrl={activeCamera.id === 'CAM-07' ? "/assets/ppe-camera-view.png" : "/assets/crane-camera-view.png"}
        >
          {activeEvent && activeEvent.status !== 'Logged' && (
            <>
              <div className="absolute top-[40%] left-0 right-0 h-[1px] bg-[#F66B17] opacity-60 shadow-[0_0_8px_#F66B17]" />
              <div
                className="absolute border-[1.6px] border-[#F66B17] pointer-events-none transition-all duration-300"
                style={{ left: '42.0%', top: '30.0%', width: '12.0%', height: '55.0%' }}
              >
                <div className="absolute -top-[20px] left-[-1.6px] px-1.5 py-0.5 bg-[#F66B17] text-white text-[9px] font-extrabold uppercase tracking-widest shadow-sm">
                  {activeEvent.workerId !== 'Unknown' ? `WORKER #${activeEvent.workerId.replace('WK-', '')} - ${activeEvent.confidence}` : `UNKNOWN - ${activeEvent.confidence}`}
                </div>
              </div>
            </>
          )}
        </CameraFeed>

        {/* Detail Panel */}
        <EventDetailPanel
          title="AI DETECTION"
          eventId={activeEvent ? activeEvent.id : "NO-EVENT"}
          details={detailsGrid}
          checklistSlot={checklistSlot}
          resultStatus={activeEvent ? (activeEvent.status === 'Logged' ? 'success' : activeEvent.status === 'Open' ? 'error' : 'warning') : 'success'}
          resultTitle={activeEvent ? (activeEvent.status === 'Logged' ? 'COMPLIANT' : 'PPE VIOLATION') : 'MONITORING ACTIVE'}
          resultMessage={activeEvent ? (activeEvent.status === 'Logged' ? 'All required PPE items verified.' : `Missing required PPE: ${activeEvent.missingItems.join(', ')}`) : 'System is continuously scanning for PPE violations.'}
          primaryActionLabel={activeEvent && activeEvent.status !== 'Logged' ? "Review Alert" : "Live View"}
          onPrimaryAction={() => {
            if (activeEvent && activeEvent.status !== 'Logged') {
              setSelectedAlert(activeEvent.id);
            } else {
              alert('Camera is in live monitoring mode.');
            }
          }}
          secondaryActionLabel={activeEvent ? "View Worker" : "View Area Policies"}
          onSecondaryAction={() => {
            if (activeEvent) {
              setSelectedWorker(activeEvent.workerId);
            } else {
              alert(`Showing PPE policies for ${activeCamera.location}...`);
            }
          }}
        />
      </div>

      <EventsTable
        title="Recent PPE Events"
        subtitle={`Latest camera detections for ${activeCamera.name}.`}
        data={filteredEvents}
        columns={columns}
        keyExtractor={(item) => item.id}
      />

      {/* Slide-over Drawer for Reviewing Alert */}
      {activeEvent && (
        <ActionDrawer
          isOpen={selectedAlert === activeEvent.id && activeEvent.status !== 'Logged'}
          onClose={() => setSelectedAlert(null)}
          title="Violation Review"
          badge={activeEvent.id}
          badgeType="error"
        >
          <div className="space-y-6 text-sm text-slate-600">
            <p className="leading-relaxed">
              AI detected a missing safety item for worker{' '}
              <strong className="text-slate-900 font-semibold">{activeEvent.worker} ({activeEvent.workerId})</strong> in{' '}
              <strong className="text-slate-900 font-semibold">{activeCamera.location}</strong>. Missing item(s):{' '}
              <strong className="text-slate-900 font-semibold">{activeEvent.missingItems.join(', ')}</strong> ({activeEvent.confidence} confidence).
            </p>
            
            <div className="p-4 bg-amber-50 rounded-xl space-y-2 border border-amber-100">
              <p className="font-bold text-amber-900 text-xs uppercase tracking-[0.1em]">Safety Protocol</p>
              <p className="text-amber-800 text-xs leading-relaxed">
                Handling rebar or mechanical parts requires EN 388 protective gloves and a Type 1 safety helmet at all times.
              </p>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <button
                onClick={() => {
                  alert('Notification dispatched to Site Supervisor.');
                  setSelectedAlert(null);
                }}
                className="py-3 px-4 rounded-xl bg-[#F66B17] hover:bg-orange-700 text-white font-bold text-sm shadow-[0_2px_10px_rgba(246,107,23,0.3)] transition-all active:scale-[0.98]"
              >
                Notify Supervisor
              </button>
              <button
                onClick={() => {
                  alert('Alert dismissed as false positive.');
                  setSelectedAlert(null);
                }}
                className="py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-all active:scale-[0.98]"
              >
                Dismiss
              </button>
            </div>
          </div>
        </ActionDrawer>
      )}

      {/* Slide-over Drawer for Worker Profile */}
      {selectedWorker && (
        <ActionDrawer
          isOpen={selectedWorker !== null}
          onClose={() => setSelectedWorker(null)}
          title="Worker Profile"
          badge="Active"
          badgeType="info"
        >
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xl uppercase">
                {selectedWorker === 'Unknown' ? '?' : 'NV'}
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900">{activeEvent?.worker || 'Unknown'}</h4>
                <p className="text-sm text-slate-500 font-mono mt-0.5">ID: {selectedWorker}</p>
              </div>
            </div>
            
            <div className="h-px bg-slate-100 w-full" />
            
            <div className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Role</span>
                <span className="text-slate-900 font-semibold">Steel Worker</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Subcontractor</span>
                <span className="text-slate-900 font-semibold">Alpha Construction</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Safety Score</span>
                <span className="text-emerald-600 font-bold">92%</span>
              </div>
            </div>
          </div>
        </ActionDrawer>
      )}
    </div>
  );
}
