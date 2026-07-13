# Prompt na validáciu biznis modelu (skopíruj do AI)

> Skopíruj celý text nižšie a vlož ho do ChatGPT / Claude s otázkou na konci.

---

Si skúsený startupový poradca a analytik trhu. Zhodnoť nasledujúci produkt ako biznis
príležitosť. Buď kritický a konkrétny, nie zdvorilý — chcem počuť aj slabé miesta.

## Produkt: SmartNákup

Webová appka (funguje na mobile aj desktope), ktorá pomáha slovenským domácnostiam
ušetriť na potravinách tým, že im z akciových letákov zostaví najlacnejší nákupný zoznam.

**Ako to funguje pre používateľa:**
1. Napíše, čo chce kúpiť (napr. mlieko, maslo, vajcia).
2. Vyberie obchody, do ktorých je ochotný ísť (Tesco, Kaufland, Lidl, Billa, Terno,
   Fresh, COOP Jednota, Klas).
3. Appka vyhľadá aktuálne akciové ceny z letákov a rozdelí nákup do zoznamov po
   obchodoch tak, aby každá položka bola čo najlacnejšia. Ukáže vyčíslenú úsporu.
4. Prihlásený používateľ si zoznamy uloží do cloudu, premenuje a pri nákupe odškrtáva.

**Ďalšie funkcie:** recepty z aktuálnych akcií (appka zistí, ktoré suroviny sú v akcii
a pridá ich do košíka), návrhy náhrad keď produkt nie je v zvolených obchodoch, dátumy
platnosti akcií, svetlý/tmavý režim.

**Zdroj dát:** verejný agregátor akciových letákov (kompaszliav.sk). Ceny sa scrapujú
a cachujú. (Poznámka: závislosť na cudzom zdroji dát je riziko — zváž to.)

**Stav:** funkčné MVP nasadené v produkcii (React + Node backend, cloud databáza,
používateľské účty). Zatiaľ bez platiacich používateľov a bez marketingu.

**Trh:** Slovensko (~2 mil. domácností), vysoká citlivosť na ceny potravín, inflácia
posledných rokov. Podobné akcie ľudia dnes riešia ručne prezeraním letákov alebo appiek
jednotlivých reťazcov (Kaufland, Lidl…) a stránok ako kupi.sk, akcneceny.sk.

**Roadmap:** cenové notifikácie (upozorni keď obľúbený produkt ide do akcie), história
cien, zdieľanie zoznamu, prepočet ceny za jednotku (€/kg), mapa predajní, PWA, ďalšie
krajiny.

## Čo od teba chcem

1. **Má to zmysel ako biznis?** Reálna veľkosť trhu a ochota platiť na Slovensku.
2. **Monetizácia** — navrhni 2–3 realistické modely (freemium, predplatné, affiliate/
   provízie z reťazcov, reklama, predaj dát/insightov) a ktorý je najživotaschopnejší.
3. **Konkurencia** — kto to už rieši (SK aj zahraničie), v čom sa dá odlíšiť.
4. **Najväčšie riziká** — právne (scrapovanie letákov, ochrana dát), závislosť na
   jednom zdroji, retencia používateľov, jednotková ekonomika.
5. **Go-to-market** — ako získať prvých 1 000 a potom 10 000 používateľov lacno.
6. **Verdikt** — na škále 1–10 aký potenciál to má a čo by som mal spraviť ako ďalší
   krok (validovať dopyt, pivotnúť, pridať funkciu…).

Odpovedaj konkrétne k slovenskému/stredoeurópskemu trhu, nie všeobecne.
