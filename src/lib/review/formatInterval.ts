export function formatReviewInterval(intervalMs: number): string {
  const minutes = Math.max(1, Math.round(intervalMs / 60_000));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;

  const years = Math.round(days / 365);
  return `${years}y`;
}
