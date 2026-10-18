// Thin fetch wrapper for the backend. Same-origin requests carry the session
// cookie, and the browser adds the Origin header the backend checks.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Called for errors every screen handles the same way (signed out, password gate). */
let globalErrorHandler: ((e: ApiError) => void) | null = null;
export function onApiError(handler: (e: ApiError) => void) {
  globalErrorHandler = handler;
}

async function toError(res: Response): Promise<ApiError> {
  const requestId = res.headers.get("x-request-id");
  let code = res.status >= 500 ? "internal_error" : "unknown";
  let message = res.statusText;
  try {
    const body = await res.json();
    if (body?.error?.code) {
      code = body.error.code;
      message = body.error.message ?? message;
    }
  } catch {
    // not JSON
  }
  return new ApiError(res.status, code, message, requestId);
}

export async function request<T>(
  method: string,
  path: string,
  opts: { query?: Query; body?: unknown; form?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs(opts.query)}`, {
      method,
      headers,
      body,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network_error", "Network error", null);
  }
  if (!res.ok) {
    const err = await toError(res);
    globalErrorHandler?.(err);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>("GET", path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** Uploads with progress (fetch has no upload progress). */
export function upload(
  issueId: string,
  file: File,
  parent: { comment_id?: string; report_id?: string } = {},
  onProgress?: (fraction: number) => void,
): Promise<import("./types").AttachmentMeta> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    if (parent.comment_id) form.append("comment_id", parent.comment_id);
    if (parent.report_id) form.append("report_id", parent.report_id);
    form.append("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/issues/${issueId}/attachments`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      const requestId = xhr.getResponseHeader("x-request-id");
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
        return;
      }
      let code = "unknown";
      let message = xhr.statusText;
      try {
        const body = JSON.parse(xhr.responseText);
        code = body.error.code;
        message = body.error.message;
      } catch {
        if (xhr.status === 413) code = "payload_too_large";
      }
      reject(new ApiError(xhr.status, code, message, requestId));
    };
    xhr.onerror = () => reject(new ApiError(0, "network_error", "Network error", null));
    xhr.send(form);
  });
}

/** Fetches every page of a keyset-paged list. */
export async function getAll<T>(path: string, query: Query = {}, max = 2000): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  do {
    const page = await api.get<{ items: T[]; next_cursor?: string | null }>(path, {
      ...query,
      limit: 200,
      after,
    });
    out.push(...page.items);
    after = page.next_cursor ?? undefined;
  } while (after && out.length < max);
  return out;
}
