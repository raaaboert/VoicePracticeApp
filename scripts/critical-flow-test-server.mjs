// Isolated Critical Flow child only. Never used by application start commands.
import dotenv from "dotenv";
import { realpath } from "node:fs/promises";
import { Socket } from "node:net";
import os from "node:os";
import path from "node:path";

const hosted = ["RENDER", "RENDER_SERVICE_ID", "RENDER_GIT_COMMIT", "VERCEL", "VERCEL_ENV"];
const mode = process.argv[2];
const temporary = path.resolve(process.env.CRITICAL_FLOW_TEMP_DIR || ".");
if (!process.send || process.env.CRITICAL_FLOW_FIXTURE !== "1" || process.env.NODE_ENV !== "test"
  || process.env.PERITIO_ENV !== "development" || process.env.STORAGE_PROVIDER !== "file"
  || process.env.AUTH_CODE_DELIVERY_PROVIDER !== "log_only"
  || process.env.WEB_AUTH_CODE_DELIVERY_PROVIDER !== "log_only"
  || process.env.MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER !== "log_only"
  || process.env.MOBILE_REVERIFY_ON_ONBOARD !== "true"
  || hosted.some(key => Object.hasOwn(process.env, key))
  || ["DATABASE_URL", "OPENAI_API_KEY", "RESEND_API_KEY", "APP_REVIEW_CODE"].some(key => Object.hasOwn(process.env, key))
  || !["--built", "--source"].includes(mode)
  || path.dirname(temporary) !== path.resolve(os.tmpdir())
  || !path.basename(temporary).startsWith("voicepractice-critical-flow-")
  || path.resolve(process.env.DB_PATH || ".") !== path.join(temporary, "db.json")) {
  throw new Error("Critical Flow child requires explicit offline test isolation and private IPC.");
}
const actual = await realpath(temporary);
if (path.relative(actual, temporary) !== "") throw new Error("Critical Flow temporary directory must not be redirected.");

// Never load workstation/provider env files or allow provider/database calls.
dotenv.config = () => ({ parsed: {} });
Socket.prototype.connect = function () { throw new Error("Outbound connections are forbidden in the Critical Flow child."); };
const directory = mode === "--built" ? "dist" : "src";
const extension = mode === "--built" ? "js" : "ts";
const delivery = await import(new URL(`../api/${directory}/services/authCodeDelivery.${extension}`, import.meta.url));
delivery.setAuthCodeDeliveryObserverForTest(params => {
  // Freshly generated codes remain in memory and travel only to the owning process.
  process.send({ kind: "verification-code", ...params });
});
const api = await import(new URL(`../api/${directory}/index.${extension}`, import.meta.url));
let server;
const listen = api.app.listen.bind(api.app);
api.app.listen = (port, callback) => (server = listen(port, "127.0.0.1", callback));
function stop() {
  delivery.setAuthCodeDeliveryObserverForTest(null);
  if (!server) process.exit(0);
  server.close(() => process.exit(0));
  server.closeAllConnections();
}
process.on("message", message => { if (message?.kind === "stop") stop(); });
process.once("disconnect", stop);
await api.startApiServer();
process.send({ kind: "ready", port: server.address().port });
