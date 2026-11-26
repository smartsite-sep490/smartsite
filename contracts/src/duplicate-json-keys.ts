/** Detects duplicate object keys in JSON text before object literal key collapsing. */
export function hasDuplicateJsonKeys(text: string): boolean {
  const stack: ({ keys: Set<string>; expectingKey: boolean } | null)[] = [];
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    const current = stack.at(-1);
    if (token === '{') stack.push({ keys: new Set(), expectingKey: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ':' && current) current.expectingKey = false;
    else if (token === ',' && current) current.expectingKey = true;
    else if (token.startsWith('"') && current?.expectingKey) {
      const key = JSON.parse(token) as string;
      if (current.keys.has(key)) return true;
      current.keys.add(key);
    }
  }
  return false;
}
