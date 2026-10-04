import type {WheelTone,WheelType} from '@pokerace/shared';

// Local ticket artwork (public/tickets): green = kind, purple = hostile. Neutral wheels use the first green one.
export function TicketIcon({icon,tone,size=40}:{icon?:WheelType['icon'];tone?:WheelTone;size?:number}){
 const file=icon??(tone==='BAD'?'purple-1':'green-1');
 return <img className="ticket-icon" src={`/tickets/${file}.svg`} width={size} height={size} alt=""/>;
}
