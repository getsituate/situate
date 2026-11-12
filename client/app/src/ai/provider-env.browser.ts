export function getProviderEnvValue(
  name: string,
  env?: Record<string, string | undefined>,
): string | undefined {
  return env?.[name] || undefined;
}
