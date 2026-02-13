# mygarage.bio
Link-in-bio for car builds. Shows cars, mods, and photos in one shareable page.

## Tech Stack
- Next.js App Router + TypeScript
- Supabase (Postgres + Auth + Storage)

## Quickstart
1. Install dependencies:
   - `npm install`
2. Create local env file:
   - `copy .env.example .env.local`
3. Fill in required Supabase env vars in `.env.local`.
4. Run dev server:
   - `npm run dev`

## Database
- Migration: `supabase/migrations/0001_init.sql`
- Backend notes: `docs/backend.md`

## Scripts
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
