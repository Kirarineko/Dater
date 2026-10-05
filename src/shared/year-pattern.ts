// Decimal regular expressions are compiled to a finite automaton. Digit counting
// keeps leap totals independent of the distance between the requested years.
type Node =
  | { kind: "chars"; chars: string[] }
  | { kind: "sequence"; nodes: Node[] }
  | { kind: "choice"; nodes: Node[] }
  | { kind: "repeat"; node: Node; min: number; max: number | null };
const alphabet = "0123456789-";

class Parser {
  private position = 0;
  constructor(private readonly source: string) {}

  parse(): Node {
    const result = this.choice();
    if (this.position !== this.source.length) throw new Error("正则存在不支持的符号或括号。");
    return result;
  }

  private choice(): Node {
    const nodes = [this.sequence()];
    while (this.source[this.position] === "|") {
      this.position++;
      nodes.push(this.sequence());
    }
    return { kind: "choice", nodes };
  }

  private sequence(): Node {
    const nodes: Node[] = [];
    while (this.position < this.source.length && !")|".includes(this.source[this.position] ?? "")) {
      let node = this.atom();
      const token = this.source[this.position];
      if (token && "?*+".includes(token)) {
        this.position++;
        node = { kind: "repeat", node, min: token === "+" ? 1 : 0, max: token === "?" ? 1 : null };
      } else if (token === "{") {
        const match = /^\{(\d+)(?:,(\d*))?\}/.exec(this.source.slice(this.position));
        if (!match?.[1]) throw new Error("正则重复次数格式不正确。");
        this.position += match[0].length;
        const min = Number(match[1]);
        const max = match[2] === undefined ? min : match[2] === "" ? null : Number(match[2]);
        if (min > 32 || (max !== null && (max > 32 || max < min))) throw new Error("正则有限重复次数须为 0–32。");
        node = { kind: "repeat", node, min, max };
      }
      nodes.push(node);
    }
    return { kind: "sequence", nodes };
  }

  private atom(): Node {
    const token = this.source[this.position++];
    if (token === "(") {
      if (this.source.slice(this.position, this.position + 2) === "?:") this.position += 2;
      const node = this.choice();
      if (this.source[this.position++] !== ")") throw new Error("正则括号没有闭合。");
      return node;
    }
    if (token === ".") return { kind: "chars", chars: [...alphabet] };
    if (token === "\\") {
      const escaped = this.source[this.position++];
      if (escaped === "d") return { kind: "chars", chars: [..."0123456789"] };
      if (escaped === "-") return { kind: "chars", chars: ["-"] };
      throw new Error("仅支持 \\d 和 \\- 转义；不支持回溯引用、环视或标志。");
    }
    if (token === "[") {
      let negate = false;
      if (this.source[this.position] === "^") { negate = true; this.position++; }
      const chars = new Set<string>();
      while (this.source[this.position] !== "]") {
        const first = this.source[this.position++];
        if (!first) throw new Error("正则字符组没有闭合。");
        if (first === "\\" && this.source[this.position] === "d") {
          this.position++;
          for (const digit of "0123456789") chars.add(digit);
        } else if (/\d/.test(first) && this.source[this.position] === "-" && /\d/.test(this.source[this.position + 1] ?? "")) {
          this.position++;
          const last = this.source[this.position++];
          if (!last || last < first) throw new Error("正则数字范围无效。");
          for (let digit = Number(first); digit <= Number(last); digit++) chars.add(String(digit));
        } else if (alphabet.includes(first)) chars.add(first);
        else throw new Error("正则字符组只支持数字、负号和 \\d。");
      }
      this.position++;
      if (chars.size === 0) throw new Error("正则字符组不能为空。");
      return { kind: "chars", chars: [...alphabet].filter(char => negate !== chars.has(char)) };
    }
    if (token && alphabet.includes(token)) return { kind: "chars", chars: [token] };
    throw new Error("正则支持数字、负号、.、[]、()、|、?、*、+、{n,m} 和首尾锚点。");
  }
}

interface State { epsilon: number[]; edges: { chars: string[]; to: number }[] }

export class YearPatterns {
  private readonly states: State[] = [];
  private readonly subsets: number[][] = [];
  private readonly subsetIds = new Map<string, number>();
  private readonly transitions: number[][] = [];
  private readonly accepting: boolean[] = [];
  private readonly countingCaches = new Map<string, Map<number, bigint>>();
  private readonly finish: number;
  readonly initial: number;

  constructor(patterns: string[]) {
    if (patterns.length > 8) throw new Error("最多设置 8 条正则闰年规则。");
    const expressions: Node[] = patterns.map(pattern => {
      if (pattern.length > 160) throw new Error("每条正则最多 160 个字符。");
      const start = pattern.startsWith("^");
      const end = pattern.endsWith("$");
      const source = pattern.slice(start ? 1 : 0, end ? -1 : undefined);
      if (!source) throw new Error("正则不能只包含锚点或为空。");
      const nodes: Node[] = [];
      const wildcard: Node = { kind: "repeat", node: { kind: "chars", chars: [...alphabet] }, min: 0, max: null };
      if (!start) nodes.push(wildcard);
      const expression = new Parser(source).parse();
      if ((start || end) && expression.kind === "choice" && expression.nodes.length > 1) {
        throw new Error("使用锚点的交替规则须加外层括号，例如 ^(1|2)$，避免锚点范围产生歧义。");
      }
      nodes.push(expression);
      if (!end) nodes.push(wildcard);
      return { kind: "sequence", nodes };
    });
    const [start, finish] = this.compile({ kind: "choice", nodes: expressions });
    this.finish = finish;
    this.initial = this.intern([start]);
    // Materialize the reachable DFA once, with a complexity limit before saving.
    for (let id = 0; id < this.subsets.length; id++) {
      for (const char of alphabet) this.next(id, char);
    }
  }

