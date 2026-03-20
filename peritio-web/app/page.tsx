import { ensurePublicHostRequest } from "@/src/lib/serverHostGuards";

export default async function PublicLandingPage() {
  await ensurePublicHostRequest("/");

  return (
    <main className="public-shell">
      <section className="public-panel">
        <p className="public-kicker">Peritio</p>
        <h1>Coming Soon</h1>
        <p className="public-copy">
          Peritio is building a sharper way to practice, measure, and improve high-stakes conversations across teams.
        </p>

        <div className="public-stat-grid" aria-hidden="true">
          <div className="public-stat">
            <strong>Training</strong>
            <span>Simulation-first</span>
          </div>
          <div className="public-stat">
            <strong>Insight</strong>
            <span>Org-level reporting</span>
          </div>
          <div className="public-stat">
            <strong>Proof</strong>
            <span>Skill improvement trends</span>
          </div>
        </div>
      </section>
    </main>
  );
}
