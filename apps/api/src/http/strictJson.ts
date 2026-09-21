/**
 * A minimal recursive-descent JSON parser that rejects duplicate object
 * keys, which `JSON.parse` silently allows (last key wins). Used as
 * Fastify's application/json body parser so "duplicate JSON keys" are
 * rejected at the transport boundary before any zod schema ever sees the
 * object -- see docs/PRODUCT_SPEC.md section 6 ("Reject negative amounts,
 * zero refunds, decimals, overflow and duplicate JSON keys").
 *
 * Not a general-purpose JSON parser: it accepts exactly the JSON grammar
 * (RFC 8259) and nothing more permissive.
 */
export class StrictJsonError extends Error {}

export function parseJsonStrict(text: string): unknown {
  const parser = new Parser(text);
  parser.skipWs();
  const value = parser.parseValue();
  parser.skipWs();
  if (parser.pos !== text.length) {
    throw new StrictJsonError(`unexpected trailing content at position ${parser.pos}`);
  }
  return value;
}

class Parser {
  pos = 0;
  constructor(private readonly text: string) {}

  private peek(): string {
    return this.text[this.pos] ?? "";
  }

  skipWs(): void {
    while (this.pos < this.text.length && /[\s]/.test(this.text[this.pos]!)) this.pos++;
  }

  parseValue(): unknown {
    this.skipWs();
    switch (this.peek()) {
      case "{":
        return this.parseObject();
      case "[":
        return this.parseArray();
      case '"':
        return this.parseString();
      case "t":
        return this.parseLiteral("true", true);
      case "f":
        return this.parseLiteral("false", false);
      case "n":
        return this.parseLiteral("null", null);
      default:
        return this.parseNumber();
    }
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (this.text.slice(this.pos, this.pos + literal.length) !== literal) {
      throw new StrictJsonError(`invalid literal at position ${this.pos}`);
    }
    this.pos += literal.length;
    return value;
  }

  private parseObject(): Record<string, unknown> {
    this.pos++; // {
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    this.skipWs();
    if (this.peek() === "}") {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWs();
      if (this.peek() !== '"') throw new StrictJsonError(`expected object key at position ${this.pos}`);
      const key = this.parseString();
      if (seen.has(key)) {
        throw new StrictJsonError(`duplicate JSON key "${key}" at position ${this.pos}`);
      }
      seen.add(key);
      this.skipWs();
      if (this.peek() !== ":") throw new StrictJsonError(`expected ':' at position ${this.pos}`);
      this.pos++;
      result[key] = this.parseValue();
      this.skipWs();
      if (this.peek() === ",") {
        this.pos++;
        continue;
      }
      if (this.peek() === "}") {
        this.pos++;
        return result;
      }
      throw new StrictJsonError(`expected ',' or '}' at position ${this.pos}`);
    }
  }

  private parseArray(): unknown[] {
    this.pos++; // [
    const result: unknown[] = [];
    this.skipWs();
    if (this.peek() === "]") {
      this.pos++;
      return result;
    }
    for (;;) {
      result.push(this.parseValue());
      this.skipWs();
      if (this.peek() === ",") {
        this.pos++;
        continue;
      }
      if (this.peek() === "]") {
        this.pos++;
        return result;
      }
      throw new StrictJsonError(`expected ',' or ']' at position ${this.pos}`);
    }
  }

  private parseString(): string {
    const start = this.pos;
    this.pos++; // opening quote
    let out = "";
    while (this.pos < this.text.length) {
      const c = this.text[this.pos]!;
      if (c === '"') {
        this.pos++;
        return out;
      }
      if (c === "\\") {
        const next = this.text[this.pos + 1];
        switch (next) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            const hex = this.text.slice(this.pos + 2, this.pos + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new StrictJsonError(`invalid unicode escape at position ${this.pos}`);
            out += String.fromCharCode(parseInt(hex, 16));
            this.pos += 4;
            break;
          }
          default:
            throw new StrictJsonError(`invalid escape sequence at position ${this.pos}`);
        }
        this.pos += 2;
        continue;
      }
      out += c;
      this.pos++;
    }
    throw new StrictJsonError(`unterminated string starting at position ${start}`);
  }

  private parseNumber(): number {
    const start = this.pos;
    const re = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    re.lastIndex = this.pos;
    const match = re.exec(this.text);
    if (!match || match.index !== this.pos || match[0].length === 0) {
      throw new StrictJsonError(`invalid value at position ${this.pos}`);
    }
    this.pos += match[0].length;
    return Number(this.text.slice(start, this.pos));
  }
}
