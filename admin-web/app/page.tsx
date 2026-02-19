import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <div className="shell" style={{ maxWidth: 560, paddingTop: 60 }}>
        <div className="card">
          <h2>VoicePractice Admin</h2>
          <p className="small">Use login for authenticated admin actions.</p>
          <Link className="button primary" href="/login">
            Open Login
          </Link>
        </div>
      </div>
    </main>
  );
}
