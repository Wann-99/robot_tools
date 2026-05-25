// Minimal parser for Google protobuf text format.
// Supports: scalar `key: value`, nested `key { ... }`, repeated keys -> array,
// quoted strings, numbers, booleans, line comments `//` and `#`.

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    if (c === "#" || (c === "/" && src[i + 1] === "/")) {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "{" || c === "}" || c === ":" || c === "[" || c === "]" || c === ",") {
      tokens.push({ t: c }); i++; continue;
    }
    if (c === '"' || c === "'") {
      const quote = c; i++;
      let s = "";
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) { s += src[i] + src[i + 1]; i += 2; }
        else { s += src[i++]; }
      }
      i++;
      tokens.push({ t: "STR", v: unescapeStr(s) });
      continue;
    }
    // identifier / number / bareword
    let j = i;
    while (j < n && !" \t\r\n{}:[],#".includes(src[j])) j++;
    const word = src.slice(i, j);
    tokens.push({ t: "WORD", v: word });
    i = j;
  }
  return tokens;
}

function unescapeStr(s) {
  return s.replace(/\\(.)/g, (_, c) => {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    if (c === "r") return "\r";
    return c;
  });
}

function coerce(word) {
  if (word === "true") return true;
  if (word === "false") return false;
  if (/^-?\d+$/.test(word)) return parseInt(word, 10);
  if (/^-?\d*\.\d+(e[+-]?\d+)?$/i.test(word)) return parseFloat(word);
  return word;
}

function assign(obj, key, value) {
  if (obj[key] === undefined) { obj[key] = value; return; }
  if (Array.isArray(obj[key])) { obj[key].push(value); return; }
  obj[key] = [obj[key], value];
}

export function parseProtoText(src) {
  const tokens = tokenize(src);
  let pos = 0;

  function parseBlock(stopOnBrace) {
    const obj = {};
    while (pos < tokens.length) {
      const tk = tokens[pos];
      if (stopOnBrace && tk.t === "}") { pos++; return obj; }
      if (tk.t !== "WORD") throw new Error(`Expected field name at token ${pos}, got ${JSON.stringify(tk)}`);
      const key = tk.v; pos++;
      const next = tokens[pos];
      if (!next) break;
      if (next.t === ":") {
        pos++;
        const v = tokens[pos++];
        if (!v) throw new Error("Unexpected EOF after ':'");
        if (v.t === "STR") assign(obj, key, v.v);
        else if (v.t === "WORD") assign(obj, key, coerce(v.v));
        else if (v.t === "{") {
          // `key: { ... }` form
          assign(obj, key, parseBlock(true));
        } else if (v.t === "[") {
          // bracketed list `key: [a, b, c]`
          const arr = [];
          while (pos < tokens.length && tokens[pos].t !== "]") {
            const e = tokens[pos++];
            if (e.t === "STR") arr.push(e.v);
            else if (e.t === "WORD") arr.push(coerce(e.v));
            else if (e.t === ",") continue;
            else if (e.t === "{") arr.push(parseBlock(true));
          }
          pos++; // consume ]
          assign(obj, key, arr);
        } else {
          throw new Error(`Unexpected token after ':' at ${pos}`);
        }
      } else if (next.t === "{") {
        pos++;
        assign(obj, key, parseBlock(true));
      } else {
        throw new Error(`Expected ':' or '{' after '${key}' at token ${pos}`);
      }
    }
    return obj;
  }

  return parseBlock(false);
}

// Convenience: always return an array for a possibly-repeated field
export function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
