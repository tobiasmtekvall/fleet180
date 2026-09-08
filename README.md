# Säkerhetskontroll – Fleet 180

En webbapp där **varje fordon har sitt eget exemplar** av säkerhetskontrollen.
Varje ifylld kontroll sparas i Postgres, och varje fordon har en QR-kod som du
skriver ut och sätter i hytten. Fordon och frågor ligger i databasen och
redigeras i appen – ingen kod behöver ändras för att lägga till en bil eller
skriva om en fråga.

| | |
|---|---|
| Formulärets adress | `/v/<REGNR>` – t.ex. `/v/ODW03R` |
| QR-koder för utskrift | `/qr` |
| Administration | `/admin` (lösenordsskyddad) |
| &nbsp;&nbsp;· Kontroller | `/admin` – lista, filter, CSV |
| &nbsp;&nbsp;· Fordon | `/admin/vehicles` – lägg till, ändra, avställ |
| &nbsp;&nbsp;· Formulär | `/admin/forms` – frågor, ordning, kopior |
| &nbsp;&nbsp;· Förare | `/admin/drivers` – listan som synkas från Route Suite |
| &nbsp;&nbsp;· Dagsmejl | `/admin/daily-summary` – förhandsgranska och skicka |
| API | `/api/drivers`, `/api/checks`, `/api/photo/:id` (nyckel krävs) |
| Hälsokontroll | `/health` |

**Fordonen** vid första starten är 22 stycken: de 15 boxbilarna ur suitens
aktuella prioritetsmatris, BPM38R, och de sex hemleveransbilarna. ESJ01Y ingår
inte – den bilen är avvecklad. TTJ00A, RAH84S och hemleveransbilarna står utan
ägare (`—`), eftersom ingen sagt vilka som är hyrda; sätt det i admin när du
vet. Listan seedas bara i en tom databas – därefter är det admin som gäller.

---

## Fordon och QR-koder

`/admin/vehicles` är hela fordonshanteringen:

* **Lägg till** ett reg.nr så finns dess sida och dess QR-kod direkt – QR-arket
  på `/qr` bygger sig självt av fordonslistan.
* **Ägare** (Egen / OKQ8 / —) och **flotta** (Boxbilar / Hemleverans) styr hur
  fordonet visas och grupperas.
* **Aktiv** avbockad = fordonet försvinner ur listor och QR-ark och tar inte
  emot nya kontroller, men historiken finns kvar. Så avvecklar du en bil.
* **Ta bort** går bara på fordon utan registrerade kontroller. Har bilen
  historik säger appen ifrån och föreslår avställning i stället – annars hade
  gamla kontroller blivit hemlösa.
* Byte av reg.nr tillåts inte på en bil som redan har kontroller. Ett nytt
  reg.nr är en ny bil.

## Formulär

`/admin/forms` innehåller **standardformuläret** som alla fordon använder, och
eventuella kopior. Inuti ett formulär kan du:

* skriva om, lägga till och ta bort frågor, och flytta dem med ▲▼,
* välja **frågetyp**:

  | Typ | Vad föraren ser |
  |---|---|
  | Fritext | En rad text. |
  | Ja / Nej / Annat | Tre knappar. Kommentarsrutan öppnas vid *Nej* och krävs vid *Annat*. |
  | Foto | Öppnar kameran, flera bilder tillåtna. |
  | Informationstext | Bara text till föraren, inget svar. |

* sätta **avsnitt** – frågor som står efter varandra med samma avsnittsnamn
  hamnar i samma kort, precis som originalets fyra delar,
* markera en fråga som **obligatorisk**,
* peka ut vilken fråga som är **förarens namn**, **rutt** och **miltal**, så att
  de syns som egna kolumner i kontrollistan.

**Individuella formulär:** kopiera standardformuläret, ändra frågorna i kopian,
och välj kopian för ett visst fordon under Fordon. Alla andra fordon behåller
standarden.

**Ändringar påverkar aldrig redan inskickade kontroller.** Varje kontroll
sparar en kopia av frågorna den besvarade, så en kontroll från förra veckan
läses precis som den fylldes i även om frågan är omskriven eller borttagen i
dag.

