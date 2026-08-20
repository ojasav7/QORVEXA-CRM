import { useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import { toast } from "sonner";

// Same-origin by default (the CRM Express server serves the landing page AND
// the /api routes — one URL, one stack). In local dev with the landing page
// on its own port, point this at the CRM API, e.g. VITE_CRM_API=http://localhost:8787/api.
const env = import.meta.env as Record<string, string | undefined>;
const API_BASE = env["VITE_CRM_API"] ?? "/api";

const demoSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be under 100 characters"),
  email: z
    .string()
    .trim()
    .min(1, "Work email is required")
    .email("Enter a valid email address")
    .max(255, "Email must be under 255 characters"),
  company: z.string().trim().min(1, "Company is required").max(120, "Company must be under 120 characters"),
  teamSize: z.enum(["1-10", "11-50", "51-200", "200+"]),
  notes: z.string().trim().max(1000, "Notes must be under 1000 characters").optional(),
  company_website: z.string().max(0).optional(), // honeypot — bots fill it, humans don't
});

type Errors = Partial<Record<keyof z.infer<typeof demoSchema>, string>>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-ring";

type SubmitResult = { ok: boolean; duplicate: boolean; leadId?: string };

export function DemoRequest() {
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const parsed = demoSchema.safeParse({
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      company: String(fd.get("company") ?? ""),
      teamSize: String(fd.get("teamSize") ?? ""),
      notes: String(fd.get("notes") ?? ""),
      company_website: String(fd.get("company_website") ?? ""),
    });

    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      toast.error("Please fix the highlighted fields.");
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      // "Full name" → firstName + lastName for the CRM's lead model.
      const [firstName = "", ...rest] = parsed.data.name.trim().split(/\s+/);
      const res = await fetch(`${API_BASE}/public/forms/request-a-demo/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: firstName,
          lastName: rest.join(" "),
          email: parsed.data.email,
          company: parsed.data.company,
          teamSize: parsed.data.teamSize,
          notes: parsed.data.notes || undefined,
          company_website: parsed.data.company_website ?? "",
        }),
      });
      let data: SubmitResult;
      try {
        data = (await res.json()) as SubmitResult;
      } catch {
        data = { ok: false, duplicate: false };
      }
      if (!res.ok) {
        throw new Error("The request could not be submitted — please try again shortly.");
      }
      setResult(data);
      if (data.duplicate) {
        toast.success("You're already on our list — we'll be in touch.");
      } else {
        toast.success("Demo request received — a solutions engineer will reach out.");
      }
      form.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="demo" className="border-t border-border py-16">
      <h2 className="text-xs uppercase tracking-[0.35em] text-accent">// request a demo</h2>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h3 className="text-2xl font-bold leading-tight sm:text-3xl">
            See QORVEXA in action.
          </h3>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            A 30-minute guided walkthrough tailored to your use case. We'll show you
            the full platform — CRM, automation, analytics, and AI — with live data
            and real workflows.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
            {[
              "Tailored to your pipeline and team structure",
              "Live event stream + audit trail, not slides",
              "Sandbox environment provisioned for you afterwards",
            ].map((i) => (
              <li key={i} className="flex gap-3">
                <span className="text-primary">→</span>
                <span>{i}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-6 sm:p-8">
          {result ? (
            <div role="status" aria-live="polite" className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-primary text-xl text-primary">
                ✓
              </div>
              <h3 className="mt-5 text-lg font-bold">
                {result.duplicate ? "You're already on the list" : "Request received"}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {result.duplicate
                  ? "We already have your demo request — a solutions engineer will reach out shortly."
                  : "We've routed your request to the sales team. A solutions engineer replies within one business day."}
              </p>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="mt-6 rounded-md border border-border px-5 py-2.5 text-xs font-semibold transition hover:border-primary hover:text-primary"
              >
                Submit another request
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <Field label="Full name" name="name" error={errors.name}>
                <input id="name" name="name" maxLength={100} placeholder="Alex Mercer" className={FIELD} />
              </Field>

              <Field label="Work email" name="email" error={errors.email}>
                <input
                  id="email"
                  name="email"
                  type="email"
                  maxLength={255}
                  placeholder="alex@company.com"
                  className={FIELD}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company" name="company" error={errors.company}>
                  <input id="company" name="company" maxLength={120} placeholder="Northwind Ltd" className={FIELD} />
                </Field>
                <Field label="Team size" name="teamSize" error={errors.teamSize}>
                  <select id="teamSize" name="teamSize" defaultValue="1-10" className={FIELD}>
                    <option value="1-10">1–10</option>
                    <option value="11-50">11–50</option>
                    <option value="51-200">51–200</option>
                    <option value="200+">200+</option>
                  </select>
                </Field>
              </div>

              <Field label="What do you want to see? (optional)" name="notes" error={errors.notes}>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  maxLength={1000}
                  placeholder="We run a 4-stage pipeline and need SLA-backed support..."
                  className={FIELD}
                />
              </Field>

              <input
                type="text"
                name="company_website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
              />

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Request a demo"}
              </button>
              <p className="text-center text-[0.7rem] text-muted-foreground">
                No spam. Your details are only used to schedule the walkthrough.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
