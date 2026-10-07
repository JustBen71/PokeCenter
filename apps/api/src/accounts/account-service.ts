import {randomUUID} from 'node:crypto';
import {accountInput,accountKey,accountUpdateSchema,type Account} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import {adminPasswordRequired,parseBody} from '../http.js';
import type {AuditService} from '../audit/audit-service.js';
import type {AccountRepository} from './account-repository.js';

/**
 * Simple trust model for a private group: anyone may pick an account, and the role is declared at creation.
 * After creation, only an admin may grant or remove the admin role, and the last admin cannot be demoted.
 */
export class AccountService{
 constructor(private readonly accounts:AccountRepository,private readonly audit:AuditService){}

 create(body:unknown):Account{
  const data=parseBody(accountInput,body);
  if(this.accounts.findByName(data.name))throw new DomainError('CONFLICT','Ce nom existe déjà : sélectionnez ce compte');
  // With a server admin password, nobody declares the role at creation: it comes from « Se connecter en admin ».
  const account=this.accounts.save({...data,admin:adminPasswordRequired()?false:data.admin,id:'p-'+randomUUID().replaceAll('-','')});
  this.audit.record({actorAccountId:account.id,targetAccountId:account.id,category:'ACCOUNT',action:'account.create',status:'SUCCESS',message:`Compte « ${account.name} » créé`,metadata:{admin:account.admin}});
  return account;
 }

 update(actor:Account,id:string,body:unknown):Account{
  const patch=parseBody(accountUpdateSchema,body);
  const target=this.accounts.get(id);
  if(!target)throw new DomainError('ACCOUNT_NOT_FOUND','Compte introuvable');
  if(!actor.admin&&actor.id!==id)throw new DomainError('FORBIDDEN','Vous ne pouvez modifier que votre propre profil');
  if(patch.admin!==undefined&&patch.admin!==target.admin){
   if(!actor.admin)throw new DomainError('ADMIN_REQUIRED','Seul un administrateur peut changer un rôle');
   if(!patch.admin&&this.accounts.list().filter(a=>a.admin).length<=1)throw new DomainError('LAST_ADMIN','Il doit rester au moins un administrateur');
  }
  if(patch.name!==undefined){const other=this.accounts.findByName(patch.name);if(other&&other.id!==id)throw new DomainError('CONFLICT','Nom déjà utilisé');}
  const account=this.accounts.save({id,name:patch.name??target.name,sprite:patch.sprite??target.sprite,admin:patch.admin??target.admin},accountKey(patch.name??target.name));
  const changed=(['name','sprite','admin'] as const).filter(k=>patch[k]!==undefined&&patch[k]!==target[k]);
  this.audit.record({actorAccountId:actor.id,targetAccountId:id,category:patch.admin!==undefined&&patch.admin!==target.admin?'ADMIN':'ACCOUNT',action:'account.update',status:'SUCCESS',
   message:`Profil « ${account.name} » modifié`,metadata:{changed,...(changed.includes('admin')?{admin:account.admin}:{})}});
  return account;
 }
}
