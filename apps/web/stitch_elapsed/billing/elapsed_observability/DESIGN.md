---
name: Elapsed Observability
colors:
  surface: '#0b1324'
  surface-dim: '#0f1418'
  surface-bright: '#353a3e'
  surface-container-lowest: '#0a0f13'
  surface-container-low: '#171c20'
  surface-container: '#1b2024'
  surface-container-high: '#252b2f'
  surface-container-highest: '#30353a'
  on-surface: '#dee3e9'
  on-surface-variant: '#bec8d2'
  inverse-surface: '#dee3e9'
  inverse-on-surface: '#2c3135'
  outline: '#88929b'
  outline-variant: '#3e4850'
  surface-tint: '#89ceff'
  primary: '#89ceff'
  on-primary: '#00344d'
  primary-container: '#0ea5e9'
  on-primary-container: '#003751'
  inverse-primary: '#006591'
  secondary: '#7bd0ff'
  on-secondary: '#00354a'
  secondary-container: '#00a6e0'
  on-secondary-container: '#00374d'
  tertiary: '#ffb86e'
  on-tertiary: '#492900'
  tertiary-container: '#de8712'
  on-tertiary-container: '#4d2b00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c9e6ff'
  primary-fixed-dim: '#89ceff'
  on-primary-fixed: '#001e2f'
  on-primary-fixed-variant: '#004c6e'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#ffdcbd'
  tertiary-fixed-dim: '#ffb86e'
  on-tertiary-fixed: '#2c1600'
  on-tertiary-fixed-variant: '#693c00'
  background: '#0f1418'
  on-background: '#dee3e9'
  surface-variant: '#30353a'
  canvas: '#060a12'
  surface-raised: '#111c34'
  surface-overlay: '#1a2745'
  surface-hover: '#233356'
  text-primary: '#f8fafc'
  text-muted: '#94a3b8'
  text-subtle: '#64748b'
  border: '#1c273c'
  border-strong: '#2d3c59'
  status-success: '#10b981'
  status-warning: '#f59e0b'
  status-danger: '#f43f5e'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  title-mono:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  label-mono-xs:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1.5rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

# Elapsed Design System & Component Token Architecture
*Production Specification for Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, and Radix UI*

## 1. Foundations & Philosophy
North Star: "One honest clock across the handoff."
Elapsed is an operational metrology platform bridging Helpdesk (Zendesk) and Engineering Trackers (Jira/Linear). The interface eliminates finger-pointing and blame, replacing it with transparent, immutable time accounting across stages.

Core Tenets:
- Observability & Infrastructure Caliber: Precise, calm, authoritative, neutral surfaces (#060a12 canvas, #0b1324 surface, #111c34 cards).
- Non-Attributive Terminology: Never use "fault", "blame", or "responsible team". Use "Support Leg", "Engineering Leg", "Waiting for Customer Leg", "Unattributed Time", "Time by Stage", "Runway Remaining".
- Deterministic Truth & Exposed Uncertainty: Highlighting whether an event is observed (raw timestamp) vs inferred (PR pattern link), with confidence indicators.
- Tabular Precision: Tabular monospace digits for all durations, timestamps, countdowns, and commitment thresholds.

## 2. Color System & Semantic Tokens
Dark Theme (Default Operational Canvas):
- Canvas / Background: #060a12
- Surface: #0b1324
- Surface Raised: #111c34
- Surface Overlay: #1a2745
- Surface Hover: #233356
- Text Primary: #f8fafc
- Text Muted: #94a3b8
- Text Subtle: #64748b
- Border: #1c273c
- Border Strong: #2d3c59
- Brand / Primary: #0ea5e9 / #38bdf8 (Operational Cyan-Sky Accent)
- Success: #10b981 (On Track / Met)
- Warning: #f59e0b (At Risk / Warning Runway)
- Danger: #f43f5e (Breached / Critical Runway)
- Info / Telemetry: #38bdf8

## 3. Typography
- Font Family: Inter, Hanken Grotesk, sans-serif; Monospace: JetBrains Mono, Roboto Mono, monospace
- Monospace Headline: font-mono tabular-nums font-bold
- Tabular Monospace: font-mono tabular-nums for countdowns, IDs, durations

## 4. Components
- Telemetry Header with live status, breadcrumbs, daemon state
- Stage Handoff Bar (segmented duration visualization)
- Runway Countdown timer
- Dense tabular data layouts with status badges (● On Track, ▲ At Risk, ✕ Breached, 🔗 Certain)