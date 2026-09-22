# Baat

Baat is a real-time, Chat ID-first communication platform. It is intentionally small, private, and focused: create an account, receive a permanent `BAAT-12345` ID, and talk.

## Run locally

1. Create PostgreSQL database and run `schema.sql`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` plus a long `JWT_SECRET`.
3. Install and start:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Architecture

- Node.js + TypeScript + Express REST API
- PostgreSQL persistence with relational users, profiles, chats, messages, sessions, reactions, attachments, OTP, blocks, and reports tables
- `ws` WebSocket server at `/ws?token=...`; message delivery is persisted before broadcasting to every connected member device
- Argon2 password hashing, JWT authentication, Helmet, CORS, rate limiting, Zod validation, message limits, and authorization checks
- The browser client is a deliberately lightweight mobile-first UI organized around Chats → People → Profile

The OTP schema is provider-neutral. Add an SMS adapter behind `/api/auth/otp/send` and `/api/auth/otp/verify` when a provider is selected; no authentication data model rebuild is needed.
