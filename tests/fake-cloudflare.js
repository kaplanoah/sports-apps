// A stand-in for Cloudflare's API that answers every call with success, a Worker's list of secrets
// with `secrets`, and the account's domains with `zones`, and keeps each call it was sent.
export function createFakeCloudflare({ secrets = [], zones = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    let result = {};
    if (url.endsWith("/secrets") && init.method === "GET") result = secrets;
    if (url.includes("/client/v4/zones")) result = zones;
    return new Response(JSON.stringify({ success: true, result }));
  };
  return { fetchImpl, calls };
}
