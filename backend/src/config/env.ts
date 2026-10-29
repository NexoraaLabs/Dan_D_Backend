import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",
  // Where uploaded images are written. On Railway, mount a Volume here or the
  // files vanish on every redeploy.
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  // Public origin used to build upload URLs, e.g. https://api.example.com.
  // Falls back to the request's own host when unset.
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.replace(/\/$/, ""),
  // No email provider is chosen yet, so codes are only logged. With this on,
  // they're also returned in the API response so the apps can be tested end
  // to end. Never enable it once real users sign up.
  exposeDevCodes: process.env.EXPOSE_DEV_CODES === "true",
};
