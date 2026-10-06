import type {ReactNode} from 'react';
import {passiveRarityLabels,type PassiveDefinition} from '@pokerace/shared';

// Large card used by the initial choice and the catalogue.
export function PassiveCard({passive,children,muted=false}:{passive:PassiveDefinition;children?:ReactNode;muted?:boolean}){
 return <article className={`passive-card ${passive.rarity.toLowerCase()} ${muted?'muted-card':''}`}>
  <p className="passive-rarity">{passiveRarityLabels[passive.rarity]}</p>
  <h3>{passive.name}</h3>
  <small>{passive.family}</small>
  <p>{passive.description}</p>
  {children}
 </article>;
}
