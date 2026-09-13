/** A same-process HTTP call to the mock-data module, parsed as JSON when a body is present. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body?: T }> {
  const response = await fetch(url, init);
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as T) : undefined };
}

export function jsonInit(method: string, payload?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  };
}
