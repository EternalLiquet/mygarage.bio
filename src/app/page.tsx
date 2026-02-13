import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="home-hero">
        <p className="home-eyebrow">Build logs, simplified</p>
        <h1 className="home-title">Show your garage in one clean link.</h1>
        <p className="home-copy">
          Create a profile, document your vehicles, track mods, and share photos
          without juggling multiple pages.
        </p>
        <div className="home-actions">
          <Link className="primary-button" href="/dashboard">
            Open dashboard
          </Link>
          <Link className="auth-link" href="/login">
            Sign in
          </Link>
        </div>
      </section>

      <section className="home-grid">
        <article className="home-feature">
          <h2>Public profile</h2>
          <p>
            One shareable page for your builds, with your username and avatar.
          </p>
        </article>
        <article className="home-feature">
          <h2>Vehicle timelines</h2>
          <p>
            Keep each car organized with details, mod lists, and image galleries.
          </p>
        </article>
        <article className="home-feature">
          <h2>Built for updates</h2>
          <p>
            Add photos and notes as your project evolves. No clutter, just the
            essentials.
          </p>
        </article>
      </section>
    </main>
  );
}
