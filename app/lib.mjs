// Shared helpers: dates, working days, password hashing, signed sessions.
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

/** A refusal. `rule` carries the business-rule reference so the UI can quote it (NFR-06). */
export class HttpError extends Error {
  constructor(status, message, rule) { super(message); this.status = status; this.rule = rule; }
}

/* ---------- dates ---------- */
export const iso = d => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const parseISO = s => new Date(s + "T00:00:00Z");
const DAY = 864e5;

// Working days between two ISO dates, exclusive of the start day, honouring the
// configured weekend. weekend is a comma list of JS day numbers (0=Sun..6=Sat).
// ponytail: day-by-day walk; fine to ~5y spans, switch to arithmetic if it ever shows up in a profile.
export function workingDays(fromISO, toISO, weekend = "6,0") {
  if (!fromISO) return 0;
  const wk = new Set(String(weekend).split(",").filter(x => x !== "").map(Number));
  let a = parseISO(fromISO).getTime(), b = parseISO(toISO || today()).getTime();
  const sign = b < a ? -1 : 1;
  if (sign < 0) [a, b] = [b, a];
  let n = 0;
  for (let t = a + DAY; t <= b; t += DAY) if (!wk.has(new Date(t).getUTCDay())) n++;
  return n * sign;
}

export function addWorkingDays(fromISO, n, weekend = "6,0") {
  const wk = new Set(String(weekend).split(",").filter(x => x !== "").map(Number));
  let t = parseISO(fromISO).getTime(), left = n;
  while (left > 0) { t += DAY; if (!wk.has(new Date(t).getUTCDay())) left--; }
  return iso(new Date(t));
}

export const quarterOf = isoDate => {
  const d = parseISO(isoDate);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
};

/* ---------- passwords ---------- */
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, saltHex, keyHex] = stored.split("$");
  const key = Buffer.from(keyHex, "hex");
  const test = scryptSync(pw, Buffer.from(saltHex, "hex"), key.length);
  return key.length === test.length && timingSafeEqual(key, test);
}

/* ---------- signed session cookie (no session table needed) ---------- */
const b64 = s => Buffer.from(s).toString("base64url");
const unb64 = s => Buffer.from(s, "base64url").toString();

export function signSession(payload, secret) {
  const body = b64(JSON.stringify(payload));
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}
export function readSession(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const good = createHmac("sha256", secret).update(body).digest("base64url");
  if (mac.length !== good.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(unb64(body));
    return p.exp && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

/* ---------- misc ---------- */
export const csvCell = v => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCSV = (cols, rows) =>
  [cols.map(c => csvCell(c.label)).join(","),
   ...rows.map(r => cols.map(c => csvCell(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","))
  ].join("\r\n");

export const median = arr => {
  const a = arr.filter(n => typeof n === "number" && !Number.isNaN(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
