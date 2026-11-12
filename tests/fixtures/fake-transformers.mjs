// Stands in for @huggingface/transformers inside scripts/inference-worker.mjs (tests only).
// The user message picks the behaviour: CRASH kills the process, WAIT runs until interrupted, HANG never ends.
export class InterruptableStoppingCriteria {
  interrupted = false;
  interrupt() { this.interrupted = true; }
}

export async function pipeline() {
  const generator = async (prompt, options) => {
    if (prompt.includes("CRASH")) process.kill(process.pid, "SIGILL");
    if (prompt.includes("HANG")) await new Promise(() => {}); // ignores interrupts
    if (prompt.includes("WAIT")) {
      while (!options.stopping_criteria.interrupted) await new Promise((r) => setTimeout(r, 10));
      return [{ generated_text: "stopped" }];
    }
    return [{ generated_text: ` echo:${prompt} ` }];
  };
  generator.tokenizer = {
    apply_chat_template: (messages) => messages.map((m) => `${m.role}:${m.content}`).join("|"),
    encode: (text) => ({ length: text.length }),
  };
  return generator;
}
