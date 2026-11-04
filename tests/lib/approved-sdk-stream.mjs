/** Test harness that simulates Claude Code MCP tools/call for tool_use blocks.
 * This is NOT a production bypass: tests invoke the real authorization gate
 * explicitly after the SDK stream has proposed and completed a call. Tests of
 * denials use the original generator without this wrapper.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function* approvedSdkStream(messages, ctx, toolMap, { settleMs = 40 } = {}) {
  const streamed = new Map();
  const byIndex = new Map();
  for (const message of messages) {
    const event = message?.type === "stream_event" ? message.event : null;
    if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") {
      const b = event.content_block;
      streamed.set(b.id, { id: b.id, name: b.name, json: "", initial: b.input ?? {}, completed: false });
      byIndex.set(event.index, b.id);
    }
    if (event?.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
      const p = streamed.get(byIndex.get(event.index));
      if (p) p.json += event.delta.partial_json;
    }
    if (event?.type === "content_block_stop") {
      const p = streamed.get(byIndex.get(event.index));
      if (p) p.completed = true;
    }

    yield message;

    if (event?.type === "message_stop") {
      const approvals = [];
      for (const p of streamed.values()) {
        if (!p.completed) continue;
        const piName = toolMap.get(p.name);
        if (!piName) continue;
        let args = p.initial;
        if (p.json) try { args = JSON.parse(p.json); } catch { continue; }
        approvals.push({ id: p.id, name: piName, args });
      }
      for (const p of approvals) ctx.toolGate.authorize(p.id, p.name, p.args);
      if (approvals.length) await sleep(settleMs);
      streamed.clear();
      byIndex.clear();
    }

    if (message?.type === "assistant") {
      const proposals = (message.message?.content ?? []).filter(b => b.type === "tool_use");
      const approved = proposals.map(b => ({ id: b.id, name: toolMap.get(b.name), args: b.input }));
      // Only a new non-streaming fallback is staged here; duplicates are ignored.
      let succeeded = false;
      for (const p of approved) {
        if (p.name && ctx.toolGate.authorize(p.id, p.name, p.args)) succeeded = true;
      }
      if (succeeded) await sleep(settleMs);
    }
  }
}
