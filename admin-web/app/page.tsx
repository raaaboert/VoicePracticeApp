import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <div className="shell" style={{ maxWidth: 560, paddingTop: 60 }}>
        <div className="card">
          <h2>VoicePractice Admin</h2>
          <p className="small">
            Use login for authenticated admin actions, or open accounts directly if your token is already stored.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="button primary" href="/login">
              Open Login
            </Link>
            <Link className="button" href="/users">
              Open Accounts
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
