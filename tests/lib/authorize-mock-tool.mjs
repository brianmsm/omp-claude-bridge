/** Test-only simulation of an accepted Claude Code tools/call.
 * Never used by the actual provider. Async SDK generators call this after
 * message_stop, as the CLI would call the MCP handler after permissions hooks.
 */
export async function authorizeMockTool(activeContexts, id, name, args = {}, delayMs = 40) {
  const ctx = [...activeContexts].find(c => c.toolGate.hasProposed(id));
  if (!ctx) throw new Error(`No stream proposed ${id}`);
  if (!ctx.toolGate.authorize(id, name, args)) throw new Error(`Mock MCP authorization rejected for ${id}`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
