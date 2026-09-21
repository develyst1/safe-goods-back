import { app } from "../app";
import { sql } from "../db/client";
import { seed } from "../db/seed";

// Every test file calls this in beforeAll: wipe every table (identity restarted), then re-seed.
export const resetDb = async () => {
  await sql.unsafe("TRUNCATE users, categories, settings, rooms, files, room_events RESTART IDENTITY CASCADE");
  await seed();
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const readJson = (r: Response): Promise<any> => r.json();

export const api = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
  app.request(`/api/v1${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
  });

// multipart `file` upload, as the FE would send it
export const upload = (path: string, token: string, file: { bytes: Uint8Array | Buffer; type: string; name: string }) => {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  return app.request(`/api/v1${path}`, { method: "POST", body: fd, headers: { authorization: `Bearer ${token}` } });
};

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Every key ending in "At" anywhere in the object must be null or an ISO-8601 Z string.
export const badTimestamps = (obj: unknown, path = ""): string[] => {
  const bad: string[] = [];
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v && typeof v === "object") bad.push(...badTimestamps(v, `${path}${k}.`));
      else if (k.endsWith("At") && v !== null && !(typeof v === "string" && ISO_Z.test(v))) bad.push(`${path}${k}=${String(v)}`);
    }
  }
  return bad;
};
