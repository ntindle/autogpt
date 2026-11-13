const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionID(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_RE.test(value);
}
