// Pokédollar sign drawn locally (the "P" with two bars of the games), so no external asset is needed.
export function PokeDollar({size=16}:{size?:number}){
 return <svg className="pokedollar" width={size} height={size} viewBox="0 0 16 16" aria-label="Pokédollars" role="img">
  <path d="M4.5 14V2h4.6a3.4 3.4 0 0 1 0 6.8H4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M2.5 9.6h7M2.5 12h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
 </svg>;
}
