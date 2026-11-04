// Controlled SDK for glyph regression, no real Claude Code API call.
import { writeFileSync } from "node:fs";
import activate, { __test } from "../../src/index.ts";
const marker = "GLYPH_PROVIDER_OK";
__test.setQuery((({ options }) => {
  const prompt = options?.systemPrompt?.append ?? "";
  writeFileSync(process.env.GLYPH_PILOT_TRACE!, JSON.stringify({
    append: prompt,
    model: options?.extraArgs?.model ?? options?.model,
    cwd: options?.cwd,
    glyphCodesInForwardedPrompt: [...prompt].filter(x => x.codePointAt(0)! >= 0xE000 && x.codePointAt(0)! <= 0xF8FF).length,
    containsEncodedGlyph: prompt.includes("⟦U"),
    containsNotice: prompt.includes("<glyph-tokens>")
  }, null, 2));
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "assistant", message: { id: "glyph-pilot", content: [{type:"text",text:marker}] }};
      yield { type: "result", subtype: "success", result: marker };
    },
    close() {},
    async interrupt() {}
  };
}) as any);
export default activate;
