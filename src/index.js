import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const CONFIG_PATH = join(DATA_DIR, "config.json");
const USAGE_PATH = join(DATA_DIR, "usage.json");
const PUBLIC_DIR = join(__dirname, "..", "public");

// ---------- GESTIÓN DE SESIONES ----------

const SESSION_MINUTES = parseInt(process.env.SESSION_MINUTES || "120");
const sessions = new Map(); // token -> { expiresAt: number }

function createSession() {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { expiresAt: Date.now() + SESSION_MINUTES * 60_000 });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return false;
  }
  // Sliding window: renovar en cada acceso válido
  s.expiresAt = Date.now() + SESSION_MINUTES * 60_000;
  return true;
}

// Limpiar sesiones expiradas cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (now > v.expiresAt) sessions.delete(k);
}, 5 * 60_000);

// ---------- APP ----------

const app = new Hono();

// 1. CORS abierto para que el servicio .NET pueda llamar desde cualquier lado
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-api-key"],
  }),
);

// 2. Middleware de autenticación combinado (API Key + sesión de dashboard)
const PROTECTED = [
  "/config",
  "/usage",
  "/setTime",
  "/setEnabled",
  "/setMessage",
  "/syncTime",
];

app.use("*", async (c, next) => {
  const path = c.req.path;

  // Siempre públicas
  if (["/login", "/logout", "/session", "/health"].includes(path))
    return next();

  // Solo proteger rutas de API
  const isApiRoute = PROTECTED.some(
    (p) => path === p || path.startsWith(p + "/"),
  );
  if (!isApiRoute) return next();

  const adminToken = process.env.ADMIN_TOKEN;
  // Si no hay ADMIN_TOKEN configurado, sin auth (retrocompat)
  if (!adminToken) return next();

  // API key del servicio externo (.NET)
  const apiKey = process.env.API_KEY;
  if (apiKey && c.req.header("x-api-key") === apiKey) return next();

  // Cookie de sesión del dashboard
  const sessionToken = getCookie(c, "session");
  if (isValidSession(sessionToken)) return next();

  return c.json({ success: false, error: "Unauthorized" }, 401);
});

// 3. Middleware de log simple
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${c.req.method} ${c.req.url} - ${c.res.status} (${ms}ms)`);
});

// ---------- HELPERS DE PERSISTENCIA ----------

async function readJson(path, fallback = {}) {
  try {
    if (!existsSync(path)) return fallback;
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[ERROR] leyendo ${path}:`, e.message);
    return fallback;
  }
}

async function writeJson(path, data) {
  const tmp = path + ".tmp";
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
    // En Windows rename sobreescribe si existe
    await import("fs/promises").then((m) => m.rename(tmp, path));
    return true;
  } catch (e) {
    console.error(`[ERROR] escribiendo ${path}:`, e.message);
    return false;
  }
}

// ---------- 4. AUTENTICACIÓN DEL DASHBOARD ----------

// GET /session - verificar si la sesión activa es válida
app.get("/session", (c) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return c.json({ valid: true }); // sin auth configurada
  const token = getCookie(c, "session");
  return c.json({ valid: isValidSession(token) });
});

// POST /login - { token: string } -> { success: boolean }
app.post("/login", async (c) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken)
    return c.json({ success: false, error: "Auth no configurada" }, 500);
  try {
    const { token } = await c.req.json();
    if (!token || token !== adminToken) {
      return c.json({ success: false, error: "Token inválido" }, 401);
    }
    const sessionToken = createSession();
    setCookie(c, "session", sessionToken, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: SESSION_MINUTES * 60,
    });
    return c.json({ success: true, expiresInMinutes: SESSION_MINUTES });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

// POST /logout
app.post("/logout", (c) => {
  const token = getCookie(c, "session");
  if (token) sessions.delete(token);
  deleteCookie(c, "session", { path: "/" });
  return c.json({ success: true });
});

// ---------- 5. CONFIG ----------

app.get("/config", async (c) => {
  const config = await readJson(CONFIG_PATH);
  return c.json(config);
});

