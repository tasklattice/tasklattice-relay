export const PROJECT_DELETION_GRACE_PERIOD_MINUTES = 10;
export const PROJECT_DELETION_GRACE_PERIOD_MS =
  PROJECT_DELETION_GRACE_PERIOD_MINUTES * 60 * 1_000;

export interface ProjectDeletionSchedule {
  delayMinutes: number;
  projectId: string;
  requestedAt: string;
  scheduledFor: string;
  status: "scheduled";
}
