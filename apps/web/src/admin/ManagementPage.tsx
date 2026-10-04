import {ReviewPanel} from './ReviewPanel';
import {ObjectivesPanel} from './ObjectivesPanel';
import {SettingsPanel} from './SettingsPanel';
import {QueuePanel} from './QueuePanel';
import {LobbyPanel} from './LobbyPanel';
import {RunsPanel} from './RunsPanel';
import {ProtectionsPanel} from './ProtectionsPanel';
import {OverviewPanel} from './OverviewPanel';

// Admin hub. Each concern is its own panel: adding a module means adding a panel, not growing one component.
export function ManagementPage(){
 return <section className="management-page">
  <header className="page-head"><div><p className="eyebrow">ADMIN</p><h1>Gestion</h1><p className="muted">Lobby, Runs, files d’attente, protections, objectifs et paramètres financiers. Les roues, enchères, la bibliothèque et le jackpot ont leurs propres pages.</p></div></header>
  <OverviewPanel/>
  <h2 className="section-title">En direct</h2>
  <div className="panel-grid"><QueuePanel/><ReviewPanel/><RunsPanel/></div>
  <h2 className="section-title">Lobby et règles</h2>
  <div className="panel-grid"><LobbyPanel/><SettingsPanel/><ProtectionsPanel/></div>
  <h2 className="section-title">Objectifs</h2>
  <ObjectivesPanel/>
 </section>;
}
