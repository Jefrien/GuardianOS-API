# KidsMonitor API

API ligera en Node.js + Hono para control remoto del `kids-monitor`.

## Requisitos

- Node.js 18+ (instalado via `winget install OpenJS.NodeJS`)

## Instalación

```powershell
cd api
npm install
```

## Uso

```powershell
# Desarrollo (auto-reload con --watch, Node 18+)
npm run dev

# Producción
npm start

# O con script PowerShell
.\start-api.ps1
```

Por defecto corre en `http://localhost:3000`. Puedes cambiar el puerto:

```powershell
$env:PORT = 8080; npm start
```

## Endpoints

### Configuración

| Método | Endpoint | Body | Descripción |
|--------|----------|------|-------------|
| `GET`  | `/config` | - | Ver config actual (JSON) |
| `POST` | `/config` | `{ ... }` | Actualizar config completo |
| `POST` | `/setTime` | `{ "timeLimitMinutes": 100 }` | Cambiar límite de tiempo |
| `POST` | `/setEnabled` | `{ "enabled": true }` | Activar/desactivar bloqueo |
| `POST` | `/setMessage` | `{ "blockMessage": "..." }` | Cambiar mensaje de bloqueo |

### Sincronización de tiempo

| Método | Endpoint | Body | Descripción |
|--------|----------|------|-------------|
| `POST` | `/syncTime` | `{ "elapsedMinutes": 45, "deviceId": "PC-Sala" }` | Recibir tiempo usado desde el servicio |
| `GET`  | `/usage` | - | Ver último tiempo sincronizado |

### Health

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET`  | `/health` | Healthcheck |

## Persistencia

- `data/config.json` — configuración actual
- `data/usage.json` — último `elapsedMinutes` recibido

## Integración con el servicio .NET

En `src/WinSysHelper/appsettings.json`:

```json
{
  "RemoteConfig": {
    "BaseUrl": "http://localhost:3000"
  }
}
```

Si despliegas la API en un dominio público, cambia `BaseUrl` a esa dirección (ej. `https://tu-dominio.com`).
