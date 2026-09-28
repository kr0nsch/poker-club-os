// Safe arithmetic expression language for league scoring (no eval).
//   expression := additive
//   operators  := + - * / ^ (right-assoc) unary -
//   functions  := sqrt ln log10 log(x[,base]) min max round floor ceil abs pow
//   constants  := e pi

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

const FUNCTIONS: Record<string, { min: number; max: number; fn: (...a: number[]) => number }> = {
  sqrt: { min: 1, max: 1, fn: Math.sqrt },
  ln: { min: 1, max: 1, fn: Math.log },
  log10: { min: 1, max: 1, fn: Math.log10 },
  log: { min: 1, max: 2, fn: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)) },
  min: { min: 1, max: 16, fn: Math.min },
  max: { min: 1, max: 16, fn: Math.max },
  round: { min: 1, max: 1, fn: Math.round },
  floor: { min: 1, max: 1, fn: Math.floor },
  ceil: { min: 1, max: 1, fn: Math.ceil },
  abs: { min: 1, max: 1, fn: Math.abs },
  pow: { min: 2, max: 2, fn: Math.pow },
};
const CONSTANTS: Record<string, number> = { e: Math.E, pi: Math.PI };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError(`bad number at ${i}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new FormulaError(`unexpected character '${c}' at ${i}`);
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const n = this.additive();
    if (this.pos < this.tokens.length) throw new FormulaError("unexpected trailing input");
    return n;
  }
  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private isOp(v: string) {
    const t = this.peek();
    return t?.t === "op" && t.v === v;
  }
  private expectOp(v: string) {
    if (!this.isOp(v)) throw new FormulaError(`expected '${v}'`);
    this.pos++;
  }
  private additive(): Node {
    let a = this.multiplicative();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.tokens[this.pos++] as { v: "+" | "-" }).v;
      a = { k: "bin", op, a, b: this.multiplicative() };
    }
    return a;
  }
  private multiplicative(): Node {
    let a = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.tokens[this.pos++] as { v: "*" | "/" }).v;
      a = { k: "bin", op, a, b: this.unary() };
    }
    return a;
  }
  private unary(): Node {
    if (this.isOp("-")) {
      this.pos++;
      return { k: "neg", a: this.unary() };
    }
    if (this.isOp("+")) {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }
  private power(): Node {
    const base = this.primary();
    if (this.isOp("^")) {
      this.pos++;
      return { k: "bin", op: "^", a: base, b: this.unary() };
    }
    return base;
  }
  private primary(): Node {
    const t = this.peek();
    if (!t) throw new FormulaError("unexpected end of expression");
    if (t.t === "num") {
      this.pos++;
      return { k: "num", v: t.v };
    }
    if (t.t === "id") {
      this.pos++;
      if (this.isOp("(")) {
        this.pos++;
        const fn = t.v.toLowerCase();
        const def = FUNCTIONS[fn];
        if (!def) throw new FormulaError(`unknown function '${t.v}'`);
        const args: Node[] = [];
        if (!this.isOp(")")) {
          args.push(this.additive());
          while (this.isOp(",")) {
            this.pos++;
            args.push(this.additive());
          }
        }
        this.expectOp(")");
        if (args.length < def.min || args.length > def.max) throw new FormulaError(`${fn} expects ${def.min}-${def.max} arguments`);
        return { k: "call", fn, args };
      }
      return { k: "var", name: t.v };
    }
    if (t.v === "(") {
      this.pos++;
      const n = this.additive();
      this.expectOp(")");
      return n;
    }
    throw new FormulaError(`unexpected '${t.v}'`);
  }
}

function collectVars(n: Node, out: Set<string>) {
  switch (n.k) {
    case "var":
      out.add(n.name);
      break;
    case "neg":
      collectVars(n.a, out);
      break;
    case "bin":
      collectVars(n.a, out);
      collectVars(n.b, out);
      break;
    case "call":
      n.args.forEach((a) => collectVars(a, out));
      break;
  }
}

function evaluate(n: Node, vars: Record<string, number>): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "var": {
      if (n.name in vars) return vars[n.name]!;
      if (n.name in CONSTANTS) return CONSTANTS[n.name]!;
      throw new FormulaError(`unknown variable '${n.name}'`);
    }
    case "neg":
      return -evaluate(n.a, vars);
    case "bin": {
      const a = evaluate(n.a, vars);
      const b = evaluate(n.b, vars);
      switch (n.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          if (b === 0) throw new FormulaError("division by zero");
          return a / b;
        case "^":
          return Math.pow(a, b);
      }
      break;
    }
    case "call":
      return FUNCTIONS[n.fn]!.fn(...n.args.map((a) => evaluate(a, vars)));
  }
  throw new FormulaError("invalid expression");
}

export interface CompiledFormula {
  variables: string[];
  evaluate(vars: Record<string, number>): number;
}

export function compileFormula(source: string, allowedVariables: readonly string[]): CompiledFormula {
  if (source.length > 500) throw new FormulaError("expression too long");
  const ast = new Parser(tokenize(source)).parse();
  const vars = new Set<string>();
  collectVars(ast, vars);
  for (const v of vars) {
    if (!allowedVariables.includes(v) && !(v in CONSTANTS)) throw new FormulaError(`unknown variable '${v}'`);
  }
  return {
    variables: [...vars],
    evaluate(values) {
      const r = evaluate(ast, values);
      if (!Number.isFinite(r)) throw new FormulaError("result is not a finite number");
      return r;
    },
  };
}
