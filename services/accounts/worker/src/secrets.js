// The secrets the service can't work without, each with the problem its registration and sign-in
// calls answer while it's missing.
const REQUIRED_SECRETS = [
  { name: "EMAIL_KEY", problem: "no-email-key" },
  { name: "RP_ID", problem: "no-relying-party" },
];

/**
 * @param {Record<string, unknown>} secrets
 * @returns {{ name: string, problem: string }[]}
 */
export const listMissingSecrets = (secrets) =>
  REQUIRED_SECRETS.filter(({ name }) => !secrets[name]);
