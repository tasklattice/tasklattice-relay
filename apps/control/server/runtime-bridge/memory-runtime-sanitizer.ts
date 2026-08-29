const REDACTED = "[REDACTED]";

const secretPatterns: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|rk|pk|ghp|github_pat|xox[baprs]|tali_[a-z0-9]+)[-_][A-Za-z0-9._-]{8,}/gi,
  /\b(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|database[_-]?url)\s*[:=]\s*[^\s,;]+/gi,
];

const piiPatterns: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /(?<!\d)(?:\+?\d[\s().-]?){8,15}(?!\d)/g,
];

const memoryFencePattern = /<\/?\s*tasklattice-memory-context\s*>/gi;

export function sanitizeRuntimeMemoryText(
  value: string,
  maxLength = 8_000,
): string {
  let sanitized = value.replace(memoryFencePattern, "[MEMORY_CONTEXT_MARKER_REMOVED]");
  for (const pattern of secretPatterns) sanitized = sanitized.replace(pattern, REDACTED);
  for (const pattern of piiPatterns) sanitized = sanitized.replace(pattern, "[REDACTED_PII]");
  return sanitized.slice(0, Math.max(0, maxLength));
}

export function containsRuntimeMemorySecret(value: string): boolean {
  return secretPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}
