import { createApp } from "./src/app.ts";

export const app = createApp();

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`CyberTrace server listening on http://0.0.0.0:${port}`);
});
