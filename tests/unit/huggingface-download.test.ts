import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadRepository } from '@/lib/huggingface-download';

afterEach(() => vi.unstubAllGlobals());

function hub(files: string[]) {
  const fetched: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('https://huggingface.co/api/models/')) {
      return new Response(JSON.stringify({ siblings: files.map((rfilename) => ({ rfilename })) }), { status: 200 });
    }
    const file = decodeURIComponent(url.split('/resolve/main/')[1]);
    fetched.push(file);
    return new Response(`contents of ${file}`, { status: 200 });
  }));
  return fetched;
}

const REQUIRED = ['config.json', 'tokenizer.json', 'onnx/model_quantized.onnx'];

describe('downloadRepository', () => {
  it('also fetches the tokenizer config and chat template when the repository has them', async () => {
    const fetched = hub([...REQUIRED, 'tokenizer_config.json', 'chat_template.jinja', 'onnx/model.onnx', 'README.md']);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sqllens-hf-'));
    const result = await downloadRepository('onnx-community', 'Qwen2.5-1.5B-Instruct', dir);

    expect(fetched.sort()).toEqual([...REQUIRED, 'chat_template.jinja', 'tokenizer_config.json'].sort());
    expect(readFileSync(path.join(dir, 'chat_template.jinja'), 'utf8')).toBe('contents of chat_template.jinja');
    expect(existsSync(path.join(dir, 'README.md'))).toBe(false);
    expect(result.missingOptionalFiles).toEqual(['chat_template.json', 'special_tokens_map.json', 'generation_config.json']);
  });

  it('still downloads a repository without the optional files', async () => {
    const fetched = hub(REQUIRED);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sqllens-hf-'));
    const result = await downloadRepository('org', 'model', dir);
    expect(fetched.sort()).toEqual([...REQUIRED].sort());
    expect(result.missingOptionalFiles).toContain('tokenizer_config.json');
  });
});
