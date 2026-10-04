import {useCallback,useMemo,useState,type ReactNode} from 'react';
import {CheckCircle2,Info,TriangleAlert,XCircle,X} from 'lucide-react';
import {errorMessage} from '../api/client';

import {ToastContext as Context,type Notify,type ToastKind} from './toast-context';

type Toast={id:number;kind:ToastKind;message:string};
const icons={success:CheckCircle2,error:XCircle,warning:TriangleAlert,info:Info};
let next=1;

// Every user action reports back through these toasts; errors stay longer so they can be read.
export function ToastProvider({children}:{children:ReactNode}){
 const [toasts,setToasts]=useState<Toast[]>([]);
 const dismiss=useCallback((id:number)=>setToasts(all=>all.filter(t=>t.id!==id)),[]);
 const notify=useCallback((kind:ToastKind,message:string)=>{
  const id=next++;setToasts(all=>[...all.slice(-3),{id,kind,message}]);
  setTimeout(()=>dismiss(id),kind==='error'?8000:4000);
 },[dismiss]);
 const value=useMemo<Notify>(()=>({notify,success:m=>notify('success',m),error:e=>notify('error',errorMessage(e)),info:m=>notify('info',m),warning:m=>notify('warning',m)}),[notify]);
 return <Context.Provider value={value}>{children}<div className="toasts" aria-live="polite">{toasts.map(t=>{const Icon=icons[t.kind];return <div key={t.id} className={`toast ${t.kind}`} role={t.kind==='error'?'alert':'status'}><Icon size={18}/><span>{t.message}</span><button aria-label="Fermer" onClick={()=>dismiss(t.id)}><X size={14}/></button></div>;})}</div></Context.Provider>;
}
