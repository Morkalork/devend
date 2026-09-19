import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

/**
 * Identify the build, so the admin panel can answer "is the deployed staging
 * app actually running my latest push, or has it not redeployed yet?".
 *
 * On Heroku the source is not a git checkout during the build, so `git` is not
 * usable there; Heroku instead exposes the deployed commit as SOURCE_VERSION.
 * Locally that variable is absent and git is available. Try both, and fall back
 * to an empty sha rather than failing the build over a version label.
 */
function buildIdentity(): { sha: string; builtAt: string; repo: string } {
  const run = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };
  const sha = process.env.SOURCE_VERSION || run("git rev-parse HEAD");
  // owner/name from the origin remote, for the "is there anything newer" check.
  const remote = run("git config --get remote.origin.url");
  const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  return {
    sha,
    builtAt: new Date().toISOString(),
    repo: match ? match[1] : "",
  };
}

/**
 * Dev-only plugin: the pairing mailbox, same routes the production server
 * carries (server/pairRooms.js).
 *
 * The desk rig depends on this. A phone loading the dev server does so over
 * plain http on a LAN address, which is not a secure context, so it cannot
 * open the camera to scan anything; the data channel itself is fine. With the
 * mailbox here the host shows its QR, the phone's own camera app opens the
 * link on this same origin, and the answer comes back through this route with
 * no in-app camera on either side.
 */
function pairRoomPlugin(): Plugin {
  return {
    name: "pair-room-api",
    async configureServer(server) {
      const rooms = await import("./server/pairRooms.js");
      server.middlewares.use("/api/room/", (req, res, next) => {
        const id = (req.url ?? "/").replace(/^\//, "").split("?")[0];
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          if (body === null) { res.end(); return; }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method === "GET") {
          const out = rooms.takeAnswer(id);
          return send(out.status, out.body);
        }
        if (req.method === "DELETE") { rooms.dropRoom(id); return send(204, null); }
        if (req.method === "PUT") {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            try {
              const { answer } = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
              const out = rooms.putAnswer(id, answer);
              send(out.status, out.body);
            } catch {
              send(400, { error: "bad JSON" });
            }
          });
          return;
        }
        next();
      });
    },
  };
}

/** Dev-only plugin: exposes GET /api/map and PUT /api/map for saving map.yml from the admin UI */
function mapApiPlugin(): Plugin {
  const mapPath = path.resolve(__dirname, "public/map.yml");
  return {
    name: "map-api",
    configureServer(server) {
      server.middlewares.use("/api/map", (req, res, next) => {
        if (req.method === "GET") {
          fs.readFile(mapPath, "utf-8", (err, data) => {
            if (err) { res.statusCode = 500; res.end("Error reading map.yml"); return; }
            res.setHeader("Content-Type", "text/yaml");
            res.end(data);
          });
        } else if (req.method === "PUT") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf-8");
            fs.writeFile(mapPath, body, "utf-8", (err) => {
              if (err) { res.statusCode = 500; res.end("Error writing map.yml"); return; }
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
            });
          });
        } else {
          next();
        }
      });
    },
  };
}

/**
 * Dev-only: force a full page reload (instead of an in-place hot-swap) when a
 * game-engine module changes.
 *
 * The game is imperative WebGL: a PixiJS renderer holding a GPU context, driven
 * by a requestAnimationFrame loop, plus module-level singleton state. React Fast
 * Refresh re-runs GameCanvas's effects in place but keeps the old renderer
 * instance, so after a hot-swap the loop renders against half-updated modules,
 * throws, and (there's no try/catch before it reschedules) the rAF loop stops
 * for good — the tab looks frozen. A clean reload restarts everything and shows
 * the new code. UI-only modules (menus, modals, i18n) still Fast-Refresh.
 */
function fullReloadGameEngine(): Plugin {
  return {
    name: "full-reload-game-engine",
    apply: "serve",
    handleHotUpdate({ file, server }) {
      const norm = file.replace(/\\/g, "/");
      const isEngine =
        /\/src\/(lib|hooks)\//.test(norm) ||
        /\/src\/components\/game\/GameCanvas\.tsx$/.test(norm);
      if (isEngine) {
        server.ws.send({ type: "full-reload" });
        return []; // handled: skip the default (freezing) HMR for this file
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const build = buildIdentity();
  return {
  define: {
    __BUILD_SHA__: JSON.stringify(build.sha),
    __BUILD_AT__: JSON.stringify(build.builtAt),
    __BUILD_REPO__: JSON.stringify(build.repo),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    mode === "development" && fullReloadGameEngine(),
    react(),
    mode === "development" && mapApiPlugin(),
    mode === "development" && pairRoomPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
