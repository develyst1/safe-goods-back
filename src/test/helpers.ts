import { app } from "../app";

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
