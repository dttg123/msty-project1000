const patterns=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token',/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ['google-api-key',/\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['literal-client-secret',/(?:client[_-]?secret|toss[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9_./+=-]{16,}["']/i],
  ['literal-bearer-token',/authorization\s*[:=]\s*["']Bearer\s+[A-Za-z0-9_./+=-]{20,}["']/i]
];

export function scanContent(content){
  return patterns.filter(([,pattern])=>pattern.test(content)).map(([name])=>name);
}
