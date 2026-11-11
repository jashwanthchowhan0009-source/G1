// Link to G1 Core (the Python service on the Dev Kit or a PC). Core adds the heavy skills:
// making videos, posting to YouTube, SMS through G1's own SIM, WhatsApp from G1's business number.
// When the app is not served by a Core, available() is false and those skills say so.

export function createCoreLink({ fetch: fetchImpl = globalThis.fetch, getServer, settings }) {
  const server = () => getServer() || {};
  return {
    available: () => Boolean(server().core),
    /** feature: 'sim' | 'whatsapp_api' | 'youtube' */
    can: (feature) => Boolean(server().core && server()[feature]),
    async run(name, args, approved = false) {
      const key = settings.get().passcode;
      const res = await fetchImpl('/api/skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { 'x-g1-key': key } : {}) },
        body: JSON.stringify({ name, args, approved }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? 'G1 Core rejected the device key.' : `G1 Core answered ${res.status}.`);
      return res.json();
    },
  };
}
