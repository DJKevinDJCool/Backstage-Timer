# Backstage Timer 🎬⏱️

**Backstage Timer** er en enkel Node.js‑app som fungerer som backstage‑timer for show.  
Den lytter på MultiPlay via OSC og sender `NOW` / `NEXT` til en webklient i sanntid via Socket.IO.  
Perfekt for live‑shows og teaterproduksjoner!  

---

## ⚡ Kom i gang

### 1️⃣ Last ned prosjektet
Du kan enten:  
- **Laste ned hele repoet som ZIP** og pakke det ut i en mappe.  
- **Eller bruke Git**:

```bash
git clone https://github.com/DJKevinDJCool/Backstage-timer.git
cd Backstage-timer
```
2️⃣ Installer avhengigheter
```
npm install
```
3️⃣ Kjør serveren
```
node server.js
```
Som standard bruker appen disse portene:

HTTP-server: 3000 → åpne i nettleser: http://localhost:3000

MultiPlay utgående OSC: 9000

MultiPlay innkommende OSC: 8000

⚠️ Viktig: Sørg for at portene matcher de du har satt i MultiPlay OSC‑innstillingene!

4️⃣ Bruk appen
Åpne nettleser på 
http://localhost:3000


Se NOW / NEXT bli oppdatert i sanntid når MultiPlay sender signaler.

📝 Logger / debug
Serveren logger alt for enkel feilsøking:

[OSC RECEIVED] → viser meldinger som mottas fra MultiPlay

[BROADCAST] → viser meldinger som sendes til webklienten

💡 Tips
Sørg for at du kjører appen fra samme mappe som server.js, ellers kan filstier og Socket.IO feile.

Du kan endre portene i server.js hvis du allerede har noe annet som bruker 3000 / 8000 / 9000.

Lag en kul backstage‑opplevelse med Backstage Timer! 🚀
