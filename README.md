# 🛒 SmartNákup

Nákupný optimalizátor napojený živо na [cenyslovensko.sk](https://cenyslovensko.sk) — ceny aktualizované denne priamo od reťazcov.

## Quickstart

```bash
# 1. Inštalácia
npm run install:all

# 2. Spusti backend (terminál 1)
npm run dev:backend   # → http://localhost:3001

# 3. Spusti frontend (terminál 2)
npm run dev:frontend  # → http://localhost:5173
```

## Architektúra

```
Používateľ → Frontend (React/Vite :5173)
                  ↓
             Backend (Express :3001)
                  ↓
        api.cenyslovensko.sk  ← živé ceny denne
```

**Žiadna DB, žiadny scraper, žiadny cron** — všetko live.

## API endpointy backendu

| Endpoint | Popis |
|----------|-------|
| `GET /api/v1/vendors` | Zoznam obchodov |
| `GET /api/v1/categories` | Kategórie produktov |
| `GET /api/v1/products/search?q=mlieko` | Vyhľadávanie |
| `GET /api/v1/products/:id/vendors` | Ceny produktu po obchodoch |
| `POST /api/v1/optimize` | Optimalizácia nákupného košíka |

## Ako funguje optimize

```json
POST /api/v1/optimize
{
  "items": [
    { "query": "mlieko", "identifier": "e:8586000020344_35793783" },
    { "query": "vajcia" }
  ],
  "vendor_ids": [1, 3]
}
```

Vráti zoznamy rozdelené po obchodoch s celkovou úsporou.
