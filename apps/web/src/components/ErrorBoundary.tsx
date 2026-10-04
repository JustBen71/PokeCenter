import {Component,type ErrorInfo,type ReactNode} from 'react';

// Last safety net: an unexpected render error shows a recoverable screen instead of a blank page.
export class ErrorBoundary extends Component<{children:ReactNode},{error:Error|null}>{
 state={error:null as Error|null};
 static getDerivedStateFromError(error:Error){return {error};}
 componentDidCatch(error:Error,info:ErrorInfo){console.error('Erreur d’affichage',error,info.componentStack);}
 render(){
  if(!this.state.error)return this.props.children;
  return <main className="account-entry"><section className="account-box" role="alert">
   <h2>Une erreur d’affichage est survenue</h2>
   <p className="muted">Les données du serveur ne sont pas touchées. Recharge la page pour continuer.</p>
   <details><summary>Détail technique</summary><pre className="metadata">{this.state.error.message}</pre></details>
   <button className="primary" onClick={()=>window.location.reload()}>Recharger</button>
  </section></main>;
 }
}
