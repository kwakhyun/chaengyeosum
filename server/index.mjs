import { resolve } from "node:path";

import { createApiServer } from "./app.mjs";

const port = Number(process.env.PORT ?? 8787);
const dbFile = resolve(
  process.env.CHAENGYEOSUM_DB_PATH ?? "server/.data/chaengyeosum.sqlite",
);
const app = createApiServer({ dbFile });

app.server.listen(port, "0.0.0.0", () => {
  console.log(`챙겨썸 API 서버가 http://0.0.0.0:${port} 에서 실행 중이에요.`);
});

function shutdown() {
  app.server.close(() => {
    app.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

