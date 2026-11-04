import { WorkerEntrypoint } from "cloudflare:workers";
import { createClaudeService } from "./service.js";

export default class Claude extends WorkerEntrypoint {
  readHealth() {
    return createClaudeService(this.env).readHealth();
  }

  readConfig() {
    return createClaudeService(this.env).readConfig();
  }

  /** @param {import("../../../../shared/worker/claude.js").ClaudeRequest} options */
  requestClaude(options) {
    return createClaudeService(this.env).requestClaude(options);
  }
}
