# FloodGuard live-data compatibility fix

- Normalizes legacy `REMOVED` to `NOT_INSTALLED`.
- Accepts `COUNTDOWN`, `OPENING`, `CLOSING`, `SENSOR_ERROR`, and transient unknown values without breaking pages.
- Zod validation remains in place; malformed groups are ignored instead of replacing the full dashboard.
- ESP connection/status aliases are normalized.
- No synthetic history or rainfall values are generated.
