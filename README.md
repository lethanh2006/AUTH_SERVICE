# NRApp Authentication Service

The NRApp Authentication Service is a NestJS microservice responsible for
credential storage, password verification, OTP login, Google sign-in, JWT
sessions, and account/role operations. The mobile and web clients reach it
through the API Gateway; the service-to-service introspection endpoint is for
Gateway use.

## Responsibilities

- Stores credential records in MongoDB with a unique email, password hash, and
  application role (`user` or `admin`).
- Registers accounts and starts password login with a six-digit email OTP.
- Stores OTPs and login rate-limit/attempt state in Redis. OTPs expire after five
  minutes, login OTP requests are limited to one per minute, and verification is
  limited to five failed attempts.
- Issues an access token and a refresh token. Refresh-token identifiers are kept
  in Redis and rotated atomically when a session is refreshed.
- Verifies Google ID tokens when `GOOGLE_WEB_CLIENT_ID` is configured.
- Validates access tokens against the current credential record and returns the
  current role; deleted accounts and role changes are reflected on introspection
  (apart from the optional configured identity-cache TTL).
- Publishes transactional outbox events to the `user-profile-sync` RabbitMQ
  queue when a credential is created, updated, or deleted.

The username/profile read model remains owned by the User service. Auth reads it
internally when building a session and publishes credential changes through the
outbox rather than writing the User database directly.

## HTTP API

All application routes are under `/api/auth`.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/register` | Public | Create a credential and enqueue profile creation |
| `POST` | `/login` | Public | Verify password and send an OTP through RabbitMQ |
| `POST` | `/verify` | Public | Verify the OTP and issue access/refresh tokens |
| `POST` | `/refresh` | Public | Rotate a refresh token and issue a new session |
| `POST` | `/login-google` | Public | Verify a Google ID token and issue a session |
| `POST` | `/introspect` | Internal Gateway call | Validate an access token and return current identity |
| `GET` | `/me` | Authenticated | Read the current credential |
| `PATCH` | `/me/email` | Authenticated | Change the current account email |
| `DELETE` | `/me` | Authenticated | Delete the current account |
| `GET` | `/users/:userId` | Admin | Read another user's credential |
| `DELETE` | `/users/:userId` | Admin | Delete another user's account |
| `PATCH` | `/users/:userId/role` | Admin | Change another user's role |

`GET /health` and `GET /health/live` expose the service liveness response.
Protected account routes expect the signed identity headers sent by the Gateway;
they are not intended to be called directly by the client.

## Dependencies and configuration

The service requires MongoDB, Redis, RabbitMQ, and the internal User service.
MongoDB must support the transactions used when credentials and outbox records
are written together.

Copy `.env.example` to `.env` and set the environment-specific values:

```env
PORT=4000
MONGO_URL=mongodb://localhost:27017/nrapp
MONGO_DB_NAME=nrapp
REDIS_URL=redis://localhost:6379
USER_SERVICE=http://localhost:5000
JWT_SECRET=replace_with_at_least_32_random_bytes
GOOGLE_WEB_CLIENT_ID=your_google_web_client_id
AUTH_INTERNAL_SECRET=replace_with_a_long_random_shared_secret
AUTH_SIGNATURE_MAX_AGE_MS=300000

Rabbitmq_Host=localhost
Rabbitmq_Port=5672
Rabbitmq_Username=guest
Rabbitmq_Password=guest
```

`AUTH_IDENTITY_CACHE_TTL_MS` is optional and must remain between `0` and `5000`;
use a non-zero value only when a single Auth instance is serving traffic. The
logging variables in `.env.example` control structured application logs. Never
commit real credentials or JWT secrets.

## Local development

This service uses the local Logger observability package. Keep Logger beside this
repository in the backend directory, install dependencies, and start Auth with
its MongoDB, Redis, RabbitMQ, and User service dependencies available:

```bash
npm ci --prefix ../logger/packages/observability --no-audit --no-fund
npm ci
cp .env.example .env
npm run start:dev
```

Quality checks:

```bash
npm run lint
npm run format:check
npm test
npm run build
```

## CI/CD

`.github/workflows/ci.yml` uses the pinned reusable Node.js workflow from
[Logger](https://github.com/lethanh2006/Logger). A successful push to the default
branch triggers `.github/workflows/cd.yml` and deploys the exact commit through
the pinned VPS deployment workflow. See [.github/CI.md](.github/CI.md) for the
required secret and release process.
