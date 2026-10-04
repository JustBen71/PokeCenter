import {createContext,useContext} from 'react';

export type ToastKind='success'|'error'|'warning'|'info';
export type Notify={notify:(kind:ToastKind,message:string)=>void;success:(m:string)=>void;error:(e:unknown)=>void;info:(m:string)=>void;warning:(m:string)=>void};
export const ToastContext=createContext<Notify|null>(null);
export const useToast=()=>{const c=useContext(ToastContext);if(!c)throw Error('ToastProvider manquant');return c;};
