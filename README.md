# 🛒 SmartNákup

Nákupný optimalizátor pre slovenské potraviny. Používateľ zadá čo chce kúpiť, vyberie
obchody a appka mu vytvorí nákupné zoznamy rozdelené po obchodoch s **najlacnejšími
akciovými cenami z letákov** a vyčíslenou úsporou.

Zdroj cien: [kompaszliav.sk](https://kompaszliav.sk) — agregátor akciových letákov
slovenských reťazcov.

**Live:** [smart-nakup.vercel.app](https://smart-nakup.vercel.app)

---

## Čo appka dokáže (aktuálny stav)

- **Vyhľadávanie produktov** s napovedaním — píše sa názov (mlieko, maslo, gouda…),
  dropdown ukáže konkrétne akciové produkty naprieč obchodmi, zoradené od najlacnejšieho.
- **8 obchodov:** Tesco, Kaufland, Lidl, Billa, Terno, Fresh, COOP Jednota, Klas.
- **Optimalizácia košíka** — pre každú položku vyberie najlacnejší obchod (z tých, ktoré
  si používateľ zvolil) a rozdelí nákup do zoznamov po obchodoch.
- **Úspora** — pri každej položke aj celkovo ukáže, koľko ušetríš oproti najdrahšiemu
  obchodu s tým istým produktom.
- **Dátumy akcií** — pri produkte je obdobie platnosti letáku; akcie, ktoré ešte len
  začnú, sú zvlášť označené.
- **Návrhy náhrad** — ak zvolený produkt nie je v tvojich obchodoch, appka navrhne
  najlacnejšiu alternatívu z tej istej kategórie (používateľ ju potvrdí alebo zamietne).
- **Recepty z akcií** — 12 jednoduchých receptov; appka zistí, ktoré suroviny sú práve
  v akcii, vyčísli orientačnú cenu a jedným klikom pridá suroviny do košíka.
- **Uložené zoznamy** (pre prihlásených) — zoznamy sa ukladajú do cloudu, dajú sa
  premenovať, zoradené sú podľa dátumu, položky sa dajú odškrtávať pri nákupe.
- **Účty** — registrácia s overením e-mailu, prihlásenie, cloudové zoznamy.
- **Dizajn** — dizajnový jazyk „1C Premium" so svetlým (sage) a tmavým režimom
  (+ podľa systému), písma Sora/Manrope, brandové farby a logá obchodov.

## Roadmap / čo ešte chceme doplniť

- **Cenové notifikácie** — sledovanie produktu a upozornenie e-mailom, keď ide do akcie.
- **História cien** — graf vývoja ceny produktu v čase.
- **Zdieľanie zoznamu** — link na zdieľanie nákupného zoznamu s rodinou.
- **Prepočet ceny za jednotku** (€/kg, €/l) — férové porovnanie rôznych balení.
- **Mapa predajní** — kde je najbližšia predajňa s danou akciou.
- **PWA / mobilná appka** — inštalácia na plochu, offline zoznam.
- **Viac obchodov / krajín** — ďalšie reťazce, prípadne CZ.

---

## Architektúra

```
Používateľ → Frontend (React + Vite, Vercel)
                  │  /api/* rewrite (same-origin cookie)
                  ▼
             Backend (Express, Render)
                  ├── kompaszliav.sk  ← scrape akciových letákov
                  │     (fallback cez r.jina.ai pri Cloudflare challenge)
                  └── Neon Postgres
                        ├── Better Auth (účty, sessions)
                        ├── shopping_lists (uložené zoznamy)
                        └── kompas_cache (cache výsledkov, prežije reštart)
```

**Stack:** React · TypeScript · Vite · Express · Better Auth · Neon Postgres ·
Resend (e-maily) · lucide-react (ikony). Deploy: Vercel (FE) + Render (BE).

### Ako funguje scrape z kompasu
- Pre dopyt sa načíta stránka kategórie (`/produkty/{slug}`) a rozparsujú sa produktové
  karty (obchod, produkt, cena, obrázok, dátumy) priamo z HTML.
- Karty sa klastrujú podľa názvu produktu, takže sa neporovnávajú rôzne balenia.
- Datacenter IP (Render) často dostane Cloudflare challenge → automatický fallback cez
  `r.jina.ai` relay (globálne rate-limitovaný, s retry a cache).
- Výsledky sa cachujú v pamäti aj v Postgrese (2 h TTL) + warm-up receptových surovín
  pri štarte a každú hodinu.

## Quickstart

```bash
npm run install:all
npm run dev:backend    # → http://localhost:3001
npm run dev:frontend   # → http://localhost:5173
```

Backend potrebuje `.env` (`backend/.env`): `DATABASE_URL` (Neon Postgres),
`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, prípadne `KOMPAS_PROXY`.

## Hlavné API endpointy

| Endpoint | Popis |
|----------|-------|
| `GET /api/v1/stores` | Zoznam obchodov |
| `GET /api/v1/products/search?q=mlieko` | Vyhľadávanie akciových produktov |
| `POST /api/v1/optimize` | Rozdelí košík po obchodoch s najnižšími cenami |
| `POST /api/v1/recipes/check` | Zistí, ktoré suroviny sú v akcii |
| `GET/POST/PATCH/DELETE /api/v1/lists` | Uložené zoznamy (vyžaduje prihlásenie) |
| `ALL /api/auth/*` | Better Auth (registrácia, login, overenie e-mailu) |
