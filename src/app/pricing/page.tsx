import Link from "next/link";

export default function PricingPage() {
  return (
    <main className="dashboard-page">
      <section className="dashboard-card pricing-card">
        <h1 className="dashboard-title">MyGarage Pro</h1>
        <p className="pricing-price">$5/mo</p>
        <p className="dashboard-subtitle">
          Unlock more vehicles, more mods, and more images.
        </p>
        <button className="primary-button" type="button">
          Start Pro (Coming Soon)
        </button>
        <p>
          <Link className="auth-link" href="/dashboard">
            Back to dashboard
          </Link>
        </p>
      </section>
    </main>
  );
}
