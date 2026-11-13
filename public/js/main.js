// Entry point: importing nav loads the whole module graph; then start the app.
import { boot } from './nav.js';
import { $, esc } from './core.js';


boot().catch(e => { $('#main').innerHTML = `<div class="note bad">Couldn't load the app: ${esc(e.message)}</div>`; });
