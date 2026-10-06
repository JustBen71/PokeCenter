import type {PublicPlayer} from '@pokerace/shared';
import {areaFor} from '../progression';

export type MapArea={id:string;x:number;y:number;width:number;height:number;label?:string;kind?:string};
/**
 * One drawable region per game. Only Hoenn (Emerald) exists today; a Gen IV lobby would register
 * Sinnoh here (image + location → area lookup) without touching the Progressions page.
 */
export type GameMapDefinition={id:string;region:string;image:string;width:number;height:number;source:string;ariaLabel:string;areaFor:(player:PublicPlayer)=>MapArea|undefined};

const hoenn:GameMapDefinition={id:'hoenn-emerald',region:'Hoenn',image:'/maps/hoenn-emerald.svg',width:960,height:640,source:'Carte originale du PokéNav',
 ariaLabel:'Carte originale de Hoenn dans Pokémon Émeraude et positions des joueurs',areaFor};
const maps:Record<string,GameMapDefinition>={'pokemon-emerald':hoenn};

/** Map of the lobby's game; Emerald by default while nobody is connected (historical behaviour). */
export function mapForPlayers(players:PublicPlayer[]):GameMapDefinition|undefined{
 const game=players.find(p=>p.state.game.romStatus==='recognized')?.state.game.name??'pokemon-emerald';
 return maps[game];
}
