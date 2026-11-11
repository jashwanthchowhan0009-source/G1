// Chat client for any OpenAI-compatible endpoint (Gemini, Groq, OpenAI, a local model, or G1's own /api/chat proxy).

export function createLLM({ url, headers = {}, model = '', fetch: fetchImpl = globalThis.fetch, timeout = 40000 }) {
  async function post(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'The AI service took too long to answer.' : 'Could not reach the AI service.');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = '';
      try {
        let j = await res.json();
        if (Array.isArray(j)) j = j[0];
        detail = j?.error?.message || j?.error || j?.message || '';
        if (typeof detail !== 'string') detail = JSON.stringify(detail);
      } catch {
        /* no body */
      }
      const hint = res.status === 401 || res.status === 403 ? 'The AI key was rejected.' : res.status === 429 ? 'The AI service is rate-limiting this key.' : `The AI service answered ${res.status}.`;
      const err = new Error(detail ? `${hint} ${detail.slice(0, 200)}` : hint);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  return {
    model,
    /**
     * One model turn. `messages` are OpenAI-format messages without the system message.
     * Returns { message, text, toolCalls: [{ id, name, args }] }.
     * `message` is the assistant message exactly as received, so provider-specific fields
     * on tool calls (for example Gemini thought signatures) survive the round trip.
     */
    async chat({ system, messages, tools }) {
      const body = { messages: system ? [{ role: 'system', content: system }, ...messages] : messages, temperature: 0.6 };
      if (model) body.model = model;
      if (tools?.length) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
      const json = await post(body);
      const message = json?.choices?.[0]?.message;
      if (!message) throw new Error('The AI service sent an empty answer.');
      const toolCalls = (message.tool_calls || [])
        .filter((tc) => tc?.function?.name)
        .map((tc, i) => {
          let args = {};
          try {
            args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : tc.function.arguments || {};
          } catch {
            args = {};
          }
          if (!tc.id) tc.id = `call_${Date.now()}_${i}`;
          return { id: tc.id, name: tc.function.name, args };
        });
      const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map((p) => p.text || '').join('') : '';
      if (message.content == null) message.content = '';
      return { message, text: text.trim(), toolCalls };
    },
    /** Ask about a photo (data URL). */
    async see(imageDataUrl, question, system) {
      const r = await this.chat({
        system,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: question },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      });
      return r.text;
    },
  };
}
