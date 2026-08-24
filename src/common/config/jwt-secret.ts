const MINIMUM_JWT_SECRET_BYTES = 32;
const FORBIDDEN_JWT_SECRETS = new Set([
  'replace_with_at_least_32_random_characters',
  'your-super-secret-key-chatapp',
  'your_jwt_secret_here',
]);

export function requireJwtSecret(value: string | undefined): string {
  const secret = value?.trim();

  if (
    !secret ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_JWT_SECRET_BYTES ||
    FORBIDDEN_JWT_SECRETS.has(secret.toLowerCase())
  ) {
    throw new Error(
      `JWT_SECRET phải được cấu hình và có ít nhất ${MINIMUM_JWT_SECRET_BYTES} byte`,
    );
  }

  return secret;
}
