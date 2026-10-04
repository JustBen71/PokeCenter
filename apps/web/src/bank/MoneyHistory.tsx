import type {MoneyTransaction} from '@pokerace/shared';

const statusLabels:Record<MoneyTransaction['status'],string>={PENDING:'En attente',APPLYING:'En cours',CONFIRMED:'Confirmé',FAILED:'Échec',REVIEW:'À vérifier',CANCELLED:'Annulé'};
const sideLabels:Record<MoneyTransaction['source'],string>={GAME:'Jeu',BANK:'Banque',JACKPOT:'Jackpot',EXTERNAL:'Lobby'};

// Ledger rows as players read them: what moved, from where to where, and whether the game confirmed it.
export function MoneyHistory({transactions,labels,names}:{transactions:MoneyTransaction[];labels:Record<MoneyTransaction['type'],string>;names?:(accountId:string|null)=>string}){
 if(!transactions.length)return <p className="muted">Aucune opération pour l’instant.</p>;
 return <ul className="money-history">{transactions.map(t=><li key={t.id} className={t.status.toLowerCase()}>
  <div><strong>{labels[t.type]}</strong><small>{sideLabels[t.source]} → {sideLabels[t.destination]}{names?` · ${names(t.accountId)}`:''} · {new Date(t.createdAt).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}</small></div>
  <span className="amount">{t.amount.toLocaleString('fr-FR')} ₽</span>
  <span className={`badge status-${t.status.toLowerCase()}`}>{statusLabels[t.status]}</span>
 </li>)}</ul>;
}
