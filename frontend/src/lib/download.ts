// Downloads a file from the API with fetch, so JSON errors such as
// export_too_large come back as an ApiError instead of a broken file.
import { ApiError } from "@/api/client";

export async function downloadFile(url: string, fallbackName: string) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    let code = "internal_error";
    try {
      code = (await res.json()).error.code;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, code, "", res.headers.get("x-request-id"));
  }
  const blob = await res.blob();
  const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** A "YYYY-MM-DD" day as local midnight (not UTC, as `new Date("YYYY-MM-DD")` reads it). */
export function localDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
