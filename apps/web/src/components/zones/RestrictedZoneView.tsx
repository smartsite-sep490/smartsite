import React, { useState } from 'react';
import { CameraFeed } from '../shared/CameraFeed';
import { EventDetailPanel } from '../shared/EventDetailPanel';
import { EventsTable, TableColumn, StatusBadge } from '../shared/EventsTable';
import { ActionDrawer } from '../shared/ActionDrawer';
import { CameraSelectorBar, CameraModel } from '../shared/CameraSelectorBar';
import { IconCheck, IconX, IconAlertTriangle } from '../icons';

type ZoneResult = 'Violation' | 'Access Valid' | 'Needs Review';
type PolicyType = 'AUTHORIZED_ONLY' | 'NO_ENTRY';

interface ZoneEvent {
  id: string;
  time: string;
  person: string;
  zone: string;
  camera: string;
  identity: string;
  authorization: string;
  result: ZoneResult;
  policyType: PolicyType;
}

export function RestrictedZoneView() {
  const [selectedCameraId, setSelectedCameraId] = useState<string>('CAM-04');
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);

  const cameras: CameraModel[] = [
    { id: 'CAM-04', name: 'Tower Crane 1 Base', location: 'Crane Operation Area', status: 'online', capabilities: ['PPE', 'ZONE'] },
    { id: 'CAM-12', name: 'Electrical Room Entrance', location: 'High Voltage Room', status: 'online', capabilities: ['ZONE'] },
    { id: 'CAM-08', name: 'Storage Vault', location: 'Material Storage', status: 'online', capabilities: ['ZONE'] },
  ];

  const allEvents: ZoneEvent[] = [
    {
      id: 'EVT-2049',
      time: '10:43',
      person: 'Unknown Person',
      zone: 'High Voltage Room',
      camera: 'CAM-12',
      identity: 'N/A',
      authorization: 'N/A',
      result: 'Violation',
      policyType: 'NO_ENTRY',
    },
    {
      id: 'EVT-2048',
      time: '10:42',
      person: 'Nguyen Van A',
      zone: 'Crane Operation Area',
      camera: 'CAM-04',
      identity: 'Identified',
      authorization: 'Unauthorized',
      result: 'Violation',
      policyType: 'AUTHORIZED_ONLY',
    },
    {
      id: 'EVT-2042',
      time: '10:37',
      person: 'Tran Van B',
      zone: 'Material Storage',
      camera: 'CAM-08',
      identity: 'Identified',
      authorization: 'Authorized',
      result: 'Access Valid',
      policyType: 'AUTHORIZED_ONLY',
    },
    {
      id: 'EVT-2035',
      time: '10:29',
      person: 'Unknown Person',
      zone: 'Material Storage',
      camera: 'CAM-08',
      identity: 'Unidentified',
      authorization: 'Unknown',
      result: 'Needs Review',
      policyType: 'AUTHORIZED_ONLY',
    },
  ];

  const activeCamera = (cameras.find(c => c.id === selectedCameraId) || cameras[0]) as CameraModel;
  const activePolicyType: PolicyType = activeCamera.id === 'CAM-12' ? 'NO_ENTRY' : 'AUTHORIZED_ONLY';

  const filteredEvents = allEvents.filter(e => e.camera === activeCamera.id);
  const activeEvent = filteredEvents.find(e => e.id === selectedIncident) || filteredEvents[0];

  const columns: TableColumn<ZoneEvent>[] = [
    { header: 'Time', key: 'time', render: (item) => <span className="font-mono text-slate-500 text-xs">{item.time}</span> },
    { header: 'Person', key: 'person', render: (item) => <span className="font-semibold text-slate-900">{item.person}</span> },
    { header: 'Policy', key: 'policyType', render: (item) => <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{item.policyType.replace('_', ' ')}</span> },
    { header: 'Identity', key: 'identity', render: (item) => <span className="text-slate-600">{item.identity}</span> },
    {
      header: 'Result',
      key: 'result',
      render: (item) => {
        let type: 'error' | 'warning' | 'success' | 'info' = 'info';
        if (item.result === 'Violation') type = 'error';
        if (item.result === 'Access Valid') type = 'success';
        if (item.result === 'Needs Review') type = 'warning';
        return <StatusBadge status={item.result} type={type} />;
      },
    },
    {
      header: 'Action',
      key: 'action',
      align: 'right',
      render: (item) => (
        <button
          onClick={() => setSelectedIncident(item.id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] ${
            selectedIncident === item.id 
              ? 'bg-[#041D2E] text-white' 
              : item.result === 'Violation' || item.result === 'Needs Review'
              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {item.result === 'Access Valid' ? 'View' : 'Select'}
        </button>
      ),
    },
  ];

  const detailsGrid = activeEvent ? [
    { label: 'Identity', value: activeEvent.person },
    { label: 'Worker ID', value: activeEvent.identity === 'N/A' ? 'N/A' : (activeEvent.person === 'Nguyen Van A' ? 'WK-1024' : 'Unknown') },
    { label: 'Camera', value: activeEvent.camera },
    { label: 'Zone', value: activeCamera.location },
    { label: 'Detected', value: activeEvent.time + ':16' },
    { label: 'Policy Type', value: activePolicyType.replace('_', ' ') },
  ] : [
    { label: 'Status', value: 'System Online' },
    { label: 'Camera', value: activeCamera.id },
    { label: 'Zone', value: activeCamera.location },
    { label: 'Policy Type', value: activePolicyType.replace('_', ' ') },
  ];

  const checklistSlot = activeEvent ? (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] mb-3">
        VERIFICATION LOGIC
      </p>
      
      {activePolicyType === 'NO_ENTRY' ? (
        <div className="space-y-1.5">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50/50 border border-red-100">
            <IconX className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="font-bold text-red-900 text-xs uppercase tracking-wide">NO ENTRY ZONE</p>
              <p className="text-[11px] text-red-700 leading-relaxed">
                This zone is strictly prohibited for all personnel. Individual identity and authorization checks are bypassed. Immediate violation triggered.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold text-slate-900 text-xs">Identity</p>
              <p className="text-[11px] text-slate-500">{activeEvent.person}</p>
            </div>
            {activeEvent.identity === 'Identified' ? <IconCheck className="w-5 h-5 text-emerald-500" /> : <IconAlertTriangle className="w-5 h-5 text-amber-500" />}
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold text-slate-900 text-xs">Site Assignment</p>
              <p className="text-[11px] text-slate-500">{activeEvent.identity === 'Identified' ? 'Active' : 'Unknown'}</p>
            </div>
            {activeEvent.identity === 'Identified' ? <IconCheck className="w-5 h-5 text-emerald-500" /> : <IconAlertTriangle className="w-5 h-5 text-amber-500" />}
          </div>
          <div className={`flex items-center justify-between p-3 rounded-xl border ${activeEvent.authorization === 'Authorized' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-red-50/50 border-red-100'}`}>
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold text-slate-900 text-xs">Zone Permission</p>
              <p className={`text-[11px] font-medium ${activeEvent.authorization === 'Authorized' ? 'text-emerald-700' : 'text-red-500'}`}>
                {activeEvent.authorization === 'Authorized' ? 'Authorized' : 'Not Authorized'}
              </p>
            </div>
            {activeEvent.authorization === 'Authorized' ? <IconCheck className="w-5 h-5 text-emerald-500" /> : <IconX className="w-5 h-5 text-red-500" />}
          </div>
        </div>
      )}
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-100 rounded-xl mt-4">
      <IconCheck className="w-8 h-8 text-emerald-500 mb-2 opacity-80" />
      <p className="text-xs font-bold text-slate-600">SECURE ZONE</p>
      <p className="text-[11px] text-slate-400 text-center mt-1">No access violations currently detected.</p>
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
          setSelectedIncident(null); // Reset selection when camera changes
        }}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[829px_355px] gap-4 items-start mt-4">
        
        {/* Camera Feed */}
        <CameraFeed
          cameraId={activeCamera.id}
          zoneName={activeCamera.location}
          imageUrl={activePolicyType === 'NO_ENTRY' ? "/assets/high-voltage-room.png" : "/assets/crane-camera-view.png"}
        >
          {activePolicyType === 'NO_ENTRY' && (
            <div
              className="absolute border-[1.6px] border-[#DF2225] bg-[#DF2225]/10 pointer-events-none transition-all duration-300"
              style={{ left: '10.0%', top: '20.0%', width: '80.0%', height: '60.0%' }}
            >
              <div className="absolute top-4 left-4 px-2 py-0.5 bg-[#DF2225]/90 backdrop-blur-md text-white text-[10px] font-extrabold uppercase tracking-widest shadow-sm">
                NO ENTRY ZONE
              </div>
            </div>
          )}

          {activeEvent && (
            <div
              className={`absolute border-[1.6px] ${activeEvent.result === 'Access Valid' ? 'border-emerald-500' : 'border-[#DF2225]'} pointer-events-none transition-all duration-300`}
              style={{ left: '42.0%', top: '55.0%', width: '10.0%', height: '25.0%' }}
            >
              <div className={`absolute -top-[20px] left-[-1.6px] px-1.5 py-0.5 text-white text-[9px] font-extrabold uppercase tracking-widest shadow-sm ${activeEvent.result === 'Access Valid' ? 'bg-emerald-500' : 'bg-[#DF2225]'}`}>
                {activeEvent.identity === 'N/A' || activeEvent.identity === 'Unidentified' ? 'UNKNOWN PERSON' : 'PERSON #1024'}
              </div>
            </div>
          )}
        </CameraFeed>

        {/* Detail Panel */}
        <EventDetailPanel
          title="DETECTION DETAILS"
          eventId={activeEvent ? activeEvent.id : "NO-EVENT"}
          details={detailsGrid}
          checklistSlot={checklistSlot}
          resultStatus={activeEvent ? (activeEvent.result === 'Violation' ? 'error' : activeEvent.result === 'Access Valid' ? 'success' : 'warning') : 'success'}
          resultTitle={activeEvent ? (activeEvent.result === 'Violation' ? 'RESTRICTED ZONE VIOLATION' : activeEvent.result) : 'MONITORING ACTIVE'}
          resultMessage={
            activeEvent 
              ? (activePolicyType === 'NO_ENTRY' 
                ? "Presence detected in a strictly prohibited No Entry zone."
                : activeEvent.result === 'Violation'
                  ? "No valid permission for this zone at detection time."
                  : "Personnel has valid active permission for this zone.")
              : `System is continuously monitoring the ${activeCamera.location}.`
          }
          primaryActionLabel={activeEvent && activeEvent.result !== 'Access Valid' ? "Review Incident" : "Live View"}
          onPrimaryAction={() => {
            if (activeEvent && activeEvent.result !== 'Access Valid') {
              alert('Opening review drawer...');
            } else {
              alert('Camera is in live monitoring mode.');
            }
          }}
          secondaryActionLabel={activeEvent ? "View Worker" : "View Zone Policies"}
          onSecondaryAction={() => {
            if (activeEvent) {
              setSelectedWorker(activeEvent.identity === 'Identified' ? 'WK-1024' : 'Unknown');
            } else {
              alert(`Showing Zone policies for ${activeCamera.location}...`);
            }
          }}
        />
      </div>

      <EventsTable
        title="Recent Zone Events"
        subtitle={`Latest camera detections for ${activeCamera.name}.`}
        data={filteredEvents}
        columns={columns}
        keyExtractor={(item) => item.id}
      />

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
                <h4 className="text-lg font-bold text-slate-900">{selectedWorker === 'Unknown' ? 'Unknown Individual' : 'Nguyen Van A'}</h4>
                <p className="text-sm text-slate-500 font-mono mt-0.5">ID: {selectedWorker}</p>
              </div>
            </div>
          </div>
        </ActionDrawer>
      )}
    </div>
  );
}
