import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CONFIG_PATH = join(DATA_DIR, 'config.json');
const USAGE_PATH = join(DATA_DIR, 'usage.json');

const app = new Hono();

// CORS abierto para que el servicio .NET pueda llamar desde cualquier lado
app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'x-api-key'] }));

// Middleware de API Key opcional (activar en VPS via env var API_KEY)
app.use('*', async (c, next) => {
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const provided = c.req.header('x-api-key');
    if (provided !== apiKey) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
  }
  await next();
});

// Middleware de log simple
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${c.req.method} ${c.req.url} - ${c.res.status} (${ms}ms)`);
});

// Helpers de persistencia
async function readJson(path, fallback = {}) {
  try {
    if (!existsSync(path)) return fallback;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[ERROR] leyendo ${path}:`, e.message);
    return fallback;
  }
}

async function writeJson(path, data) {
  const tmp = path + '.tmp';
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    // En Windows rename sobreescribe si existe
    await import('fs/promises').then(m => m.rename(tmp, path));
    return true;
  } catch (e) {
    console.error(`[ERROR] escribiendo ${path}:`, e.message);
    return false;
  }
}

// ---------- CONFIG ----------

app.get('/config', async (c) => {
  const config = await readJson(CONFIG_PATH);
  return c.json(config);
});

app.post('/config', async (c) => {
  try {
    const body = await c.req.json();
    const current = await readJson(CONFIG_PATH);
    const updated = { ...current, ...body };
    const ok = await writeJson(CONFIG_PATH, updated);
    if (!ok) return c.json({ success: false, error: 'No se pudo guardar' }, 500);
    return c.json({ success: true, config: updated });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

app.post('/setTime', async (c) => {
  try {
    const { timeLimitMinutes } = await c.req.json();
    if (typeof timeLimitMinutes !== 'number' || timeLimitMinutes < 0) {
      return c.json({ success: false, error: 'timeLimitMinutes debe ser un numero >= 0' }, 400);
    }
    const config = await readJson(CONFIG_PATH);
    config.TimeLimitMinutes = timeLimitMinutes;
    const ok = await writeJson(CONFIG_PATH, config);
    if (!ok) return c.json({ success: false, error: 'No se pudo guardar' }, 500);
    return c.json({ success: true, timeLimitMinutes });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

app.post('/setEnabled', async (c) => {
  try {
    const { enabled } = await c.req.json();
    if (typeof enabled !== 'boolean') {
      return c.json({ success: false, error: 'enabled debe ser booleano' }, 400);
    }
    const config = await readJson(CONFIG_PATH);
    config.Enabled = enabled;
    const ok = await writeJson(CONFIG_PATH, config);
    if (!ok) return c.json({ success: false, error: 'No se pudo guardar' }, 500);
    return c.json({ success: true, enabled });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

app.post('/setMessage', async (c) => {
  try {
    const { blockMessage } = await c.req.json();
    if (typeof blockMessage !== 'string') {
      return c.json({ success: false, error: 'blockMessage debe ser string' }, 400);
    }
    const config = await readJson(CONFIG_PATH);
    config.BlockMessage = blockMessage;
    const ok = await writeJson(CONFIG_PATH, config);
    if (!ok) return c.json({ success: false, error: 'No se pudo guardar' }, 500);
    return c.json({ success: true, blockMessage });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

// ---------- SYNC TIME ----------

app.post('/syncTime', async (c) => {
  try {
    const { elapsedMinutes, deviceId } = await c.req.json();
    if (typeof elapsedMinutes !== 'number' || elapsedMinutes < 0) {
      return c.json({ success: false, error: 'elapsedMinutes debe ser un numero >= 0' }, 400);
    }
    const usage = {
      lastSync: new Date().toISOString(),
      elapsedMinutes,
      deviceId: deviceId || 'unknown'
    };
    const ok = await writeJson(USAGE_PATH, usage);
    if (!ok) return c.json({ success: false, error: 'No se pudo guardar' }, 500);
    console.log(`[SYNC] device=${usage.deviceId} elapsed=${elapsedMinutes}m`);
    return c.json({ success: true, usage });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 400);
  }
});

app.get('/usage', async (c) => {
  const usage = await readJson(USAGE_PATH);
  return c.json(usage);
});

// ---------- HEALTH ----------

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ---------- START ----------

const PORT = process.env.PORT || 3000;

const server = serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`[KidsMonitor API] corriendo en http://localhost:${PORT}`);

process.on('SIGINT', () => {
  console.log('\n[KidsMonitor API] Cerrando servidor...');
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('\n[KidsMonitor API] Cerrando servidor...');
  server.close(() => process.exit(0));
});
console.log(`  GET  /config       -> ver configuracion`);
console.log(`  POST /config       -> actualizar config completo`);
console.log(`  POST /setTime      -> body: { timeLimitMinutes: number }`);
console.log(`  POST /setEnabled   -> body: { enabled: boolean }`);
console.log(`  POST /setMessage   -> body: { blockMessage: string }`);
console.log(`  POST /syncTime     -> body: { elapsedMinutes: number, deviceId?: string }`);
console.log(`  GET  /usage        -> ver ultimo tiempo sincronizado`);
console.log(`  GET  /health       -> healthcheck`);
