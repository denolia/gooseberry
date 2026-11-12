export type StudyDay = {
  creditedDate?: string;
  startAt: string;
  nextStartAt: string;
  timeZone: string;
  serverNow?: string;
};

export type StudyExposurePermission = {
  id: string;
  studyCardId: string;
  wordSetItemId: string;
  stateBefore: number;
  repsBefore: number;
  activatedAt: string;
};
