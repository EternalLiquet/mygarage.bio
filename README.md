# mygarage.bio
Link-in-bio for car builds. Shows cars, mods, and photos in one shareable page.

## Tech Stack
- Next.js App Router + TypeScript
- Supabase (Postgres + Auth + Storage)

## Quickstart
1. Install dependencies:
   - `npm install`
2. Create local env file:
   - `copy .env.example .env`
3. Fill in required Supabase env vars in `.env`.
4. Run dev server:
   - `npm run dev`

## Database
- Migrations: `supabase/migrations/0001_init.sql` through `supabase/migrations/0011_generate_username_on_signup.sql`
- Backend notes: `docs/backend.md`

## Scripts
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
