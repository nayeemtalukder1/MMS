let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export async function apiFetch<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) errMsg = data.error;
    } catch {
      // ignore non-json error
    }
    throw new Error(errMsg);
  }

  return (await res.json()) as T;
}

export async function downloadAuthorizedFile(docId: number, fileName: string) {
  const headers = new Headers();
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  const res = await fetch(`/api/documents/${docId}/download`, { headers });
  if (!res.ok) {
    throw new Error('Unable to download document.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function buildWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = encodeURIComponent(authToken || '');
  return `${proto}//${window.location.host}/ws?token=${token}`;
}

export function formatRoleLabel(role: string): string {
  switch (role) {
    case 'super_admin':
      return 'Super Administrator';
    case 'department_head':
      return 'Department Head';
    case 'meeting_organizer':
      return 'Meeting Organizer';
    case 'teacher':
      return 'University Teacher';
    default:
      return role;
  }
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}
