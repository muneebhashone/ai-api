import { spawn, type SpawnOptions } from "node:child_process";
import { extname } from "node:path";
import { config } from "../config";

export function needsWindowsShell(bin: string): boolean {
  if (process.platform !== "win32") return false;
  const ext = extname(bin).toLowerCase();
  return ext === ".cmd" || ext === ".bat" || ext === "";
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunOptions {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  swallowStdout?: boolean;
  timeoutMs?: number;
}

export function runWithStdin(
  bin: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const spawnOpts: SpawnOptions = {
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", opts.swallowStdout ? "ignore" : "pipe", "pipe"],
      shell: needsWindowsShell(bin),
      env: opts.env ?? process.env,
      cwd: opts.cwd,
    };
    const child = spawn(bin, args, spawnOpts);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`'${bin}' timed out after ${opts.timeoutMs ?? config.timeouts.cliMs}ms`));
    }, opts.timeoutMs ?? config.timeouts.cliMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    child.on("error", (err) => {
      finish(() => reject(new Error(`spawn '${bin}' failed: ${err.message}`)));
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      const exit = code ?? 0;
      if (exit !== 0) {
        finish(() => reject(
          new Error(
            `'${bin}' exited with code ${exit}. stderr: ${stderr.trim().slice(0, 400) || "(empty)"}`
          )
        ));
        return;
      }
      finish(() => resolve({ stdout, stderr, code: exit }));
    });
    if (opts.stdin !== undefined && child.stdin) child.stdin.end(opts.stdin);
  });
}

/**
 * Spawn a process and yield stdout chunks as they arrive (for streaming).
 * Lines are yielded one at a time when `lineMode: true`.
 */
export async function* spawnStream(
  bin: string,
  args: string[],
  opts: RunOptions & { lineMode?: boolean } = {}
): AsyncGenerator<string, void, unknown> {
  const child = spawn(bin, args, {
    stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    shell: needsWindowsShell(bin),
    env: opts.env ?? process.env,
    cwd: opts.cwd,
  });

  let stderr = "";
  const timeout = setTimeout(() => {
    error = new Error(`'${bin}' timed out after ${opts.timeoutMs ?? config.timeouts.cliMs}ms`);
    child.kill("SIGTERM");
    done = true;
    wake();
  }, opts.timeoutMs ?? config.timeouts.cliMs);
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  if (opts.stdin !== undefined && child.stdin) child.stdin.end(opts.stdin);

  let buffer = "";
  const queue: string[] = [];
  let done = false;
  let error: Error | null = null;
  let resolveWaiter: (() => void) | null = null;

  const wake = () => {
    if (resolveWaiter) {
      resolveWaiter();
      resolveWaiter = null;
    }
  };

  child.on("error", (err) => {
    error = new Error(`spawn '${bin}' failed: ${err.message}`);
    done = true;
    wake();
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    if (opts.lineMode) {
      buffer += text;
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (line) queue.push(line);
      }
    } else {
      queue.push(text);
    }
    wake();
  });
  child.on("close", (code) => {
    clearTimeout(timeout);
    if (opts.lineMode && buffer.trim()) queue.push(buffer.trim());
    if ((code ?? 0) !== 0) {
      error = new Error(
        `'${bin}' exited with code ${code}. stderr: ${stderr.trim().slice(0, 400) || "(empty)"}`
      );
    }
    done = true;
    wake();
  });

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((r) => {
        resolveWaiter = r;
      });
    }
  } finally {
    clearTimeout(timeout);
    if (!done) {
      child.kill("SIGTERM");
    }
  }
}
