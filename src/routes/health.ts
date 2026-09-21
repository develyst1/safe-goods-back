import { Hono } from "hono";
import { ok } from "../lib/http";
import { nowIso } from "../lib/time";

export const health = new Hono().get("/", (c) => ok(c, { ok: true, time: nowIso() }));
