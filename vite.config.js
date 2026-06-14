import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.XAI_API_KEY) process.env.XAI_API_KEY = env.XAI_API_KEY;

  return {
    plugins: [
      react(),
      {
        name: "dev-api",
        configureServer(server) {
          server.middlewares.use("/api/voice-session", (req, res) => {
            if (req.method !== "POST") {
              res.statusCode = 405;
              res.end("Method not allowed");
              return;
            }
            res.setHeader("Content-Type", "application/json");
            const apiKey = process.env.XAI_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: "XAI_API_KEY not configured" }));
              return;
            }
            res.end(JSON.stringify({ apiKey }));
          });
        },
      },
    ],
    server: { port: 3000, host: true },
  };
});
