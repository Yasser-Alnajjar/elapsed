const SECTIONS = [
  {
    title: "1. Acceptance of terms",
    body: [
      "By creating an account, connecting an integration, or otherwise using Elapsed (\"the Service\"), you agree to these Terms of Service. If you're using the Service on behalf of an organization, you're agreeing on its behalf and confirming you have the authority to do so.",
    ],
  },
  {
    title: "2. What the Service does",
    body: [
      "Elapsed reads data from systems you connect — such as Zendesk, Intercom, Jira, Linear, and GitHub — and derives customers, cases, timelines, and SLA commitments from the events those systems already emit. Alerts are delivered by Slack message or email.",
      "The Service is read-only against every connected data source. It does not create, modify, or delete tickets, issues, fields, tags, comments, or any other record in a connected system. The only outbound writes are the Slack messages and alert emails the Service itself sends.",
    ],
  },
  {
    title: "3. Your account and connected integrations",
    body: [
      "You're responsible for the credentials used to connect an integration, for keeping them valid, and for ensuring you have the right to grant the Service read access to the systems you connect.",
      "You can disconnect an integration at any time from Settings. Disconnecting stops new data from being read; it does not retroactively delete data already stored, which is subject to the retention terms below.",
    ],
  },
  {
    title: "4. Acceptable use",
    body: [
      "You agree not to use the Service to violate any law, to access data you're not authorized to access, to reverse-engineer or attempt to bypass the Service's security, or to resell or provide the Service to third parties without our written consent.",
    ],
  },
  {
    title: "5. Data ownership",
    body: [
      "You retain ownership of the data from your connected systems. We process it solely to provide the Service to you, as described in the Privacy Policy.",
    ],
  },
  {
    title: "6. Availability and changes",
    body: [
      "We aim to keep the Service available and accurate, but SLA calculations, calendars, and integration sync are dependent on the systems you connect and their own uptime and API limits. We may change, suspend, or discontinue features of the Service, and will make reasonable efforts to notify you of material changes.",
    ],
  },
  {
    title: "7. Termination",
    body: [
      "You may stop using the Service and close your account at any time. We may suspend or terminate access if these terms are violated, or if required by law.",
    ],
  },
  {
    title: "8. Disclaimer and limitation of liability",
    body: [
      "The Service is provided \"as is.\" SLA status, breach predictions, and calculated timelines are derived from data in the systems you connect and are provided for visibility, not as a guarantee of any contractual outcome. The Service performs no financial or service-credit calculation.",
      "To the extent permitted by law, we are not liable for indirect, incidental, or consequential damages arising from use of the Service.",
    ],
  },
  {
    title: "9. Changes to these terms",
    body: [
      "We may update these terms from time to time. Continued use of the Service after a change takes effect constitutes acceptance of the updated terms.",
    ],
  },
  {
    title: "10. Contact",
    body: [
      "Questions about these terms can be sent to the contact address listed on our website.",
    ],
  },
];

export const TermsView = () => {
  return (
    <main className="flex-1">
      <section className="border-b border-border/60">
        <div className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-24">
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
            Terms of Service
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Last updated September 27, 2026
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto w-full max-w-3xl space-y-12 px-6">
          {SECTIONS.map((section) => (
            <div key={section.title} className="space-y-3">
              <h2 className="font-display text-xl font-medium tracking-tight">
                {section.title}
              </h2>
              {section.body.map((paragraph, i) => (
                <p key={i} className="leading-7 text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
};
