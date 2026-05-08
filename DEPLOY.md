# Despliegue en VPS

Esta API está pensada para correr en un VPS Linux (Ubuntu/Debian recomendado).

## 1. Subir archivos al VPS

Comprime la carpeta `api/` y súbela al VPS:

```bash
# En tu PC Windows (PowerShell)
Compress-Archive -Path .\api -DestinationPath api.zip
# Sube api.zip al VPS via scp o panel de hosting
```

En el VPS:

```bash
unzip api.zip
cd api
npm install --production
```

## 2. Configurar variables de entorno

Crea un archivo `.env` o exporta directamente:

```bash
export PORT=3000
export API_KEY=tu-clave-secreta-muy-larga-aqui
```

> **IMPORTANTE:** Si defines `API_KEY`, el servicio .NET debe enviar el header `x-api-key` en cada petición. Actualiza `ConfigService.cs` para incluirlo.

## 3. Ejecutar con PM2 (recomendado)

```bash
npm install -g pm2
pm2 start src/index.js --name kids-monitor-api
pm2 startup
pm2 save
```

## 4. Firewall

Abre el puerto en el firewall del VPS:

```bash
# Ubuntu/Debian con UFW
sudo ufw allow 3000/tcp
```

Y asegúrate de que el proveedor de VPS (AWS, DigitalOcean, etc.) también tenga abierto el puerto en su firewall de red.

## 5. Reverse Proxy con Nginx (opcional pero recomendado)

Si quieres usar dominio + HTTPS:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Luego usa Certbot para HTTPS.

## 6. Conectar el servicio .NET

En `src/WinSysHelper/appsettings.json`:

```json
{
  "RemoteConfig": {
    "BaseUrl": "https://tu-dominio.com"
  }
}
```

Si usas `API_KEY`, también actualiza `ConfigService.cs` para agregar el header `x-api-key`.

## Archivos persistentes

Los archivos `data/config.json` y `data/usage.json` se crean automáticamente. Asegúrate de que el directorio `data/` tenga permisos de escritura:

```bash
chmod 755 data
```
