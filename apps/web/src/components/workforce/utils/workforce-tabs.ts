export function getWorkforceTabs(roles: string[]) {
  const isWorker = roles.includes('WORKER');
  const isContractorRep = roles.includes('CONTRACTOR_REPRESENTATIVE');

  const showSchedule = isWorker;
  const showReview = isContractorRep;

  return {
    showSchedule,
    showReview,
    defaultTab: (showSchedule || !showReview ? 'schedule' : 'review') as 'schedule' | 'review',
  };
}
