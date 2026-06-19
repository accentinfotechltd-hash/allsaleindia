# Pull Request

<!--
  Thanks for contributing to Allsale!
  Keep this template concise — delete sections that don't apply.
-->

## Summary

<!-- 1–3 sentences. What does this PR do and why? -->

## Type of change

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to change)
- [ ] 🛠 Refactor / chore (no functional change)
- [ ] 📝 Docs only
- [ ] 🎨 UI/UX polish
- [ ] 🔒 Security / dependency bump

## Surface affected

- [ ] 📱 Mobile (Expo / `/app/frontend/`)
- [ ] 🌐 Web (Next.js — sibling repo `allsale-web`)
- [ ] ⚙️ Backend (FastAPI / `/app/backend/`)
- [ ] 🗄️ Database / schema migration
- [ ] 🚀 Infrastructure / deployment / `.env`

## Linked issue / context

<!-- Closes #123 · Implements RFC at /app/memory/... · Continues #456 -->

## How was this tested?

- [ ] Unit / integration tests added or updated
- [ ] `pytest` passes locally (backend)
- [ ] `eslint` / `tsc` clean (mobile + web)
- [ ] Manually tested on iOS / Android / desktop / mobile-web (delete as appropriate)
- [ ] Tested with seeded test users from `/app/memory/test_credentials.md`
- [ ] N/A — docs only / config only

### Test commands run

```bash
# e.g.
cd /app/backend && PYTHONPATH=/app/backend python -m pytest tests/test_<file>.py -v
```

## Screenshots / recordings

<!-- Mandatory for any UI change. Drag-drop images or paste a short Loom/screencast. -->

| Before | After |
|--------|-------|
|        |       |

## Backend / DB changes

<!-- Fill out only if this PR touches the backend. -->

- [ ] New API endpoint(s) — paths: `POST /api/...`
- [ ] Modified response shape on existing endpoint — list paths:
- [ ] New Mongo collection / index — name:
- [ ] One-shot migration script needed — path:
- [ ] New env var — name + default + where documented:
- [ ] Updated `/app/memory/web_agent_handoff_*.md` for the web team
- [ ] N/A

## Mobile-specific checks

- [ ] Tested in Expo Go web preview (`localhost:3000`)
- [ ] No HTML elements (`div`/`span`) — only React Native primitives
- [ ] Touch targets ≥ 44 pt
- [ ] Safe-area insets respected on full-screen views
- [ ] No deprecated Expo packages (`expo-av`, `expo-barcode-scanner`, `expo-background-fetch`, `@expo-google-fonts/*`)
- [ ] No web-only libs (`react-router-dom`, `@mui/material`, `framer-motion`, etc.)
- [ ] `package.json` updated only via `yarn expo install <pkg>` (no manual version edits)
- [ ] N/A

## Permissions / privacy

<!-- Only if this PR touches camera / mic / location / contacts / notifications. -->

- [ ] Added `expo.android.permissions` entry to `app.json`
- [ ] Added `expo.ios.infoPlist` usage description (≤ 10 words, user-benefit framing)
- [ ] Pre-permission rationale UI added (before native popup)
- [ ] Handles `denied` / `canAskAgain === false` with "Open Settings" fallback
- [ ] N/A

## Third-party integrations

<!-- Only if this PR adds or modifies an external integration. -->

- [ ] Used `integration_playbook_expert_v2` (no direct integration written from memory)
- [ ] New credentials documented in `/app/memory/production_credentials.md`
- [ ] Failure mode: graceful degradation, not a hard crash
- [ ] N/A

## Reviewer checklist

- [ ] Code follows repo style (lint clean, no `console.log` leftovers)
- [ ] No hardcoded URLs / API keys / port numbers
- [ ] No mocked data left in production code paths
- [ ] PR title follows conventional-commits (e.g. `feat(ambassadors): add resend-activation`)

---

<sub>📚 If this PR is part of a larger initiative, link the tracking doc in `/app/memory/`. If you're unsure which surfaces are affected, look for the matching `web_agent_handoff_*.md` to confirm cross-team scope.</sub>
