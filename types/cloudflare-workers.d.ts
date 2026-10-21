// The parts of the Workers runtime's own module the services use. It exists only in a Worker, so
// Node never imports it and the build leaves it for the runtime.
declare module "cloudflare:workers" {
  export class DurableObject<Env = any> {
    constructor(ctx: any, env: Env);
    protected ctx: any;
    protected env: Env;
  }
  export class WorkerEntrypoint<Env = any> {
    constructor(ctx: any, env: Env);
    protected ctx: any;
    protected env: Env;
  }
}
