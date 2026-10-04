import {z} from 'zod';
export const trainerSprites=['brendan','may','red','leaf','steven','youngster','lass','hiker','beauty'] as const;
export const accountInput=z.object({name:z.string().trim().min(1).max(32).refine(s=>!/[\x00-\x1f\x7f]/.test(s)),sprite:z.string().refine(s=>trainerSprites.includes(s as typeof trainerSprites[number])||(/^pokemon-[1-9][0-9]{0,2}$/.test(s)&&Number(s.slice(8))<=386),'Sprite inconnu'),admin:z.boolean()});
export type Account=z.infer<typeof accountInput>&{id:string;createdAt?:string;updatedAt?:string};
export const accountKey=(name:string)=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();

export const avatarUrl=(sprite:string)=>/^pokemon-[1-9][0-9]{0,2}$/.test(sprite)?`/sprites/${Number(sprite.slice(8))}.png`:`/trainers/${trainerSprites.includes(sprite as typeof trainerSprites[number])?sprite:'brendan'}.svg`;
// Profile edits are partial: the menu changes the name or the avatar alone. The role is checked by the API.
export const accountUpdateSchema=accountInput.partial().refine(v=>Object.keys(v).length>0,'Aucune modification');
export type AccountUpdate=z.infer<typeof accountUpdateSchema>;
export type PublicAccount=Pick<Account,'id'|'name'|'sprite'|'admin'>;