Frågorna i standardformuläret är ordagrant hämtade ur det ursprungliga
Fleet 360-formuläret, inklusive dess egna stavfel ("Sara ja eller nej"),
eftersom förarna känner igen ordalydelsen. De frågor som ber om ett ja eller
ett nej är satta som **Ja / Nej / Annat** i stället för fritext – ändra tillbaka
i formulärredigeraren om du hellre vill ha en textrad.

---

## Så här kommer du igång

### 1. Lägg upp koden på GitHub

```bash
cd okq8-sakerhetskontroll
git init
git add .
git commit -m "Sakerhetskontroll for OKQ8-fordon"
git branch -M main
git remote add origin https://github.com/<ditt-konto>/<ditt-repo>.git
git push -u origin main
```

### 2. Deploya på Railway

1. **New Project → Deploy from GitHub repo** och välj repot.
2. I samma projekt: **New → Database → Add PostgreSQL**.
3. Gå till appens **Variables** och lägg till:

   | Variabel | Värde |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referens till databasen) |
   | `ADMIN_PASSWORD` | ett lösenord du väljer, för `/admin` |
   | `ADMIN_USER` | *(valfritt, standard `admin`)* |
   | `PUBLIC_BASE_URL` | **lämna osatt.** Sätts bara om du kopplat en egen domän – se nedan. |

4. **Settings → Networking → Generate Domain** för att få en publik adress.
5. Deployen startar automatiskt. Tabellerna skapas vid första starten –
   ingen migrering behövs.

`PORT` sätts av Railway.

**Om `PUBLIC_BASE_URL`:** låt den vara osatt. Då bygger appen QR-koderna av
adressen anropet kom in på, vilket alltid är rätt – öppnar du `/qr` på rätt
sida får du koder till rätt sida. Variabeln behövs bara om du kopplat en egen
domän och vill att koderna pekar dit även när du skriver ut dem från
railway.app-adressen. Sätter du den måste den vara **din** adress; en gammal
eller inklistrad adress ger koder som leder ingenstans, och det syns inte på
en utskriven kod. `/qr` varnar därför när den kodade adressen inte är den du
läser sidan på, och `/qr?base=here` ger koder till den adress du står på.

### 3. Skriv ut QR-koderna

Öppna `https://<din-app>/qr` och tryck **Skriv ut**. Arket innehåller alla
aktiva fordon. Sidan har egen
utskriftslayout: tre koder per rad, streckad klipplinje, regnr och adress
under varje kod. Enstaka kod som PNG: `/qr/BPM38R.png`.

För etikettskrivare finns även ett skript som skriver PNG-filer till `qr-out/`:

```bash
BASE_URL=https://din-app.up.railway.app npm run qr
```

---

## Om deployen faller på databasen

Felet `ECONNREFUSED 127.0.0.1:5432` i Railway-loggen betyder **inte** att
databasen är trasig. Det betyder att appen inte fick någon adress alls, och
att `pg` då föll tillbaka på "localhost" – alltså appens egen container, där
ingen databas kör.

Appen kontrollerar numera adressen innan den ansluter och skriver ut exakt
vad som saknas. Så här ska variabeln sitta:

1. **Samma projekt** måste innehålla databasen: **New → Database → Add PostgreSQL**.
2. Öppna **appens** service (inte databasens) → **Variables**.
3. **New Variable → Add Reference → Postgres → `DATABASE_URL`.**
   Knappen "Add Reference" är det viktiga: skriver du in
   `${{Postgres.DATABASE_URL}}` som vanlig text och referensen inte binds,
   skickas den texten vidare ordagrant och appen har fortfarande ingen adress.
   Heter databasens service något annat än `Postgres` ska det namnet användas.
4. Deploya om. Loggen ska nu börja med raden:

   ```
   [db] connected to postgres://postgres:***@postgres.railway.internal:5432/railway (ssl: off, from DATABASE_URL)
   ```

