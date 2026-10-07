# @sla/email

The only place Elapsed renders or sends email. The application owns the
content and presentation; SMTP (nodemailer) only delivers.

```ts
await sendEmail({
  smtp, // EmailConfig — which server delivers it
  to: ["owner@acme.com"],
  template: "password-reset", // a registered template id
  data: { resetUrl, ttlMinutes: 60 }, // typed by the template
});
```

`sendEmail` takes a template id and its data. There is no field for a subject,
a text body or HTML, so nothing can be sent outside the Elapsed layout.

## How a message is built

```
template (content blocks)  ──►  layout (Elapsed shell)  ──►  RenderedEmail  ──►  transport (SMTP)
 templates/*.ts                  layout.ts                    rendered.ts         transport.ts
```

- **Templates** (`src/templates/`) define a category, subject, preheader,
  footnote and `content` as typed *blocks* (`heading`, `text`, `metric`,
  `details`, `table`, `stats`, `button`, …, see `blocks.ts`). They never emit
  markup.
- **The layout** (`src/layout.ts`) is the one shell: header (logo, wordmark,
  category pill), card, footer (descriptor, links, product URL, copyright),
  mobile rules, and the matching plain-text body. Dark by design; every color
  comes from `brand.ts`.
- **The transport** (`src/transport.ts`) is private. It accepts only a
  `RenderedEmail`, which only `renderEmail` can make.

## Adding an email

1. Create `src/templates/<name>.ts` with `defineEmailTemplate<Data>({ category, subject, preheader, footnote?, content })`.
2. Register it in `src/templates/index.ts`.
3. Add a fixture for it in `test/fixtures.ts`. This is a type error until you do, and the registry tests then run it through every shell check.

## Guarantees, and what enforces them

| Guarantee | Enforced by |
| --- | --- |
| Callers can't pass a subject/text/HTML | `SendEmailInput` type; `send.test.ts` (smuggled fields are ignored) |
| An unregistered template can't be sent | `renderEmail` throws `UnknownEmailTemplateError`; `send.test.ts` |
| The transport only sends rendered email | `assertRendered` in `transport.ts`; `transport.test.ts` |
| Every template renders inside the shell, HTML and text | `templates.test.ts`, run over every registered template |
| No second transport or hand-built HTML shell anywhere in the repo | `no-bypass.test.ts` scans `apps/*` and `packages/*` |
| No raw delivery or layout export | `no-bypass.test.ts` checks the package entry point |

The footer links to the deployment (`NEXTAUTH_URL`, or `appUrl` when passed;
`null` means none configured and the link is omitted). The logo is embedded
as an inline `cid:` attachment, so it needs no public URL.
