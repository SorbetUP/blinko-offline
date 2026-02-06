import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1FinishReason,
  LanguageModelV1StreamPart,
} from '@ai-sdk/provider';
import { spawn } from 'child_process';
import fs from 'fs';
import { promptToPlainText } from './promptToText';

type ClaudeCodeCliLanguageModelOptions = {
  modelId: string;
  cliPath?: string;
};

function expandHome(p: string): string {
  if (!p.startsWith('~')) return p;
  const home = process.env.HOME;
  if (!home) return p;
  if (p === '~') return home;
  if (p.startsWith('~/')) return `${home}${p.slice(1)}`;
  return p;
}

function resolveClaudeCliPath(cliPath?: string): string {
  if (cliPath) return expandHome(cliPath);
  const fallback = expandHome('~/.local/bin/claude');
  if (fs.existsSync(fallback)) return fallback;
  return 'claude';
}

function chunkText(text: string, chunkSize = 2048): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
  return chunks;
}

function forEachJsonLine(onLine: (obj: any) => void) {
  let buffer = '';
  return (chunk: Buffer | Uint8Array) => {
    buffer += Buffer.from(chunk).toString('utf8');
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        onLine(JSON.parse(line));
      } catch {
        // ignore
      }
    }
  };
}

function extractAssistantText(evt: any): string | null {
  if (!evt || evt.type !== 'assistant') return null;
  const content = evt?.message?.content;
  if (!Array.isArray(content)) return null;
  return content
    .map((part: any) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

export class ClaudeCodeCliLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = 'v1' as const;
  readonly provider = 'anthropic' as const;
  readonly modelId: string;
  readonly defaultObjectGenerationMode = undefined;
  readonly supportsStructuredOutputs = false;

  private readonly cliPath: string;

  constructor(opts: ClaudeCodeCliLanguageModelOptions) {
    this.modelId = opts.modelId;
    this.cliPath = resolveClaudeCliPath(opts.cliPath);
  }

  async doGenerate(options: LanguageModelV1CallOptions) {
    const promptText = promptToPlainText(options.prompt);

    const { text, usage } = await new Promise<{
      text: string;
      usage: { promptTokens: number; completionTokens: number };
    }>((resolve, reject) => {
      const args = [
        '--print',
        '--output-format',
        'text',
        '--permission-mode',
        'dontAsk',
        '--no-session-persistence',
        '--tools',
        '',
      ];

      if (this.modelId) args.push('--model', this.modelId);
      args.push('--', promptText);

      const child = spawn(this.cliPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += Buffer.from(d).toString('utf8');
      });
      child.stderr.on('data', (d) => {
        stderr += Buffer.from(d).toString('utf8');
      });

      child.on('error', (err: any) => {
        if (err?.code === 'ENOENT') {
          reject(new Error('claude CLI not found. Install/login Claude Code or set provider config cliPath.'));
          return;
        }
        reject(err);
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude --print failed (exit ${code}). ${stderr.trim()}`.trim()));
          return;
        }
        resolve({
          text: stdout.trimEnd(),
          usage: { promptTokens: 0, completionTokens: 0 },
        });
      });
    });

    return {
      text,
      finishReason: 'stop' as LanguageModelV1FinishReason,
      usage,
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: { via: 'claude-code-cli', model: this.modelId },
      },
      rawResponse: undefined,
      warnings: [],
    };
  }

  async doStream(options: LanguageModelV1CallOptions) {
    const promptText = promptToPlainText(options.prompt);

    const stream = new ReadableStream<LanguageModelV1StreamPart>({
      start: (controller) => {
        const args = [
          '--print',
          '--verbose',
          '--output-format',
          'stream-json',
          '--include-partial-messages',
          '--permission-mode',
          'dontAsk',
          '--no-session-persistence',
          '--tools',
          '',
        ];

        if (this.modelId) args.push('--model', this.modelId);
        args.push('--', promptText);

        const child = spawn(this.cliPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        });

        let emittedText = '';
        let promptTokens = 0;
        let completionTokens = 0;
        let stderr = '';
        let sawError = false;

        child.stdout.on(
          'data',
          forEachJsonLine((evt) => {
            const assistantText = extractAssistantText(evt);
            if (assistantText != null) {
              const delta = assistantText.startsWith(emittedText)
                ? assistantText.slice(emittedText.length)
                : assistantText;
              emittedText = assistantText;
              for (const chunk of chunkText(delta)) {
                controller.enqueue({ type: 'text-delta', textDelta: chunk });
              }
              return;
            }

            if (evt?.type === 'result') {
              const usage = evt?.usage;
              promptTokens = Number(usage?.input_tokens || 0);
              completionTokens = Number(usage?.output_tokens || 0);

              if (evt?.is_error) {
                sawError = true;
                controller.enqueue({ type: 'error', error: new Error(String(evt?.result || 'Claude error')) });
                controller.enqueue({
                  type: 'finish',
                  finishReason: 'error',
                  usage: { promptTokens, completionTokens },
                });
                controller.close();
              }
            }
          }),
        );

        child.stderr.on('data', (d) => {
          stderr += Buffer.from(d).toString('utf8');
        });

        child.on('error', (err: any) => {
          sawError = true;
          const wrapped =
            err?.code === 'ENOENT'
              ? new Error('claude CLI not found. Install/login Claude Code or set provider config cliPath.')
              : err;
          controller.enqueue({ type: 'error', error: wrapped });
          controller.close();
        });

        child.on('close', (code) => {
          if (sawError) return;
          if (code !== 0) {
            controller.enqueue({ type: 'error', error: new Error(`claude --print failed (exit ${code}). ${stderr.trim()}`.trim()) });
            controller.enqueue({ type: 'finish', finishReason: 'error', usage: { promptTokens, completionTokens } });
            controller.close();
            return;
          }
          controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { promptTokens, completionTokens } });
          controller.close();
        });
      },
    });

    return {
      stream,
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: { via: 'claude-code-cli', model: this.modelId },
      },
      warnings: [],
    };
  }
}

