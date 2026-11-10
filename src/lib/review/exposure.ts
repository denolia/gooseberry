export type StudyDay = {
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
