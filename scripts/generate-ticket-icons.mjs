// Generates the ten local ticket icons used by wheels and the shop (apps/web/public/tickets).
// Green tickets evoke kind wheels, purple ones hostile wheels. Run: node scripts/generate-ticket-icons.mjs
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const out=join(dirname(fileURLToPath(import.meta.url)),'..','apps','web','public','tickets');
mkdirSync(out,{recursive:true});

const palettes={green:['#1f6b4f','#5de1a8','#d9ffef'],purple:['#4b2a7a','#a679ff','#efe2ff']};
// One symbol per ticket, drawn in a 24×24 box centred on the ticket.
const symbols={
 'green-1':'<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/>',
 'green-2':'<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
 'green-3':'<circle cx="8.5" cy="8.5" r="3.6"/><circle cx="15.5" cy="8.5" r="3.6"/><circle cx="8.5" cy="15.5" r="3.6"/><circle cx="15.5" cy="15.5" r="3.6"/>',
 'green-4':'<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke-width="2" stroke-linecap="round"/>',
 'green-5':'<rect x="4" y="10" width="16" height="10" rx="1.5"/><rect x="3" y="7" width="18" height="4" rx="1"/><path d="M12 7v13" stroke-width="2"/><path d="M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0" fill="none" stroke-width="2"/>',
 'purple-1':'<path d="M12 3c-4.4 0-7.5 3.2-7.5 7.4 0 2.4 1.1 4 2.6 5V19h9.8v-3.6c1.5-1 2.6-2.6 2.6-5C19.5 6.2 16.4 3 12 3z"/><circle cx="9" cy="11" r="1.9" class="hole"/><circle cx="15" cy="11" r="1.9" class="hole"/>',
 'purple-2':'<path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6z"/>',
 'purple-3':'<circle cx="11" cy="14" r="6.5"/><path d="M15.5 8.5l2.5-2.5M18 6l1.5-1.5" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="20" cy="4" r="1.3"/>',
 'purple-4':'<path d="M4 6l4 12 4-8 4 8 4-12-4 4-4-6-4 6z"/>',
 'purple-5':'<path d="M2.5 12S6.5 5 12 5s9.5 7 9.5 7-4 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3.2" class="hole"/>'
};

for(const [id,symbol] of Object.entries(symbols)){
 const [dark,main,light]=palettes[id.split('-')[0]];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Ticket ${id}">
 <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${main}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
 <path d="M8 14h48a4 4 0 0 1 4 4v7a7 7 0 0 0 0 14v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-7a7 7 0 0 0 0-14v-7a4 4 0 0 1 4-4z" fill="url(#g)" stroke="${light}" stroke-width="2"/>
 <path d="M46 16v32" stroke="${light}" stroke-width="1.5" stroke-dasharray="3 3" opacity=".7"/>
 <g transform="translate(15 20)" fill="${light}" stroke="${light}" stroke-width="0" style="--hole:${dark}">${symbol.replaceAll('class="hole"',`fill="${dark}"`)}</g>
</svg>
`;
 writeFileSync(join(out,`${id}.svg`),svg);
}
console.log(`Ticket icons written to ${out}`);