app.post("/config", async (c) => {
  try {
    const body = await c.req.json();
    const current = await readJson(CONFIG_PATH);
    const updated = { ...current, ...body };
    const ok = await writeJson(CONFIG_PATH, updated);
    if (!ok)
      return c.json({ success: false, error: "No se pudo guardar" }, 500);
    return c.json({ success: true, config: updated });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

app.post("/setTime", async (c) => {
  try {
    const { timeLimitMinutes } = await c.req.json();
    if (typeof timeLimitMinutes !== "number" || timeLimitMinutes < 0) {
      return c.json(
        { success: false, error: "timeLimitMinutes debe ser un numero >= 0" },
        400,
      );
    }
    const config = await readJson(CONFIG_PATH);
    config.TimeLimitMinutes = timeLimitMinutes;
    const ok = await writeJson(CONFIG_PATH, config);
    if (!ok)
      return c.json({ success: false, error: "No se pudo guardar" }, 500);
    return c.json({ success: true, timeLimitMinutes });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

app.post("/setEnabled", async (c) => {
  try {
    const { enabled } = await c.req.json();
    if (typeof enabled !== "boolean") {
      return c.json(
        { success: false, error: "enabled debe ser booleano" },
        400,
      );
    }
    const config = await readJson(CONFIG_PATH);
    config.Enabled = enabled;
    const ok = await writeJson(CONFIG_PATH, config);
    if (!ok)
      return c.json({ success: false, error: "No se pudo guardar" }, 500);
    return c.json({ success: true, enabled });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

app.post("/setMessage", async (c) => {
  try {
    const { blockMessage } = await c.req.json();
    if (typeof blockMessage !== "string") {
      return c.json(
        { success: false, error: "blockMessage debe ser string" },
        400,
      );
    }
    const config = await readJson(CONFIG_PATH);
    config.BlockMessage = blockMessage;
    const ok = await writeJson(CONFIG_PATH, config);
    if (!ok)
      return c.json({ success: false, error: "No se pudo guardar" }, 500);
    return c.json({ success: true, blockMessage });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

// ---------- SYNC TIME ----------

app.post("/syncTime", async (c) => {
  try {
    const { elapsedMinutes, deviceId } = await c.req.json();
    if (typeof elapsedMinutes !== "number" || elapsedMinutes < 0) {
      return c.json(
        { success: false, error: "elapsedMinutes debe ser un numero >= 0" },
        400,
      );
    }
    const usage = {
      lastSync: new Date().toISOString(),
      elapsedMinutes,
      deviceId: deviceId || "unknown",
    };
    const ok = await writeJson(USAGE_PATH, usage);
    if (!ok)
      return c.json({ success: false, error: "No se pudo guardar" }, 500);
    console.log(`[SYNC] device=${usage.deviceId} elapsed=${elapsedMinutes}m`);
    return c.json({ success: true, usage });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

app.get("/usage", async (c) => {
  const usage = await readJson(USAGE_PATH);
  return c.json(usage);
});

// ---------- HEALTH ----------

app.get("/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() }),
);

// ---------- 6. STATIC / DASHBOARD ----------

app.use("/*", serveStatic({ root: PUBLIC_DIR }));
app.get("/", async (c) => {
  const indexPath = join(PUBLIC_DIR, "index.html");
  try {
    const html = await readFile(indexPath, "utf-8");
    return c.html(html);
  } catch {
    return c.text("Dashboard no encontrado", 404);
  }
});

// ---------- START ----------

const PORT = process.env.PORT || 3000;

const server = serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`[KidsMonitor API] corriendo en http://localhost:${PORT}`);
console.log(`  GET  /config       -> ver configuracion`);
console.log(`  POST /config       -> actualizar config completo`);
console.log(`  POST /setTime      -> body: { timeLimitMinutes: number }`);
console.log(`  POST /setEnabled   -> body: { enabled: boolean }`);
console.log(`  POST /setMessage   -> body: { blockMessage: string }`);
console.log(
  `  POST /syncTime     -> body: { elapsedMinutes: number, deviceId?: string }`,
);
console.log(`  GET  /usage        -> ver ultimo tiempo sincronizado`);
console.log(`  GET  /health       -> healthcheck`);
console.log(`  GET  /session      -> verificar sesion activa`);
console.log(`  POST /login        -> body: { token: string }`);
console.log(`  POST /logout       -> cerrar sesion`);

process.on("SIGINT", () => {
  console.log("\n[KidsMonitor API] Cerrando servidor...");
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  console.log("\n[KidsMonitor API] Cerrando servidor...");
  server.close(() => process.exit(0));
});
