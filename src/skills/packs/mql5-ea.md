# Skill: MQL5 Expert Advisor (MetaTrader 5)

Conventions the builder MUST follow:
- Structure with `OnInit`, `OnDeinit`, `OnTick` (and `OnTimer`/`OnTradeTransaction` if needed). Use the `CTrade` class for orders.
- Set and filter by a unique `MagicNumber`; only ever manage this EA's own positions/orders.
- Normalize before every order: price to `_Digits`/`TickSize`, volume to broker `SYMBOL_VOLUME_MIN/MAX/STEP`. Respect `SYMBOL_TRADE_STOPS_LEVEL` and `FREEZE_LEVEL` for SL/TP.
- Handle send failures: check `retcode`, retry on requotes/off-quotes, back off; never assume a fill.
- Signals must not repaint: evaluate on the CLOSED bar (`iTime`/`CopyRates` with shift ≥ 1), not the forming bar, unless intentionally tick-based.
- Risk: size by account risk % and stop distance; cap exposure; guard against duplicate entries.
- Make inputs explicit (`input` group with tooltips). Log clearly with `Print`/`Comment`.
- Deliver: the `.mq5` file that compiles cleanly, plus a note on inputs and a Strategy-Tester check.
