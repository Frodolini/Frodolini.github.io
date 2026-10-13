/**
 * Toppliste for Piano 4 – Google Apps Script
 *
 * Oppsett:
 *  1. Lag eit nytt Google-ark.
 *  2. Utvidingar → Apps Script. Slett det som står der, og lim inn heile denne fila.
 *  3. Lagre. Køyr funksjonen «oppsett» éin gong (vel han i menyen øvst og trykk Køyr),
 *     og godkjenn tilgangen.
 *  4. Distribuer → Ny distribusjon → type «Nettapp».
 *     Køyr som: Meg.  Kven har tilgang: Alle.
 *  5. Kopier adressa som sluttar på /exec, og lim ho inn som TOPPLISTE_URL i piano4.html.
 *
 * Endrar du koden seinare: Distribuer → Administrer distribusjonar → blyant → Ny versjon.
 * Då held adressa seg den same.
 */

const ARK = "Resultat";
const KOLONNAR = ["Tid", "Klasse", "Låt", "Tempo", "Kallenamn", "Poeng", "Treff %", "Kombo", "Notar"];
const TOPP = 10;

function oppsett() {
  const bok = SpreadsheetApp.getActiveSpreadsheet();
  const ark = bok.getSheetByName(ARK) || bok.insertSheet(ARK);
  ark.getRange(1, 1, 1, KOLONNAR.length).setValues([KOLONNAR]).setFontWeight("bold");
  ark.setFrozenRows(1);
}

// GET ?klasse=2ITKA&lat=...&tempo=1  →  topp 10 for den låten
function doGet(e) {
  try {
    const p = e.parameter;
    return svar({ ok: true, liste: toppliste(rydd(p.klasse, 20).toUpperCase(), rydd(p.lat, 80), String(Number(p.tempo) || 1)) });
  } catch (feil) {
    return svar({ ok: false, feil: String(feil.message || feil) });
  }
}

// POST (JSON i body) → lagrar eitt resultat
function doPost(e) {
  const las = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents);
    const klasse = rydd(d.klasse, 20).toUpperCase();
    const lat = rydd(d.lat, 80);
    const tempo = String(Number(d.tempo) || 1);
    const kallenamn = rydd(d.kallenamn, 16);
    const notar = heiltal(d.notar, 0, 2000);
    // Enkel kontroll: meir enn 300 poeng × 4 per note er umogleg
    const poeng = heiltal(d.poeng, 0, Math.max(1, notar) * 1200);
    const treff = heiltal(d.treff, 0, 100);
    const kombo = heiltal(d.kombo, 0, notar);

    if (!klasse || !lat || !kallenamn) throw new Error("manglar klasse, låt eller kallenamn");
    if (poeng <= 0) throw new Error("ingen poeng å sende");

    las.waitLock(5000);
    const ark = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ARK);
    // Tekstfelt får ein ' framfor seg, så arket aldri tolkar dei som formlar (=, +, - …)
    ark.appendRow([new Date(), "'" + klasse, "'" + lat, "'" + tempo, "'" + kallenamn, poeng, treff, kombo, notar]);
    SpreadsheetApp.flush();
    las.releaseLock();

    const liste = toppliste(klasse, lat, tempo);
    const plass = liste.findIndex(r => r.kallenamn === kallenamn && r.poeng === poeng) + 1;
    return svar({ ok: true, kallenamn: kallenamn, plass: plass || null });
  } catch (feil) {
    try { las.releaseLock(); } catch (x) {}
    return svar({ ok: false, feil: String(feil.message || feil) });
  }
}

// Beste resultat per kallenamn, sortert etter poeng
function toppliste(klasse, lat, tempo) {
  if (!klasse) return [];
  const rader = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ARK).getDataRange().getValues().slice(1);
  const beste = {};
  rader.forEach(r => {
    if (String(r[1]) !== klasse || String(r[2]) !== lat || String(r[3]) !== tempo) return;
    const namn = String(r[4]);
    const poeng = Number(r[5]);
    if (!beste[namn] || poeng > beste[namn].poeng) {
      beste[namn] = { kallenamn: namn, poeng: poeng, treff: Number(r[6]) };
    }
  });
  return Object.values(beste).sort((a, b) => b.poeng - a.poeng).slice(0, TOPP);
}

function rydd(tekst, maks) {
  return String(tekst || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, maks);
}

function heiltal(v, min, maks) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return min;
  return Math.min(maks, Math.max(min, n));
}

function svar(objekt) {
  return ContentService.createTextOutput(JSON.stringify(objekt)).setMimeType(ContentService.MimeType.JSON);
}
