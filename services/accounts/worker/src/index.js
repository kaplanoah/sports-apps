import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { createAccounts } from "./accounts.js";

export class AccountStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.accounts = createAccounts({ storage: ctx.storage, emailSecret: env.EMAIL_KEY });
  }

  async isAnswering() {
    await this.ctx.storage.get("health");
    return true;
  }

  async alarm() {
    await this.accounts.sweepChallenges();
  }

  startRegistration(request) {
    return this.accounts.startRegistration(request);
  }

  finishRegistration(request) {
    return this.accounts.finishRegistration(request);
  }

  startSignIn(request) {
    return this.accounts.startSignIn(request);
  }

  finishSignIn(request) {
    return this.accounts.finishSignIn(request);
  }

  readChoices(request) {
    return this.accounts.readChoices(request);
  }

  saveChoices(request) {
    return this.accounts.saveChoices(request);
  }

  removePasskey(request) {
    return this.accounts.removePasskey(request);
  }

  deleteAccount(request) {
    return this.accounts.deleteAccount(request);
  }
}

// One store holds every account, so an email or passkey is looked up in one place.
const findStore = (env) => env.STORE.get(env.STORE.idFromName("accounts"));

// What each app's binding can ask, each answered by the store.
export default class Accounts extends WorkerEntrypoint {
  async readHealth() {
    const ok = await findStore(this.env)
      .isAnswering()
      .catch(() => false);
    return { ok, release: this.env.VERSION?.tag ?? null };
  }

  startRegistration(request) {
    return findStore(this.env).startRegistration(request);
  }

  finishRegistration(request) {
    return findStore(this.env).finishRegistration(request);
  }

  startSignIn(request) {
    return findStore(this.env).startSignIn(request);
  }

  finishSignIn(request) {
    return findStore(this.env).finishSignIn(request);
  }

  readChoices(request) {
    return findStore(this.env).readChoices(request);
  }

  saveChoices(request) {
    return findStore(this.env).saveChoices(request);
  }

  removePasskey(request) {
    return findStore(this.env).removePasskey(request);
  }

  deleteAccount(request) {
    return findStore(this.env).deleteAccount(request);
  }
}
