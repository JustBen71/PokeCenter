import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {encodePokemon,libraryInputSchema,type LibraryEntry,type PokemonArtifactDisplay,type PokemonArtifactFormat,type PokemonArtifactMeta,type PokemonInjection} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';

export type LibraryItem=LibraryEntry&{artifact:PokemonArtifactMeta};
type Row={id:string;label:string;format:PokemonArtifactFormat;game_family:string;generation:number;species:number;display_json:string;payload_json:string;source:string|null;captured_at:string|null;created_by:string|null;created_at:string};

// Rows keep the LibraryEntry shape the existing library screens already understand.
const toItem=(r:Row):LibraryItem=>{
 const payload=JSON.parse(r.payload_json);
 return {id:r.id,label:r.label,createdAt:r.created_at,...(r.source?{source:r.source}:{}),...(r.captured_at?{capturedAt:r.captured_at}:{}),
  ...(r.format==='gen3-party-v1'?{pokemon:payload.pokemon}:{template:payload.template}),
  artifact:{format:r.format,gameFamily:r.game_family,generation:r.generation,species:r.species,display:JSON.parse(r.display_json),createdBy:r.created_by}};
};

/** Global Pokémon library (admins only), independent of lobbies and Runs. */
export class LibraryService{
 constructor(private readonly db:Database.Database){}
 list():LibraryItem[]{return (this.db.prepare('SELECT * FROM pokemon_artifacts ORDER BY created_at DESC,rowid DESC').all() as Row[]).map(toItem);}
 get(id:string):LibraryItem|undefined{const row=this.db.prepare('SELECT * FROM pokemon_artifacts WHERE id=?').get(id) as Row|undefined;return row&&toItem(row);}
 require(id:string){const item=this.get(id);if(!item)throw new DomainError('NOT_FOUND','Pokémon introuvable dans la bibliothèque');return item;}

 create(body:unknown,createdBy:string|null,options:{id?:string;createdAt?:string}={}):LibraryItem{
  const input=parseBody(libraryInputSchema,body);
  const id=options.id??randomUUID();
  const format:PokemonArtifactFormat=input.pokemon?'gen3-party-v1':'gen3-template-v1';
  const display:PokemonArtifactDisplay=input.pokemon
   ?{speciesId:input.pokemon.speciesId,speciesName:input.pokemon.speciesName,nickname:input.pokemon.nickname,level:input.pokemon.level,shiny:input.pokemon.shiny}
   :{speciesId:input.template!.speciesId,speciesName:null,nickname:input.template!.nickname,level:input.template!.level,shiny:input.template!.shiny};
  this.db.prepare(`INSERT INTO pokemon_artifacts(id,label,format,game_family,generation,species,display_json,payload_json,source,captured_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
   .run(id,input.label,format,'pokemon-gen3',3,display.speciesId,JSON.stringify(display),JSON.stringify(input.pokemon?{pokemon:input.pokemon}:{template:input.template}),
    input.source??null,input.capturedAt??null,createdBy,options.createdAt??nowIso());
  return this.get(id)!;
 }
 delete(id:string){if(this.db.prepare('DELETE FROM pokemon_artifacts WHERE id=?').run(id).changes===0)throw new DomainError('NOT_FOUND','Pokémon introuvable dans la bibliothèque');}

 // The exact 100 bytes to insert for this artifact in a Gen III party.
 gen3Raw(item:LibraryItem):string{
  if(item.artifact.generation!==3)throw new DomainError('INVALID_POKEMON','Ce Pokémon ne vient pas de la troisième génération');
  if(item.pokemon?.raw)return item.pokemon.raw;
  if(item.template)return encodePokemon(item.template as PokemonInjection);
  throw new DomainError('INVALID_POKEMON','Cette copie ne contient pas les données nécessaires à une réinsertion');
 }

 // Copies a lobby's former library once; later deletions are therefore never undone by a restart.
 importOnce(lobbyId:string,entries:LibraryEntry[]){
  this.db.transaction(()=>{
   if(this.db.prepare('SELECT 1 FROM library_imports WHERE lobby_id=?').get(lobbyId))return;
   for(const entry of entries){
    if(this.get(entry.id))continue;
    const {id,createdAt,...input}=entry;
    // An invalid legacy entry stays in its course database instead of blocking the import.
    try{this.create(input,null,{id,createdAt});}catch(error){console.warn(`Library import skipped ${id}:`,error instanceof Error?error.message:error);}
   }
   this.db.prepare('INSERT INTO library_imports(lobby_id,imported_at) VALUES(?,?)').run(lobbyId,nowIso());
  })();
 }
}