Appen läser i tur och ordning `DATABASE_URL`, `DATABASE_PRIVATE_URL`,
`POSTGRES_URL`, `DATABASE_PUBLIC_URL`, `PGURL`, och i sista hand
`PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`PGPORT`.

**TLS sköts automatiskt.** Railways interna nät (`*.railway.internal`) kör
oskyddad TCP, medan den publika TCP-proxyn kräver TLS med ett certifikat som
ingen publik CA signerat. Appen provar rätt läge först och byter till det
andra om servern säger emot. Vill du styra det själv: `?sslmode=disable` i
URL:en tvingar oskyddat, `?sslmode=require` tvingar TLS, och `DB_SSL_STRICT=1`
kräver dessutom ett verifierbart certifikat (fungerar inte mot Railways proxy).

Startar databasen långsammare än appen gör appen sex försök med växande
paus innan den ger upp; `DB_CONNECT_ATTEMPTS` ändrar antalet.


---

## Språk

Formuläret finns på **svenska, engelska, arabiska och hindi**. Föraren byter
med de små flaggorna ovanför formuläret. Bytet sker i sidan – **allt som redan
är ifyllt står kvar**, inklusive tagna foton – och arabiska växlar hela sidan
till höger-till-vänster. Valet sparas i telefonen, så nästa fordon öppnas på
samma språk. Kvittot visas också på det språk kontrollen fylldes i.

Svenskan är originalet; de andra tre är översättningar av den. Lägger du till
en fråga i redigeraren översätter du den under *Alternativ, larm och
översättningar* på frågans rad. En fråga utan översättning visas på svenska
i stället för att bli tom.

## Frågetyper

| Typ | Vad föraren ser |
|---|---|
| Fritext | En rad text. |
| **Rullgardin** | En lista att välja ur. Egna alternativ (ett per rad) eller **förarlistan**. |
| Ja / Nej / Annat | Tre knappar. Kommentarsrutan öppnas vid *Nej* och krävs vid *Annat*. |
| Foto | Öppnar kameran, flera bilder tillåtna. |
| Informationstext | Bara text till föraren, inget svar. |

Standardformuläret använder tre rullgardiner: **Namn och efternamn** (från
förarlistan, i bokstavsordning), **Din rutt** (JK-EM-1 … JK-EM-20) och
**AdBlue** (100 % ned till 30 % i steg om fem).

### Larm – vad som räknas som "att åtgärda"

Varje Ja/Nej-fråga har en egen inställning för *vilket* svar som betyder att
något behöver fixas, eftersom polariteten skiljer sig: "Fungerar bakgavellyften?"
är ett problem vid **Nej**, medan "Finns nya skador?" är ett problem vid **Ja**.
*Annat* larmar alltid – någon behöver läsa kommentaren. Det är dessa svar som
dagsmejlet och FLEET180-vyn i tillägget lyfter fram.

## Förarlistan

Listan ägs av Route Suite. `scripts/sync-drivers.js` läser suitens
webbserverspegel (`webserver/data/mirror/storage.json` →
`routeAssigner.matrix.v1` + `routeAssigner.home.matrix.v1`), tar bort dem som
står på `budbee:drivers:inactive`, sorterar svenskt (Å Ä Ö sist), skriver
`data/drivers.json` och postar listan till `/api/drivers`. Rullgardinen är
uppdaterad inom sekunder – ingen ny deploy behövs.

```bash
cd okq8-sakerhetskontroll
cp scripts/fleet180-sync.example.json scripts/fleet180-sync.json   # fyll i token
node scripts/sync-drivers.js --dry-run    # visar listan, postar inget
node scripts/sync-drivers.js              # skarpt
```

En förare som försvinner ur suiten markeras **inaktiv** i stället för att
raderas, så en redan inskickad kontroll fortfarande går att läsa. En tom lista
vägras – den skulle tömma rullgardinen och stoppa förarna.

## Dagsmejlet

Skickas en gång per dygn till `SUMMARY_TO` med vilka som lämnat in, vad som
behöver åtgärdas, och vilka fordon som saknar kontroll. Tid styrs av
`SUMMARY_HOUR` (standard 17, svensk tid). Utan `RESEND_API_KEY` skickas inget –
men sammanfattningen finns alltid att läsa på `/admin/daily-summary`, där det
också går att skicka dagens mejl direkt. En `jobs`-rad i databasen gör att en
omstart eller en andra instans inte kan skicka samma dag två gånger.

## API

Alla `/api`-vägar kräver `API_TOKEN`, skickad som `X-Api-Key` (eller `?key=`
för bild-URL:er, som inte kan bära en header). **Är `API_TOKEN` osatt är API:t
avstängt** – en osatt hemlighet betyder aldrig "släpp in alla".

| Väg | Vad |
|---|---|
| `POST /api/drivers` | Ersätter förarregistret. `{"drivers":[{"name":"..."}]}` |
| `GET /api/checks?from=&to=` | Kontroller per dag, med larm, saknade fordon och foto-URL:er |
| `GET /api/photo/:id` | En bild |

## Chrome-tillägget

`Meny → Import → FLEET180` i Route Suite speglar appens databas lokalt och
visar en dag i taget: vem som gjort sin kontroll, vad som rapporterats att
åtgärda, foton, och vilka fordon som saknas. Kalender och pilar fungerar som
på Daily Route Analysis (piltangenterna vänster/höger går också). Sidan
synkar tyst när den öppnas och läser annars ur spegeln, så den fungerar
även utan nät. Första gången klistrar du in appens adress och `API_TOKEN`.

Filerna är `fleet180.html`, `fleet180.css`, `fleet180.js` och
`lib/fleet180.js` i tilläggsmappen, plus en rad i `nav.js`.

---

## Vad som sparas

En rad i `submissions` per **inskickad** kontroll (inte per besök), med
alla svar i en `jsonb`-kolumn plus förare, rutt och miltal i egna
kolumner för snabb filtrering. Foton hamnar i `photos`, en rad per bild,
kopplade till kontrollen med `ON DELETE CASCADE`. Kontroll och foton skrivs
i samma transaktion, så en halvsparad kontroll kan aldrig dyka upp i listan.

```
vehicles(id, plate, owner, fleet, active, form_id, sort_order, ...)
forms(id, key, title, is_default, ...)
form_fields(id, form_id, position, name, kind, label, section, required, role)
submissions(id, plate, owner, form_id, form_key, form_title, submitted_at,
            driver_name, route, odometer, answers jsonb, questions jsonb,
            photo_count, user_agent, client_ip)
