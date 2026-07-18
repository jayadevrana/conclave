import { spawn } from 'node:child_process';

/**
 * Run a command as a child process (no shell — argv is passed directly, so it is
 * safe from shell injection). Captures stdout/stderr, supports feeding stdin, and
 * enforces a hard timeout.
 *
 * @returns {Promise<{ok:boolean, code:number, stdout:string, stderr:string, timedOut:boolean}>}
 */
export function runCommand(cmd, args, { cwd, input, timeoutMs = 900000, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: '', stderr: `[spawn failed] ${err.message}`, timedOut: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: `${stderr}\n[process error] ${err.message}`, timedOut });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code: code ?? -1, stdout, stderr, timedOut });
    });

    if (input != null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}
