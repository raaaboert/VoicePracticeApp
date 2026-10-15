import Link from "next/link";
import { ThemeSwitchButton } from "../../peritio-web/src/components/ThemeSwitchButton";

export default function HomePage() {
  return (
    <main className="login-landing">
      <div className="shell login-landing-shell">
        <div className="card login-landing-card">
          <div className="auth-theme-control"><ThemeSwitchButton /></div>
          <h2>Peritio - Web Admin</h2>
          <p className="small">Use login for authenticated admin actions.</p>
          <Link className="button primary" href="/login">
            Open Login
          </Link>
        </div>
      </div>
    </main>
  );
}
