# Vox Truthfile

Vox is a Web App first English tutor. iOS remains paused until the Web App login, conversation, drill, and memory flows are stable.

## Current Direction

Vox is now a multi-user app. Every user must log in before using the Web App, and user memory must be scoped to that logged-in account.

The first release should focus on the Web App. iOS OAuth callback setup and App Store login polish are explicitly out of scope until the Web App path is stable.

## Login Decision

Use Google Sign-In as the first login path.

- Product entry: users sign in with Google before entering Vox. Anonymous sessions are not part of the first Web App release.
- Auth provider: Supabase Auth handles Google OAuth and session management.
- Account identity: use the authenticated Supabase user id as the durable internal user id. Google email is display and access-control metadata, not the database join key.
- Data store: Supabase Postgres stores profile, preferences, conversation summaries, drill progress, and usage records.
- Data isolation: every user-scoped table must include `user_id`; Supabase RLS policies must restrict reads and writes to the logged-in user.
- Early access: add an application-side allowlist for approved emails or domains. Google login proves identity, but the allowlist decides whether the user can enter.
- Web first: production OAuth redirect URI targets `https://vox.exp.game`. Local and preview redirect URIs can be added for development. iOS redirect URIs wait.

## Why This Choice

Google Sign-In is the lowest-friction path for the current Web App stage. It avoids password storage, reduces account-recovery work, and gives stable identity quickly enough to build multi-user memory.

Supabase fits the current stage because it gives Auth, Postgres, session handling, and Row Level Security in one place. It is enough for early multi-user isolation without building a custom auth stack.

## Known Tradeoffs

- Some users may not have or want a Google account. If that blocks real users, add email magic-link login later.
- Google login alone does not make the app private. Without an allowlist, any Google user who reaches the app could create a session.
- OAuth setup must include correct authorized redirect URIs for local, preview, and production domains.
- Shared accounts are not supported. Memory, progress, and quota depend on one stable user per account.

## Product Guardrails

- Do not hard-code a single user name into product copy, prompt behavior, memory ownership, or storage paths.
- Do not mix data across users, even in test flows.
- Do not ship a login bypass in production.
- Keep user-facing copy focused on what Vox does for the learner, not on implementation details.
