# Skill: Pine Script v6 (TradingView)

Conventions the builder MUST follow:
- Start with `//@version=6`. Use `indicator()` or `strategy()` with explicit `overlay`, `max_lines_count`, etc.
- **Repaint safety is non-negotiable.** For `request.security()` use `lookahead=barmerge.lookahead_off` and pull confirmed values (offset by `[1]` on the higher timeframe) — never read the developing HTF bar.
- Compute signals on confirmed bars; gate intrabar actions with `barstate.isconfirmed` when appropriate. Never use future-leaking references.
- Prefer `ta.*` built-ins; keep series/simple typing correct. Use user-defined types (`type`) for structured state.
- Plots: `plot`, `plotshape`, `bgcolor` with clear inputs (`input.int`, `input.float`, `input.source`, grouped/tooltip'd).
- Alerts: expose `alertcondition` and/or `alert()` with descriptive messages; make webhook-friendly JSON where relevant.
- Strategies: set realistic `commission`, `slippage`; avoid lookahead; use `strategy.entry/exit` with proper qty and risk.
- Respect object limits (lines/labels/boxes) and delete stale drawings.
- Deliver: the `.pine` file + a short note on inputs and how to read the signals.
