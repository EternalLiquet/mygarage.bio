import Link from "next/link";

export default function PublicProfileNotFound() {
  return (
    <main className="public-page">
      <section className="not-found-card">
        <h1 className="not-found-title">Profile not found</h1>
        <p className="not-found-copy">
          This garage profile or build link does not exist, or it is not public.
        </p>
        <Link className="back-link" href="/">
          Go back home
        </Link>
      </section>
    </main>
  );
}
