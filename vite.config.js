import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;

  return {
    plugins: [
      react(),
      {
        name: "dev-api",
        configureServer(server) {
          server.middlewares.use("/api/realtime-session", async (req, res) => {
            if (req.method !== "POST") {
              res.statusCode = 405;
              res.end("Method not allowed");
              return;
            }
            try {
              const body = JSON.parse(await readBody(req));
              const { default: handler } = await import(
                "./api/realtime-session.js"
              );
              await handler(
                { method: "POST", body },
                {
                  status: (code) => ({
                    json: (data) => {
                      res.statusCode = code;
                      res.setHeader("Content-Type", "application/json");
                      res.end(JSON.stringify(data));
                    },
                  }),
                },
              );
            } catch (err) {
              console.error("[dev /api/realtime-session]", err);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "dev proxy error" }));
            }
          });
        },
      },
    ],
    server: { port: 3000, host: true },
  };
});
