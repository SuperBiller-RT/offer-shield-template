# offer-shield-template

Static single-file landing/demo template for SuperBiller's OfferShield. Generates a per-client deployment by substituting placeholder tokens before deploy. Vercel-deployable as-is — no `vercel.json`, no build step.

Source canonical lives at <https://superbiller.com/offer-shield>; this repo is the clonable template.

## Placeholder tokens

Replace these tokens in `index.html` per deployment (plain find/replace — no escaping needed):

| Token | Meaning | Example |
|---|---|---|
| `__AGENCY_NAME__` | Agency / firm display name | `Connell Search` |
| `__DEFAULT_RECRUITER__` | Default recruiter name shown in agency defaults + share dialog | `Sarah Connell` |
| `__AGENCY_DOMAIN__` | Agency email domain (used in the recruiter-email placeholder) | `connellsearch.com` |

The `e.g. James Hartley` / `e.g. Sarah Connell` strings in input `placeholder=` attributes are illustrative copy and intentionally left untouched — they only render when the field is empty.

## Demo data

The `cases[]` array in `index.html` (search for `/* ══ DEMO DATA`) holds 7 illustrative candidates (James Hartley, Priya Mehta, David Okafor, Sophie Renault, Marcus Webb, Aisha Patel, Ryan Calloway) with stages, risks, recruiter names, and notes. Replace the entire array with real candidate data per deployment — the rest of the page renders straight off this list.

## Deploy

```bash
git clone https://github.com/SuperBiller-RT/offer-shield-template.git
cd offer-shield-template
# (apply placeholder substitutions + swap cases[] here)
vercel --prod
```

Vercel auto-detects a static project; no framework preset needed.
