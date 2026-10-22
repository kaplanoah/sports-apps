// Node has no Workers runtime, so its two classes stand in for "cloudflare:workers", which the build
// imports in their place (the root's worker/build.mjs).

export class DurableObject {
  /**
   * @param {any} ctx
   * @param {any} env
   */
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint {
  /**
   * @param {any} ctx
   * @param {any} env
   */
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
