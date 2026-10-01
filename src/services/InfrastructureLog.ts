const reported = new Set<string>();

export function logInfrastructureFallback(component: string, operation: string, fallback: string): void {
  const key = `${component}:${operation}:${fallback}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.warn('infrastructure_fallback', { component, operation, fallback, redacted: true });
}

export function resetInfrastructureLogForTests(): void { reported.clear(); }
