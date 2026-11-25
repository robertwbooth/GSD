import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.GSD_DATA_DIR ?? "./data");
mkdirSync(dataDir, { recursive: true });

const password = process.env.GSD_PASSWORD;
if (!password) {
  console.error("Set GSD_PASSWORD to the password you want to sign in with.");
  process.exit(1);
}

const github =
  process.env.GSD_GITHUB_TOKEN && process.env.GSD_GITHUB_REPO
    ? { token: process.env.GSD_GITHUB_TOKEN, repo: process.env.GSD_GITHUB_REPO }
    : null;

const app = await buildApp({
  dbPath: join(dataDir, "gsd.db"),
  password,
  webDir: resolve(process.env.GSD_WEB_DIR ?? join(here, "../../web/dist")),
  github,
  logger: true,
  version: process.env.GSD_VERSION ?? "dev",
  backupDir: resolve(process.env.GSD_BACKUP_DIR ?? join(dataDir, "backups")),
});

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
