// One pipeline pass from the command line: `npm run tick` (loads .env.local if present).
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
else if (existsSync(".env")) process.loadEnvFile(".env");

const { tick } = await import("../src/lib/pipeline");
console.log(await tick());
