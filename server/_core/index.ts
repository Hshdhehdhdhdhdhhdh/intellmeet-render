import "dotenv/config";
import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerSignaling } from "../signaling";
import { checkDatabaseConnection } from "../db";

export async function createApp(): Promise<{ app: Express; server: Server }> {
  const app = express();
  app.set("trust proxy", true);
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  app.get("/api/health", async (_req, res) => {
    const database = await checkDatabaseConnection();
    if (!database.ok) {
      return res.status(503).json({ ok: false, service: "intellmeet", database: database.reason });
    }
    return res.status(200).json({ ok: true, service: "intellmeet", database: "ok" });
  });

  // ICE (STUN/TURN) servers for WebRTC. TURN is what makes video work between
  // different networks (mobile data <-> Wi-Fi, office firewalls, carrier NAT).
  let iceCache: { at: number; servers: unknown[] } | null = null;
  app.get("/api/ice", async (_req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (iceCache && Date.now() - iceCache.at < 10 * 60 * 1000)
      return res.json({ iceServers: iceCache.servers });
    const stun = [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
    ];
    let servers: unknown[] = [];
    try {
      if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
        // https://www.metered.ca/tools/openrelay/ – free TURN credentials API
        const r = await fetch(
          `https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`,
          { signal: AbortSignal.timeout(2500) }
        );
        if (r.ok) servers = await r.json();
      } else if (process.env.TURN_URLS) {
        servers = [
          {
            urls: process.env.TURN_URLS.split(",").map(u => u.trim()).filter(Boolean),
            username: process.env.TURN_USERNAME || "",
            credential: process.env.TURN_CREDENTIAL || "",
          },
        ];
      }
    } catch (error) {
      console.error("[ICE] TURN credential fetch failed", error);
    }
    if (!Array.isArray(servers) || servers.length === 0) {
      // Public community relay as a last-resort default. For guaranteed reliability,
      // set METERED_DOMAIN + METERED_API_KEY (free) or TURN_URLS/USERNAME/CREDENTIAL.
      servers = [
        {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turns:openrelay.metered.ca:443?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ];
    }
    const all = [...stun, ...servers];
    iceCache = { at: Date.now(), servers: all };
    res.json({ iceServers: all });
  });
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  if (!process.env.VERCEL) {
    registerSignaling(server);
  }
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  return { app, server };
}

if (!process.env.VERCEL) {
  createApp()
    .then(({ server }) => {
      const port = Number.parseInt(process.env.PORT || "3000", 10);
      server.listen(port, "0.0.0.0", () => {
        console.log(`Server running on http://0.0.0.0:${port}/`);
      });
    })
    .catch((error) => {
      console.error("[Server] Startup failed", error);
      process.exitCode = 1;
    });
}