  private state(): number {
    if (this.states.length >= 768) throw new Error("正则过于复杂，请简化重复次数或分支。");
    this.states.push({ epsilon: [], edges: [] });
    return this.states.length - 1;
  }

  private connect(a: number, b: number): void { this.states[a]?.epsilon.push(b); }

  private compile(node: Node): [number, number] {
    const start = this.state();
    const end = this.state();
    if (node.kind === "chars") this.states[start]?.edges.push({ chars: node.chars, to: end });
    else if (node.kind === "choice" || node.kind === "sequence") {
      if (node.kind === "sequence") {
        let tail = start;
        for (const child of node.nodes) {
          const [a, b] = this.compile(child);
          this.connect(tail, a); tail = b;
        }
        this.connect(tail, end);
        return [start, end];
      }
      for (const child of node.nodes) {
        const [a, b] = this.compile(child);
        this.connect(start, a); this.connect(b, end);
      }
    } else {
      let tail = start;
      for (let i = 0; i < node.min; i++) {
        const [a, b] = this.compile(node.node);
        this.connect(tail, a); tail = b;
      }
      this.connect(tail, end);
      if (node.max === null) {
        const [a, b] = this.compile(node.node);
        this.connect(tail, a); this.connect(b, tail);
      } else {
        for (let i = node.min; i < node.max; i++) {
          const [a, b] = this.compile(node.node);
          this.connect(tail, a); tail = b; this.connect(tail, end);
        }
      }
    }
    return [start, end];
  }

  private intern(seed: number[]): number {
    const seen = new Set(seed);
    const queue = [...seed];
    for (let i = 0; i < queue.length; i++) {
      for (const next of this.states[queue[i] ?? -1]?.epsilon ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    const values = [...seen].sort((a, b) => a - b);
    const key = values.join(",");
    const known = this.subsetIds.get(key);
    if (known !== undefined) return known;
    if (this.subsets.length >= 96) throw new Error("正则状态过多，请简化规则。");
    const id = this.subsets.length;
    this.subsetIds.set(key, id); this.subsets.push(values);
    this.accepting.push(seen.has(this.finish)); this.transitions.push([]);
    return id;
  }

  next(id: number, char: string): number {
    const index = alphabet.indexOf(char);
    const known = this.transitions[id]?.[index];
    if (known !== undefined) return known;
    const targets: number[] = [];
    for (const state of this.subsets[id] ?? []) {
      for (const edge of this.states[state]?.edges ?? []) {
        if (edge.chars.includes(char)) targets.push(edge.to);
      }
    }
    const next = this.intern(targets);
    const row = this.transitions[id];
    if (row) row[index] = next;
    return next;
  }

  matches(year: bigint): boolean {
    let state = this.initial;
    for (const char of year.toString()) state = this.next(state, char);
    return this.accepting[state] ?? false;
  }

  validateComplexity(modulus: number): void {
    if (this.subsets.length * modulus > 4096) throw new Error("正则与基础周期的组合过于复杂，请减少分支或缩短周期。");
  }

  // Count nonnegative magnitudes <= bound whose signed representation matches,
  // excluding years already covered by the base leap rule.
  count(bound: bigint, negative: boolean, modulus: number, isBaseLeap: (remainder: number) => boolean): bigint {
    if (bound < 0n) return 0n;
    const digits = bound.toString();
    const initial = negative ? this.next(this.initial, "-") : this.initial;
    const base = Array.from({ length: modulus }, (_, remainder) => isBaseLeap(remainder));
    const scope = `${Number(negative)}:${modulus}:${base.map(Number).join("")}`;
    let cache = this.countingCaches.get(scope);
    if (!cache) { cache = new Map(); this.countingCaches.set(scope, cache); }
    if (cache.size > 400000) cache.clear();
    const visit = (position: number, state: number, remainder: number, started: boolean, tight: boolean): bigint => {
      if (position === digits.length) {
        if (!started) return negative ? 0n : this.matches(0n) && !base[0] ? 1n : 0n;
        return this.accepting[state] && !base[remainder] ? 1n : 0n;
      }
      const key = (((digits.length - position) * this.subsets.length + state) * modulus + remainder) * 2 + Number(started);
      if (!tight) { const known = cache.get(key); if (known !== undefined) return known; }
      const digit = Number(digits[position]);
      const limit = tight ? digit : 9;
      let total = 0n;
      for (let value = 0; value <= limit; value++) {
        const nextStarted = started || value !== 0;
        total += visit(position + 1, nextStarted ? this.next(state, String(value)) : initial,
          nextStarted ? (remainder * 10 + value) % modulus : 0, nextStarted, tight && value === digit);
      }
      if (!tight) cache.set(key, total);
      return total;
    };
    return visit(0, initial, 0, false, true);
  }
}
