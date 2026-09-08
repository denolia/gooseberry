const ADMIN_EMAILS = new Set(["bubnova.j.i@gmail.com", "bubnov.d.e@gmail.com"]);

export function isAdminEmail(email: string | null | undefined): boolean {
  return (
    typeof email === "string" && ADMIN_EMAILS.has(email.trim().toLowerCase())
  );
}
