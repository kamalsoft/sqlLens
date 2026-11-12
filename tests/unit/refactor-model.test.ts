import { describe, expect, it } from 'vitest';
import { chooseRefactorModel } from '@/lib/installed-models';

const m = (id: string, parameterEstimate: number | null, compatible = true) => ({ id, compatible, parameterEstimate });

describe('chooseRefactorModel', () => {
  const models = [m('small-0.5b', 5e8), m('coder-1.5b', 1.5e9), m('unknown', null), m('big-7b-gguf', 7e9, false)];

  it('uses the model chosen in Settings when it is installed and compatible', () => {
    expect(chooseRefactorModel(models, 'small-0.5b')?.id).toBe('small-0.5b');
  });

  it('otherwise picks the largest compatible model, skipping incompatible ones', () => {
    expect(chooseRefactorModel(models, '')?.id).toBe('coder-1.5b');
    expect(chooseRefactorModel(models, 'big-7b-gguf')?.id).toBe('coder-1.5b');
    expect(chooseRefactorModel(models, 'removed-model')?.id).toBe('coder-1.5b');
  });

  it('returns null when no compatible model is installed', () => {
    expect(chooseRefactorModel([m('big-7b-gguf', 7e9, false)], '')).toBeNull();
  });

  it('ranks a model of unknown size last, and keeps list order on a tie', () => {
    expect(chooseRefactorModel([m('unknown', null), m('tiny', 1e8)], '')?.id).toBe('tiny');
    expect(chooseRefactorModel([m('a-1b', 1e9), m('b-1b', 1e9)], '')?.id).toBe('a-1b');
  });

  it('prefers an instruction-tuned model with a chat template over a larger base model', () => {
    // The models installed on 2026-11-12: automatic used to pick the base Qwen2.5-1.5B, which loops.
    const installed = [
      { ...m('onnx-community/Qwen2.5-1.5B', 1.65e9), chatTemplate: true },
      { ...m('onnx-community/Qwen2.5-1.5B-Instruct', 1.65e9), chatTemplate: false },
      { ...m('onnx-community/Qwen2.5-0.5B-Instruct-ONNX', 5.3e8), chatTemplate: true },
      { ...m('onnx-community/LFM2-1.2B-ONNX', 1.61e9), chatTemplate: true },
    ];
    expect(chooseRefactorModel(installed, '')?.id).toBe('onnx-community/Qwen2.5-0.5B-Instruct-ONNX');
    // Once the 1.5B Instruct download is complete (chat template present), it wins.
    installed[1] = { ...installed[1], chatTemplate: true };
    expect(chooseRefactorModel(installed, '')?.id).toBe('onnx-community/Qwen2.5-1.5B-Instruct');
    // A choice made in Settings still wins.
    expect(chooseRefactorModel(installed, 'onnx-community/LFM2-1.2B-ONNX')?.id).toBe('onnx-community/LFM2-1.2B-ONNX');
  });

  it('reads -it and -chat as instruction-tuned, but not "chat" or "it" inside a word', () => {
    const pick = (ids: string[]) => chooseRefactorModel(ids.map((id) => ({ ...m(id, 1e9), chatTemplate: true })), '')?.id;
    expect(pick(['org/model-base', 'org/gemma-2b-it'])).toBe('org/gemma-2b-it');
    expect(pick(['org/model-base', 'org/llama-chat'])).toBe('org/llama-chat');
    // Neither is instruction-tuned, so size decides: "chatglm" must not count as a chat model.
    const sized = [{ ...m('org/chatglm-base', 1e9), chatTemplate: true }, { ...m('org/bitnet', 2e9), chatTemplate: true }];
    expect(chooseRefactorModel(sized, '')?.id).toBe('org/bitnet');
  });
});

