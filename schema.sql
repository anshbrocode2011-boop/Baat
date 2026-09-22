CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id VARCHAR(32) UNIQUE NOT NULL,
  username VARCHAR(32) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_chat_id_idx ON users(chat_id);
CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(64) NOT NULL,
  bio VARCHAR(160) NOT NULL DEFAULT '',
  status VARCHAR(80) NOT NULL DEFAULT 'Available',
  avatar_url TEXT,
  accent VARCHAR(16) NOT NULL DEFAULT '#9bf6ff',
  banner VARCHAR(16) NOT NULL DEFAULT '#161b2d',
  links JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id), body VARCHAR(4000) NOT NULL, edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messages_chat_time_idx ON messages(chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(16) NOT NULL, PRIMARY KEY(message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS attachments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), message_id UUID REFERENCES messages(id) ON DELETE CASCADE, url TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS otp_verifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE CASCADE, phone_hash TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, verified_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS blocked_users (user_id UUID REFERENCES users(id) ON DELETE CASCADE, blocked_id UUID REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(user_id, blocked_id));
CREATE TABLE IF NOT EXISTS reports (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id UUID REFERENCES users(id), reported_id UUID REFERENCES users(id), reason VARCHAR(500) NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
