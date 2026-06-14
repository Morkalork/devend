import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && mapApiPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