photos(id, submission_id, field, field_label, filename, mime, bytes, byte_size)
```

`answers` innehåller svaren per frågenyckel; `questions` är kopian av frågorna
som gällde vid inskicket. Ett Ja/Nej/Annat-svar sparas som
`{"choice":"annat","comment":"..."}`, en fritext som en sträng. Kontroller som
gjordes innan formulären blev redigerbara har ingen frågekopia och visas mot
standardformuläret – de läses fortfarande rätt.

**Foton krymps i telefonen** innan de skickas – längsta sidan 1600 px, JPEG
82 %. En mobilbild på 4–6 MB blir typiskt 200–400 kB. Utan JavaScript
fungerar formuläret ändå, då postas bilden i originalstorlek (max 12 MB).

## Administration

`/admin` listar alla kontroller, nyast först, med filter på fordon och
datumintervall. Därifrån:

* **Visa** – hela kontrollen med foton i full storlek, plus enhet och IP.
* **Ladda ner CSV** – samma filter, semikolonseparerat med BOM så att
  Excel öppnar svenska tecken rätt. Kolumnerna är alla frågor som förekommer
  bland raderna, så en export med flera olika formulär blir en enda tabell där
  tomma celler betyder "den frågan ställdes inte".

Skyddet är HTTP Basic med `ADMIN_PASSWORD`. Utan den variabeln satt är
`/admin` helt stängd. Formulärsidorna är öppna med flit – en förare ska
inte behöva logga in för att göra sin kontroll.

## Köra lokalt

```bash
cp .env.example .env        # fyll i DATABASE_URL och ADMIN_PASSWORD
npm install
node --env-file=.env src/server.js
```

Appen ligger sedan på <http://localhost:3000>.

## Filer

```
src/server.js        alla routes, uppladdning, admin-auth, CSV, QR
src/db.js            anslutning, schema, alla frågor mot databasen
src/seed.js          vad en tom databas fylls med första gången
src/fields.js        frågetyperna: hur ett svar läses, valideras och visas
src/plate.js         normalisering av reg.nr
src/views/           HTML-mallar (layout, formulär, kvitto, admin, QR)
public/app.css       utseendet, hämtat från originalsidan
public/form.js       kamera, bildkrympning, Ja/Nej/Annat, validering, inskick
scripts/generate-qr.js  PNG-filer till qr-out/
```

Fordon och frågor **ändras i appen, inte i koden**. `src/seed.js` används bara
för en tom databas.

Frågorna är ordagrant kopierade från originalformuläret, inklusive dess
egna stavfel ("Sara ja eller nej"), eftersom förarna känner igen ordalydelsen
från pappersvarianten.
