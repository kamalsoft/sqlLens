// Runs local model generation in its own plain Node process (forked by src/lib/inference.ts).
// Why: on Apple M5 (SME2), onnxruntime's matmul kernels run in SME streaming mode; a signal handled by
// Next's native module during that window executes NEON code and the whole server dies with SIGILL.
// Here no such handler exists, and if the runtime still crashes only this process goes.
// Protocol (IPC, JSON): in { id, type: "generate", modelDir, dtype, messages, limit, maxNewTokens, minNewTokens, temperature }
// and { type: "interrupt" }; out { id, ok: true, text, hitTokenLimit } or { id, ok: false, error: { name, message, ... } }.

const transformers = await import(process.env.SQLLENS_TRANSFORMERS_MODULE || "@huggingface/transformers");

const pipelines = new Map();
let criteria = null;
// An interrupt can arrive while the model is still loading, before there is anything to stop.
let interruptPending = false;

function getPipeline(modelDir, dtype) {
  let loaded = pipelines.get(modelDir);
  if (!loaded) {
    loaded = transformers.pipeline("text-generation", modelDir, { dtype, device: "cpu" });
    loaded.catch(() => pipelines.delete(modelDir));
    pipelines.set(modelDir, loaded);
  }
  return loaded;
}

// Keep in step with runGeneration() in src/lib/inference.ts, which the unit tests run in-process.
async function generate({ modelDir, dtype, messages, limit, maxNewTokens, minNewTokens, temperature }) {
  const generator = await getPipeline(modelDir, dtype);
  const promptText =
    generator.tokenizer?.apply_chat_template?.(messages, { tokenize: false, add_generation_prompt: true }) ??
    messages.map((m) => m.content).join("\n\n");
  const encoded = generator.tokenizer?.encode?.(promptText);
  // Without a tokenizer fall back to a conservative 3 chars/token estimate.
  const promptTokens = encoded ? encoded.length : Math.ceil(promptText.length / 3);
  const remaining = limit - promptTokens;
  if (remaining < Math.min(minNewTokens, maxNewTokens)) {
    return { ok: false, error: { name: "PromptTooLargeError", message: "Prompt is too large", promptTokens, limit } };
  }
  criteria = new transformers.InterruptableStoppingCriteria();
  if (interruptPending) criteria.interrupt();
  const sample = temperature > 0;
  const budget = Math.min(maxNewTokens, remaining);
  const output = await generator(promptText, {
    max_new_tokens: budget,
    ...(sample ? { temperature } : {}),
    do_sample: sample,
    return_full_text: false,
    stopping_criteria: criteria,
  });
  const text = output[0]?.generated_text?.trim() ?? "";
  // Re-encoding can differ by a few tokens from what was generated.
  const outputTokens = generator.tokenizer?.encode?.(text)?.length ?? Math.ceil(text.length / 3);
  return { ok: true, text, hitTokenLimit: outputTokens >= budget - 8 };
}

process.on("message", async (msg) => {
  if (msg?.type === "interrupt") {
    if (criteria) criteria.interrupt();
    else interruptPending = true;
    return;
  }
  if (msg?.type !== "generate") return;
  interruptPending = false;
  let reply;
  try {
    reply = await generate(msg);
  } catch (error) {
    // Runtime errors can carry absolute model paths; keep the home folder out of API responses.
    const message = error instanceof Error ? error.message : String(error);
    reply = { ok: false, error: { name: "Error", message: process.env.HOME ? message.split(process.env.HOME).join("~") : message } };
  } finally {
    criteria = null;
  }
  process.send?.({ id: msg.id, ...reply });
});

// The server went away: nothing is left to answer to.
process.on("disconnect", () => process.exit(0));
