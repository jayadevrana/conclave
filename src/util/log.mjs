const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const codes = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', magenta: '\x1b[35m', blue: '\x1b[34m', gray: '\x1b[90m',
};

function paint(code, s) {
  return useColor ? `${code}${s}${codes.reset}` : s;
}

export const c = new Proxy(codes, {
  get: (t, k) => (s) => paint(t[k] ?? '', s),
});

export function banner(title) {
  const line = '─'.repeat(Math.max(4, title.length + 2));
  console.log('\n' + paint(codes.cyan + codes.bold, `┌${line}┐`));
  console.log(paint(codes.cyan + codes.bold, `│ ${title} │`));
  console.log(paint(codes.cyan + codes.bold, `└${line}┘`));
}

export function phase(n, title) {
  console.log('\n' + paint(codes.bold + codes.cyan, `▏ Phase ${n} · ${title}`));
}

export function step(who, msg = '') {
  console.log(`${paint(codes.magenta, '●')} ${paint(codes.bold, who)} ${paint(codes.dim, msg)}`);
}

export const info = (m) => console.log(paint(codes.dim, `  ${m}`));
export const ok = (m) => console.log(paint(codes.green, `  ✓ ${m}`));
export const warn = (m) => console.log(paint(codes.yellow, `  ! ${m}`));
export const err = (m) => console.log(paint(codes.red, `  ✗ ${m}`));
