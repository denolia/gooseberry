export function generateAnkiGuid(
  wordSetId: string,
  translationHistoryId: string,
): string {
  return `gooseberry-${wordSetId}-${translationHistoryId}`;
}
