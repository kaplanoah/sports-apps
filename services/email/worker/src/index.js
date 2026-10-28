import { WorkerEntrypoint } from "cloudflare:workers";
import { createEmailService } from "./service.js";

export { EmailOutbox } from "./outbox.js";

export default class Email extends WorkerEntrypoint {
  readHealth() {
    return createEmailService(this.env).readHealth();
  }

  readContactConfig() {
    return createEmailService(this.env).readContactConfig();
  }

  submitContact(request) {
    return createEmailService(this.env).submitContact(request);
  }
}
