const MINIMUM_JWT_SECRET_BYTES = 32;

export function requireJwtSecret(value: string | undefined): string {
  const secret = value?.trim();

  if (!secret || Buffer.byteLength(secret, 'utf8') < MINIMUM_JWT_SECRET_BYTES) {
    throw new Error(
      `JWT_SECRET phải được cấu hình và có ít nhất ${MINIMUM_JWT_SECRET_BYTES} byte`,
    );
  }

  return secret;
}
