import React from "react";
import { Mail } from "lucide-react";

// Support mailbox confirmed by the product owner for the customer dashboard.
const SUPPORT_HREF = `mailto:support@peritio.ai?subject=${encodeURIComponent("Peritio Support Request")}`;

export function ContactSupportCard() {
  return (
    <section className="section-card settings-support-card" aria-labelledby="settings-support-heading">
      <div className="section-header">
        <div className="settings-support-copy">
          <h2 id="settings-support-heading">Need help?</h2>
          <p className="section-copy">
            Questions about your account, training content, or using Peritio? We&apos;re here to help.
          </p>
        </div>
        <a className="ghost-button settings-support-link" href={SUPPORT_HREF}>
          <Mail size={18} aria-hidden="true" />
          Contact Support
        </a>
      </div>
    </section>
  );
}
